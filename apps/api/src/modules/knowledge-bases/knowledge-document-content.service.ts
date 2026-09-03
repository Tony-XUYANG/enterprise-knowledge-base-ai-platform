import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { isPostgreSqlError } from '../../db/pg-error.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type {
  BatchImportKnowledgeDocumentsInput,
  ImportKnowledgeDocumentContentInput,
} from './knowledge-document-content.schemas.js';
import {
  type KnowledgeDocument,
  type KnowledgeDocumentRow,
  knowledgeDocumentColumns,
  mapKnowledgeDocument,
} from './knowledge-documents.service.js';
import { normalizeDocumentText, splitDocumentText } from './text-chunker.js';

const previewLimit = 5;
const maxBatchImportedChunkCount = 5000;

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

export interface BatchDocumentContentImportResult {
  items: KnowledgeDocument[];
  totalFiles: number;
  totalChunks: number;
  totalBytes: number;
}

function createSummary(content: string, chunks: string[]): DocumentContentSummary {
  const normalizedContent = normalizeDocumentText(content);
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
  const normalizedContent = normalizeDocumentText(input.content);
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

export async function batchImportKnowledgeDocuments(
  ownerId: string,
  knowledgeBaseId: string,
  input: BatchImportKnowledgeDocumentsInput,
): Promise<BatchDocumentContentImportResult> {
  const ownedKnowledgeBase = await query(
    'SELECT 1 FROM knowledge_bases WHERE id = $1 AND owner_id = $2',
    [knowledgeBaseId, ownerId],
  );
  if (!ownedKnowledgeBase.rows[0]) {
    throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
  }

  const preparedFiles = input.files.map((file) => {
    const normalizedContent = normalizeDocumentText(file.content);
    const chunks = splitDocumentText(
      normalizedContent,
      input.chunkSize,
      input.chunkOverlap,
    );
    return {
      name: file.name,
      mimeType: file.mimeType,
      chunks,
      sizeBytes: Buffer.byteLength(normalizedContent, 'utf8'),
      checksumSha256: createHash('sha256')
        .update(normalizedContent, 'utf8')
        .digest('hex'),
    };
  });
  const totalChunks = preparedFiles.reduce(
    (total, file) => total + file.chunks.length,
    0,
  );
  if (totalChunks > maxBatchImportedChunkCount) {
    throw new AppError(
      400,
      'DOCUMENT_BATCH_CHUNK_LIMIT_EXCEEDED',
      `批量导入结果不能超过 ${maxBatchImportedChunkCount} 个分块，请增大分块长度或减少文件数量`,
    );
  }

  try {
    return await withTransaction(async (client) => {
      const knowledgeBaseResult = await client.query(
        `SELECT 1
           FROM knowledge_bases
          WHERE id = $1 AND owner_id = $2
          FOR KEY SHARE`,
        [knowledgeBaseId, ownerId],
      );
      if (!knowledgeBaseResult.rows[0]) {
        throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
      }

      const items: KnowledgeDocument[] = [];
      for (const file of preparedFiles) {
        const documentResult = await client.query<{ id: string }>(
          `INSERT INTO knowledge_documents (
             knowledge_base_id, owner_id, name, source_type, source_uri,
             mime_type, size_bytes, checksum_sha256, fastgpt_collection_id,
             status, chunk_count, error_message, metadata
           ) VALUES (
             $1, $2, $3, 'file', NULL, $4, $5, $6, NULL,
             'ready', 0, NULL, $7::jsonb
           )
           RETURNING id`,
          [
            knowledgeBaseId,
            ownerId,
            file.name,
            file.mimeType,
            file.sizeBytes,
            file.checksumSha256,
            JSON.stringify({
              importMethod: 'batch_text_files',
              chunkSize: input.chunkSize,
              chunkOverlap: input.chunkOverlap,
            }),
          ],
        );
        const documentId = documentResult.rows[0]!.id;

        await client.query(
          `INSERT INTO knowledge_document_chunks (
             document_id, knowledge_base_id, owner_id, position, content, metadata
           )
           SELECT $1, $2, $3, imported.ordinality::integer, imported.content,
                  jsonb_build_object(
                    'source', 'batch_content_import',
                    'chunkSize', $5::integer,
                    'chunkOverlap', $6::integer
                  )
             FROM unnest($4::text[]) WITH ORDINALITY AS imported(content, ordinality)`,
          [
            documentId,
            knowledgeBaseId,
            ownerId,
            file.chunks,
            input.chunkSize,
            input.chunkOverlap,
          ],
        );

        const importedDocument = await client.query<KnowledgeDocumentRow>(
          `SELECT ${knowledgeDocumentColumns}
             FROM knowledge_documents
            WHERE id = $1`,
          [documentId],
        );
        items.push(mapKnowledgeDocument(importedDocument.rows[0]!));
      }

      return {
        items,
        totalFiles: items.length,
        totalChunks,
        totalBytes: preparedFiles.reduce((total, file) => total + file.sizeBytes, 0),
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isPostgreSqlError(error) && error.code === '23505') {
      throw new AppError(409, 'DOCUMENT_NAME_ALREADY_EXISTS', '知识库中已存在同名文档');
    }
    throw error;
  }
}
