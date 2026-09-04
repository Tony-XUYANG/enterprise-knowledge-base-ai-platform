import { query } from '../../db/pool.js';
import { getKnowledgeBase } from './knowledge-bases.service.js';

type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'disabled';
type DocumentSourceType = 'file' | 'url' | 'text';
type InsightIssue = 'failed' | 'stalled' | 'empty' | 'unsynced';

interface InsightsSummaryRow {
  total_documents: number;
  active_documents: number;
  ready_documents: number;
  pending_documents: number;
  processing_documents: number;
  failed_documents: number;
  disabled_documents: number;
  content_documents: number;
  synced_documents: number;
  issue_documents: number;
  total_chunks: number;
  total_bytes: number;
  average_chunk_characters: number | null;
  minimum_chunk_characters: number | null;
  maximum_chunk_characters: number | null;
  tokenized_chunks: number;
  average_tokens_per_chunk: number | null;
}

interface InsightsStatusRow {
  status: DocumentStatus;
  documents: number;
}

interface InsightsSourceRow {
  source_type: DocumentSourceType;
  documents: number;
  ready_documents: number;
  chunks: number;
  total_bytes: number;
}

interface InsightsIssueRow {
  id: string;
  name: string;
  status: Exclude<DocumentStatus, 'disabled'>;
  source_type: DocumentSourceType;
  chunk_count: number;
  updated_at: Date;
  error_message: string | null;
  failed: boolean;
  stalled: boolean;
  empty: boolean;
  unsynced: boolean;
}

export interface KnowledgeBaseInsights {
  generatedAt: string;
  summary: {
    totalDocuments: number;
    activeDocuments: number;
    readyDocuments: number;
    pendingDocuments: number;
    processingDocuments: number;
    failedDocuments: number;
    disabledDocuments: number;
    contentDocuments: number;
    syncedDocuments: number;
    issueDocuments: number;
    readinessRate: number;
    contentCoverageRate: number;
    syncCoverageRate: number;
    totalChunks: number;
    totalBytes: number;
    averageChunksPerDocument: number;
  };
  chunkQuality: {
    totalChunks: number;
    averageCharacters: number;
    minimumCharacters: number;
    maximumCharacters: number;
    tokenizedChunks: number;
    tokenCoverageRate: number;
    averageTokens: number;
  };
  statuses: Array<{
    status: DocumentStatus;
    documents: number;
  }>;
  sources: Array<{
    sourceType: DocumentSourceType;
    documents: number;
    readyDocuments: number;
    chunks: number;
    totalBytes: number;
  }>;
  issues: Array<{
    documentId: string;
    name: string;
    status: Exclude<DocumentStatus, 'disabled'>;
    sourceType: DocumentSourceType;
    chunkCount: number;
    updatedAt: string;
    errorMessage: string | null;
    reasons: InsightIssue[];
  }>;
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 1000) / 10;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function getKnowledgeBaseInsights(
  ownerId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseInsights> {
  await getKnowledgeBase(ownerId, knowledgeBaseId);

  const values = [knowledgeBaseId, ownerId];
  const [summaryResult, statusResult, sourceResult, issueResult] = await Promise.all([
    query<InsightsSummaryRow>(
      `WITH owned_documents AS (
         SELECT *
           FROM knowledge_documents
          WHERE knowledge_base_id = $1 AND owner_id = $2
       ), active_documents AS (
         SELECT * FROM owned_documents WHERE status <> 'disabled'
       ), active_chunks AS (
         SELECT chunk.*
           FROM knowledge_document_chunks chunk
           JOIN active_documents document ON document.id = chunk.document_id
       )
       SELECT
         (SELECT count(*)::int FROM owned_documents) AS total_documents,
         (SELECT count(*)::int FROM active_documents) AS active_documents,
         (SELECT count(*)::int FROM active_documents WHERE status = 'ready') AS ready_documents,
         (SELECT count(*)::int FROM active_documents WHERE status = 'pending') AS pending_documents,
         (SELECT count(*)::int FROM active_documents WHERE status = 'processing') AS processing_documents,
         (SELECT count(*)::int FROM active_documents WHERE status = 'failed') AS failed_documents,
         (SELECT count(*)::int FROM owned_documents WHERE status = 'disabled') AS disabled_documents,
         (SELECT count(*)::int FROM active_documents WHERE chunk_count > 0) AS content_documents,
         (SELECT count(*)::int FROM active_documents
           WHERE fastgpt_collection_id IS NOT NULL) AS synced_documents,
         (SELECT count(*)::int FROM active_documents
           WHERE status = 'failed'
              OR (status IN ('pending', 'processing')
                  AND updated_at < CURRENT_TIMESTAMP - INTERVAL '24 hours')
              OR (status = 'ready' AND chunk_count = 0)
              OR fastgpt_collection_id IS NULL) AS issue_documents,
         (SELECT coalesce(sum(chunk_count), 0)::float8 FROM active_documents) AS total_chunks,
         (SELECT coalesce(sum(size_bytes), 0)::float8 FROM active_documents) AS total_bytes,
         (SELECT avg(length(content))::float8 FROM active_chunks) AS average_chunk_characters,
         (SELECT min(length(content))::int FROM active_chunks) AS minimum_chunk_characters,
         (SELECT max(length(content))::int FROM active_chunks) AS maximum_chunk_characters,
         (SELECT count(*) FILTER (WHERE token_count IS NOT NULL)::int
            FROM active_chunks) AS tokenized_chunks,
         (SELECT avg(token_count)::float8 FROM active_chunks
           WHERE token_count IS NOT NULL) AS average_tokens_per_chunk`,
      values,
    ),
    query<InsightsStatusRow>(
      `SELECT status, count(*)::int AS documents
         FROM knowledge_documents
        WHERE knowledge_base_id = $1 AND owner_id = $2
        GROUP BY status
        ORDER BY CASE status
          WHEN 'ready' THEN 1
          WHEN 'processing' THEN 2
          WHEN 'pending' THEN 3
          WHEN 'failed' THEN 4
          ELSE 5
        END`,
      values,
    ),
    query<InsightsSourceRow>(
      `SELECT source_type,
              count(*)::int AS documents,
              count(*) FILTER (WHERE status = 'ready')::int AS ready_documents,
              coalesce(sum(chunk_count), 0)::float8 AS chunks,
              coalesce(sum(size_bytes), 0)::float8 AS total_bytes
         FROM knowledge_documents
        WHERE knowledge_base_id = $1
          AND owner_id = $2
          AND status <> 'disabled'
        GROUP BY source_type
        ORDER BY count(*) DESC, source_type ASC`,
      values,
    ),
    query<InsightsIssueRow>(
      `SELECT id, name, status, source_type, chunk_count, updated_at, error_message,
              (status = 'failed') AS failed,
              (status IN ('pending', 'processing')
                AND updated_at < CURRENT_TIMESTAMP - INTERVAL '24 hours') AS stalled,
              (status = 'ready' AND chunk_count = 0) AS empty,
              (fastgpt_collection_id IS NULL) AS unsynced
         FROM knowledge_documents
        WHERE knowledge_base_id = $1
          AND owner_id = $2
          AND status <> 'disabled'
          AND (
            status = 'failed'
            OR (status IN ('pending', 'processing')
                AND updated_at < CURRENT_TIMESTAMP - INTERVAL '24 hours')
            OR (status = 'ready' AND chunk_count = 0)
            OR fastgpt_collection_id IS NULL
          )
        ORDER BY (status = 'failed') DESC,
                 (status IN ('pending', 'processing')
                   AND updated_at < CURRENT_TIMESTAMP - INTERVAL '24 hours') DESC,
                 (status = 'ready' AND chunk_count = 0) DESC,
                 (fastgpt_collection_id IS NULL) DESC,
                 updated_at ASC,
                 id ASC
        LIMIT 8`,
      values,
    ),
  ]);

  const row = summaryResult.rows[0]!;
  const totalChunks = row.total_chunks;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalDocuments: row.total_documents,
      activeDocuments: row.active_documents,
      readyDocuments: row.ready_documents,
      pendingDocuments: row.pending_documents,
      processingDocuments: row.processing_documents,
      failedDocuments: row.failed_documents,
      disabledDocuments: row.disabled_documents,
      contentDocuments: row.content_documents,
      syncedDocuments: row.synced_documents,
      issueDocuments: row.issue_documents,
      readinessRate: percentage(row.ready_documents, row.active_documents),
      contentCoverageRate: percentage(row.content_documents, row.active_documents),
      syncCoverageRate: percentage(row.synced_documents, row.active_documents),
      totalChunks,
      totalBytes: row.total_bytes,
      averageChunksPerDocument: row.active_documents === 0
        ? 0
        : oneDecimal(totalChunks / row.active_documents),
    },
    chunkQuality: {
      totalChunks,
      averageCharacters: oneDecimal(row.average_chunk_characters ?? 0),
      minimumCharacters: row.minimum_chunk_characters ?? 0,
      maximumCharacters: row.maximum_chunk_characters ?? 0,
      tokenizedChunks: row.tokenized_chunks,
      tokenCoverageRate: percentage(row.tokenized_chunks, totalChunks),
      averageTokens: oneDecimal(row.average_tokens_per_chunk ?? 0),
    },
    statuses: statusResult.rows,
    sources: sourceResult.rows.map((source) => ({
      sourceType: source.source_type,
      documents: source.documents,
      readyDocuments: source.ready_documents,
      chunks: source.chunks,
      totalBytes: source.total_bytes,
    })),
    issues: issueResult.rows.map((issue) => ({
      documentId: issue.id,
      name: issue.name,
      status: issue.status,
      sourceType: issue.source_type,
      chunkCount: issue.chunk_count,
      updatedAt: issue.updated_at.toISOString(),
      errorMessage: issue.error_message,
      reasons: [
        ...(issue.failed ? ['failed' as const] : []),
        ...(issue.stalled ? ['stalled' as const] : []),
        ...(issue.empty ? ['empty' as const] : []),
        ...(issue.unsynced ? ['unsynced' as const] : []),
      ],
    })),
  };
}
