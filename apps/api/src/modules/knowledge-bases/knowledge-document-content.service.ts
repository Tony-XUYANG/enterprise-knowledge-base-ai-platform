import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type { ImportKnowledgeDocumentContentInput } from './knowledge-document-content.schemas.js';
import {
  type KnowledgeDocument,
  type KnowledgeDocumentRow,
  knowledgeDocumentColumns,
  mapKnowledgeDocument,
} from './knowledge-documents.service.js';
import { splitDocumentText } from './text-chunker.js';

const previewLimit = 5;

export interface DocumentContentChunkPreview {
  position: number;
  content: string;
  characterCount: number;
}

export interface DocumentContentSummary {
  chunkCount: number;
  totalCharacters: number;
  sizeBytes: number;
  chunks: DocumentContentChunkPreview[];
  previewTruncated: boolean;
}

export interface DocumentContentImportResult {
  document: KnowledgeDocument;
  summary: DocumentContentSummary;
}

function createSummary(content: string, chunks: string[]): DocumentContentSummary {
  const normalizedContent = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  return {
    chunkCount: chunks.length,
    totalCharacters: normalizedContent.length,
    sizeBytes: Buffer.byteLength(normalizedContent, 'utf8'),
    chunks: chunks.slice(0, previewLimit).map((chunk, index) => ({
      position: index + 1,
      content: chunk,
      characterCount: chunk.length,
    })),
    previewTruncated: chunks.length > previewLimit,
  };
}

async function ensureOwnedDocument(
  client: Pick<PoolClient, 'query'>,
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
  lock = false,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM knowledge_documents
      WHERE id = $1 AND knowledge_base_id = $2 AND owner_id = $3
      ${lock ? 'FOR UPDATE' : ''}`,
    [documentId, knowledgeBaseId, ownerId],
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
  }
}

export async function previewKnowledgeDocumentContent(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
  input: ImportKnowledgeDocumentContentInput,
): Promise<DocumentContentSummary> {
  const documentResult = await query(
    `SELECT 1
       FROM knowledge_documents
      WHERE id = $1 AND knowledge_base_id = $2 AND owner_id = $3`,
    [documentId, knowledgeBaseId, ownerId],
  );
  if (!documentResult.rows[0]) {
    throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
  }
  const chunks = splitDocumentText(input.content, input.chunkSize, input.chunkOverlap);
  return createSummary(input.content, chunks);
}

export async function importKnowledgeDocumentContent(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
  input: ImportKnowledgeDocumentContentInput,
): Promise<DocumentContentImportResult> {
  const chunks = splitDocumentText(input.content, input.chunkSize, input.chunkOverlap);
  const summary = createSummary(input.content, chunks);
  const normalizedContent = input.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const checksumSha256 = createHash('sha256').update(normalizedContent, 'utf8').digest('hex');

  return withTransaction(async (client) => {
    await ensureOwnedDocument(client, ownerId, knowledgeBaseId, documentId, true);
    await client.query('DELETE FROM knowledge_document_chunks WHERE document_id = $1', [documentId]);
    await client.query(
      `INSERT INTO knowledge_document_chunks (
         document_id, knowledge_base_id, owner_id, position, content, metadata
       )
       SELECT $1, $2, $3, imported.ordinality::integer, imported.content,
              jsonb_build_object(
                'source', 'content_import',
                'chunkSize', $5::integer,
                'chunkOverlap', $6::integer
              )
         FROM unnest($4::text[]) WITH ORDINALITY AS imported(content, ordinality)`,
      [documentId, knowledgeBaseId, ownerId, chunks, input.chunkSize, input.chunkOverlap],
    );
    const documentResult = await client.query<KnowledgeDocumentRow>(
      `UPDATE knowledge_documents
          SET mime_type = $1,
              size_bytes = $2,
              checksum_sha256 = $3,
              status = 'ready',
              error_message = NULL
        WHERE id = $4 AND knowledge_base_id = $5 AND owner_id = $6
      RETURNING ${knowledgeDocumentColumns}`,
      [input.mimeType, summary.sizeBytes, checksumSha256, documentId, knowledgeBaseId, ownerId],
    );

    return {
      document: mapKnowledgeDocument(documentResult.rows[0]!),
      summary,
    };
  });
}
