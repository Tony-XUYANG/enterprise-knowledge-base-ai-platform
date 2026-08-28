import { query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type { SearchKnowledgeBaseInput } from './knowledge-base-search.schemas.js';

interface KnowledgeBaseSearchRow {
  chunk_id: string;
  document_id: string;
  document_name: string;
  source_type: 'file' | 'url' | 'text';
  mime_type: string | null;
  position: number;
  content: string;
  token_count: number | null;
  score: number;
  exact_match: boolean;
}

export interface KnowledgeBaseSearchResultItem {
  chunkId: string;
  documentId: string;
  documentName: string;
  sourceType: 'file' | 'url' | 'text';
  mimeType: string | null;
  position: number;
  content: string;
  tokenCount: number | null;
  score: number;
  matchType: 'exact' | 'fuzzy';
}

export interface KnowledgeBaseSearchResult {
  query: string;
  items: KnowledgeBaseSearchResultItem[];
  searchedChunks: number;
  durationMs: number;
}

export async function searchKnowledgeBase(
  ownerId: string,
  knowledgeBaseId: string,
  input: SearchKnowledgeBaseInput,
): Promise<KnowledgeBaseSearchResult> {
  const startedAt = performance.now();
  const knowledgeBaseResult = await query(
    'SELECT 1 FROM knowledge_bases WHERE id = $1 AND owner_id = $2',
    [knowledgeBaseId, ownerId],
  );
  if (!knowledgeBaseResult.rows[0]) {
    throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
  }

  const [matchesResult, countResult] = await Promise.all([
    query<KnowledgeBaseSearchRow>(
      `WITH ranked AS (
         SELECT chunk.id AS chunk_id,
                document.id AS document_id,
                document.name AS document_name,
                document.source_type,
                document.mime_type,
                chunk.position,
                chunk.content,
                chunk.token_count,
                chunk.content ILIKE '%' || $3 || '%' AS exact_match,
                GREATEST(
                  CASE WHEN chunk.content ILIKE '%' || $3 || '%' THEN 1.0 ELSE 0.0 END,
                  word_similarity($3, chunk.content),
                  similarity(chunk.content, $3)
                )::float8 AS score
           FROM knowledge_document_chunks chunk
           JOIN knowledge_documents document ON document.id = chunk.document_id
          WHERE chunk.knowledge_base_id = $1
            AND chunk.owner_id = $2
            AND document.status = 'ready'
       )
       SELECT chunk_id, document_id, document_name, source_type, mime_type,
              position, content, token_count, score, exact_match
         FROM ranked
        WHERE score >= $4
        ORDER BY score DESC, document_name ASC, position ASC, chunk_id ASC
        LIMIT $5`,
      [knowledgeBaseId, ownerId, input.query, input.minScore, input.limit],
    ),
    query<{ searched_chunks: number }>(
      `SELECT count(*)::int AS searched_chunks
         FROM knowledge_document_chunks chunk
         JOIN knowledge_documents document ON document.id = chunk.document_id
        WHERE chunk.knowledge_base_id = $1
          AND chunk.owner_id = $2
          AND document.status = 'ready'`,
      [knowledgeBaseId, ownerId],
    ),
  ]);

  return {
    query: input.query,
    items: matchesResult.rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentName: row.document_name,
      sourceType: row.source_type,
      mimeType: row.mime_type,
      position: row.position,
      content: row.content,
      tokenCount: row.token_count,
      score: Number(row.score.toFixed(4)),
      matchType: row.exact_match ? 'exact' : 'fuzzy',
    })),
    searchedChunks: countResult.rows[0]?.searched_chunks ?? 0,
    durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
  };
}
