import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type {
  CreateKnowledgeDocumentChunkInput,
  ListKnowledgeDocumentChunksQuery,
  UpdateKnowledgeDocumentChunkInput,
} from './knowledge-document-chunks.schemas.js';

interface KnowledgeDocumentChunkRow {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  owner_id: string;
  position: number;
  content: string;
  token_count: number | null;
  fastgpt_data_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface KnowledgeDocumentChunk {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  ownerId: string;
  position: number;
  content: string;
  tokenCount: number | null;
  fastgptDataId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const chunkColumns = `
  id, document_id, knowledge_base_id, owner_id, position, content,
  token_count, fastgpt_data_id, metadata, created_at, updated_at
`;

function mapChunk(row: KnowledgeDocumentChunkRow): KnowledgeDocumentChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    knowledgeBaseId: row.knowledge_base_id,
    ownerId: row.owner_id,
    position: row.position,
    content: row.content,
    tokenCount: row.token_count,
    fastgptDataId: row.fastgpt_data_id,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function lockOwnedDocument(
  client: PoolClient,
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM knowledge_documents
      WHERE id = $1 AND knowledge_base_id = $2 AND owner_id = $3
      FOR UPDATE`,
    [documentId, knowledgeBaseId, ownerId],
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
  }
}

async function ensureOwnedDocument(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
): Promise<void> {
  const result = await query(
    `SELECT 1
       FROM knowledge_documents
      WHERE id = $1 AND knowledge_base_id = $2 AND owner_id = $3`,
    [documentId, knowledgeBaseId, ownerId],
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
  }
}

export async function createKnowledgeDocumentChunk(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
  input: CreateKnowledgeDocumentChunkInput,
): Promise<KnowledgeDocumentChunk> {
  return withTransaction(async (client) => {
    await lockOwnedDocument(client, ownerId, knowledgeBaseId, documentId);
    const positionResult = await client.query<{ next_position: number }>(
      `SELECT coalesce(max(position), 0)::integer + 1 AS next_position
         FROM knowledge_document_chunks
        WHERE document_id = $1`,
      [documentId],
    );
    const result = await client.query<KnowledgeDocumentChunkRow>(
      `INSERT INTO knowledge_document_chunks (
         document_id, knowledge_base_id, owner_id, position, content,
         token_count, fastgpt_data_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING ${chunkColumns}`,
      [
        documentId,
        knowledgeBaseId,
        ownerId,
        positionResult.rows[0]!.next_position,
        input.content,
        input.tokenCount ?? null,
        input.fastgptDataId ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    return mapChunk(result.rows[0]!);
  });
}

export async function listKnowledgeDocumentChunks(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
  input: ListKnowledgeDocumentChunksQuery,
): Promise<{ items: KnowledgeDocumentChunk[]; page: number; pageSize: number; total: number }> {
  await ensureOwnedDocument(ownerId, knowledgeBaseId, documentId);
  const offset = (input.page - 1) * input.pageSize;
  const values = [documentId, knowledgeBaseId, ownerId, input.search || null];
  const [itemsResult, countResult] = await Promise.all([
    query<KnowledgeDocumentChunkRow>(
      `SELECT ${chunkColumns}
         FROM knowledge_document_chunks
        WHERE document_id = $1
          AND knowledge_base_id = $2
          AND owner_id = $3
          AND (
            $4::varchar IS NULL
            OR content ILIKE '%' || $4 || '%'
            OR coalesce(fastgpt_data_id, '') ILIKE '%' || $4 || '%'
            OR to_tsvector('simple', content) @@ plainto_tsquery('simple', $4)
          )
        ORDER BY position
        LIMIT $5 OFFSET $6`,
      [...values, input.pageSize, offset],
    ),
    query<{ total: number }>(
      `SELECT count(*)::integer AS total
         FROM knowledge_document_chunks
        WHERE document_id = $1
          AND knowledge_base_id = $2
          AND owner_id = $3
          AND (
            $4::varchar IS NULL
            OR content ILIKE '%' || $4 || '%'
            OR coalesce(fastgpt_data_id, '') ILIKE '%' || $4 || '%'
            OR to_tsvector('simple', content) @@ plainto_tsquery('simple', $4)
          )`,
      values,
    ),
  ]);
  return {
    items: itemsResult.rows.map(mapChunk),
    page: input.page,
    pageSize: input.pageSize,
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function updateKnowledgeDocumentChunk(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  input: UpdateKnowledgeDocumentChunkInput,
): Promise<KnowledgeDocumentChunk> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const addAssignment = (column: string, value: unknown, cast = '') => {
    values.push(value);
    assignments.push(`${column} = $${values.length}${cast}`);
  };
  if (input.content !== undefined) addAssignment('content', input.content);
  if ('tokenCount' in input) addAssignment('token_count', input.tokenCount ?? null);
  if ('fastgptDataId' in input) addAssignment('fastgpt_data_id', input.fastgptDataId ?? null);
  if (input.metadata !== undefined) {
    addAssignment('metadata', JSON.stringify(input.metadata), '::jsonb');
  }
  values.push(chunkId, documentId, knowledgeBaseId, ownerId);

  const result = await query<KnowledgeDocumentChunkRow>(
    `UPDATE knowledge_document_chunks
        SET ${assignments.join(', ')}
      WHERE id = $${values.length - 3}
        AND document_id = $${values.length - 2}
        AND knowledge_base_id = $${values.length - 1}
        AND owner_id = $${values.length}
    RETURNING ${chunkColumns}`,
    values,
  );
  const chunk = result.rows[0];
  if (!chunk) {
    throw new AppError(404, 'DOCUMENT_CHUNK_NOT_FOUND', '文档分块不存在');
  }
  return mapChunk(chunk);
}

export async function deleteKnowledgeDocumentChunk(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await lockOwnedDocument(client, ownerId, knowledgeBaseId, documentId);
    const result = await client.query<{ position: number }>(
      `DELETE FROM knowledge_document_chunks
        WHERE id = $1
          AND document_id = $2
          AND knowledge_base_id = $3
          AND owner_id = $4
      RETURNING position`,
      [chunkId, documentId, knowledgeBaseId, ownerId],
    );
    const deleted = result.rows[0];
    if (!deleted) {
      throw new AppError(404, 'DOCUMENT_CHUNK_NOT_FOUND', '文档分块不存在');
    }
    await client.query(
      `UPDATE knowledge_document_chunks
          SET position = position - 1
        WHERE document_id = $1 AND position > $2`,
      [documentId, deleted.position],
    );
  });
}
