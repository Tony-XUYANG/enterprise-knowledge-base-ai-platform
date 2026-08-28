import { isPostgreSqlError } from '../../db/pg-error.js';
import { query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type {
  CreateKnowledgeDocumentInput,
  ListKnowledgeDocumentsQuery,
  UpdateKnowledgeDocumentInput,
} from './knowledge-documents.schemas.js';

interface KnowledgeDocumentRow {
  id: string;
  knowledge_base_id: string;
  owner_id: string;
  name: string;
  source_type: 'file' | 'url' | 'text';
  source_uri: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  checksum_sha256: string | null;
  fastgpt_collection_id: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'disabled';
  chunk_count: number;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  ownerId: string;
  name: string;
  sourceType: 'file' | 'url' | 'text';
  sourceUri: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksumSha256: string | null;
  fastgptCollectionId: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed' | 'disabled';
  chunkCount: number;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const documentColumns = `
  id, knowledge_base_id, owner_id, name, source_type, source_uri,
  mime_type, size_bytes, checksum_sha256, fastgpt_collection_id,
  status, chunk_count, error_message, metadata, created_at, updated_at
`;

const documentSortExpressions: Record<ListKnowledgeDocumentsQuery['sort'], string> = {
  updated_desc: 'updated_at DESC, id DESC',
  created_desc: 'created_at DESC, id DESC',
  name_asc: 'name ASC, id ASC',
};

function mapDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    ownerId: row.owner_id,
    name: row.name,
    sourceType: row.source_type,
    sourceUri: row.source_uri,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    fastgptCollectionId: row.fastgpt_collection_id,
    status: row.status,
    chunkCount: row.chunk_count,
    errorMessage: row.error_message,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function ensureOwnedKnowledgeBase(ownerId: string, knowledgeBaseId: string): Promise<void> {
  const result = await query(
    'SELECT 1 FROM knowledge_bases WHERE id = $1 AND owner_id = $2',
    [knowledgeBaseId, ownerId],
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
  }
}

function documentWriteError(error: unknown): never {
  if (isPostgreSqlError(error)) {
    if (error.code === '23505') {
      throw new AppError(409, 'DOCUMENT_NAME_ALREADY_EXISTS', '知识库中已存在同名文档');
    }
    if (
      error.code === '23514' &&
      error.constraint === 'knowledge_documents_url_source_check'
    ) {
      throw new AppError(400, 'DOCUMENT_SOURCE_URI_REQUIRED', 'URL 来源必须提供来源地址');
    }
  }
  throw error;
}

export async function createKnowledgeDocument(
  ownerId: string,
  knowledgeBaseId: string,
  input: CreateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  try {
    const result = await query<KnowledgeDocumentRow>(
      `WITH owned AS (
         SELECT id, owner_id
           FROM knowledge_bases
          WHERE id = $1 AND owner_id = $2
       ), inserted AS (
         INSERT INTO knowledge_documents (
           knowledge_base_id, owner_id, name, source_type, source_uri,
           mime_type, size_bytes, checksum_sha256, fastgpt_collection_id,
           status, chunk_count, error_message, metadata
         )
         SELECT owned.id, owned.owner_id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
           FROM owned
         RETURNING ${documentColumns}
       )
       SELECT * FROM inserted`,
      [
        knowledgeBaseId,
        ownerId,
        input.name,
        input.sourceType,
        input.sourceUri ?? null,
        input.mimeType ?? null,
        input.sizeBytes ?? null,
        input.checksumSha256 ?? null,
        input.fastgptCollectionId ?? null,
        input.status,
        0,
        input.errorMessage ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    const document = result.rows[0];
    if (!document) {
      throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
    }
    return mapDocument(document);
  } catch (error) {
    if (error instanceof AppError) throw error;
    return documentWriteError(error);
  }
}

export async function listKnowledgeDocuments(
  ownerId: string,
  knowledgeBaseId: string,
  input: ListKnowledgeDocumentsQuery,
): Promise<{ items: KnowledgeDocument[]; page: number; pageSize: number; total: number }> {
  await ensureOwnedKnowledgeBase(ownerId, knowledgeBaseId);
  const offset = (input.page - 1) * input.pageSize;
  const values = [knowledgeBaseId, ownerId, input.status ?? null, input.search || null];
  const orderBy = documentSortExpressions[input.sort];
  const [itemsResult, countResult] = await Promise.all([
    query<KnowledgeDocumentRow>(
      `SELECT ${documentColumns}
         FROM knowledge_documents
        WHERE knowledge_base_id = $1
          AND owner_id = $2
          AND ($3::varchar IS NULL OR status = $3)
          AND (
            $4::varchar IS NULL
            OR name ILIKE '%' || $4 || '%'
            OR coalesce(source_uri, '') ILIKE '%' || $4 || '%'
            OR coalesce(fastgpt_collection_id, '') ILIKE '%' || $4 || '%'
          )
        ORDER BY ${orderBy}
        LIMIT $5 OFFSET $6`,
      [...values, input.pageSize, offset],
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM knowledge_documents
        WHERE knowledge_base_id = $1
          AND owner_id = $2
          AND ($3::varchar IS NULL OR status = $3)
          AND (
            $4::varchar IS NULL
            OR name ILIKE '%' || $4 || '%'
            OR coalesce(source_uri, '') ILIKE '%' || $4 || '%'
            OR coalesce(fastgpt_collection_id, '') ILIKE '%' || $4 || '%'
          )`,
      values,
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapDocument),
    page: input.page,
    pageSize: input.pageSize,
    total: countResult.rows[0]?.total ?? 0,
  };
}

export interface KnowledgeDocumentStats {
  total: number;
  ready: number;
  processing: number;
  pending: number;
  failed: number;
  disabled: number;
  chunks: number;
  totalBytes: number;
}

export async function getKnowledgeDocumentStats(
  ownerId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeDocumentStats> {
  await ensureOwnedKnowledgeBase(ownerId, knowledgeBaseId);
  const result = await query<KnowledgeDocumentStats>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'ready')::int AS ready,
            count(*) FILTER (WHERE status = 'processing')::int AS processing,
            count(*) FILTER (WHERE status = 'pending')::int AS pending,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            count(*) FILTER (WHERE status = 'disabled')::int AS disabled,
            coalesce(sum(chunk_count), 0)::float8 AS chunks,
            coalesce(sum(size_bytes), 0)::float8 AS "totalBytes"
       FROM knowledge_documents
      WHERE knowledge_base_id = $1 AND owner_id = $2`,
    [knowledgeBaseId, ownerId],
  );
  return result.rows[0]!;
}

export async function updateKnowledgeDocument(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
  input: UpdateKnowledgeDocumentInput,
): Promise<KnowledgeDocument> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const addAssignment = (column: string, value: unknown, cast = '') => {
    values.push(value);
    assignments.push(`${column} = $${values.length}${cast}`);
  };

  if (input.name !== undefined) addAssignment('name', input.name);
  if (input.sourceType !== undefined) addAssignment('source_type', input.sourceType);
  if ('sourceUri' in input) addAssignment('source_uri', input.sourceUri ?? null);
  if ('mimeType' in input) addAssignment('mime_type', input.mimeType ?? null);
  if ('sizeBytes' in input) addAssignment('size_bytes', input.sizeBytes ?? null);
  if ('checksumSha256' in input) addAssignment('checksum_sha256', input.checksumSha256 ?? null);
  if ('fastgptCollectionId' in input) {
    addAssignment('fastgpt_collection_id', input.fastgptCollectionId ?? null);
  }
  if (input.status !== undefined) addAssignment('status', input.status);
  if ('errorMessage' in input) addAssignment('error_message', input.errorMessage ?? null);
  if (input.metadata !== undefined) {
    addAssignment('metadata', JSON.stringify(input.metadata), '::jsonb');
  }

  values.push(documentId, knowledgeBaseId, ownerId);
  try {
    const result = await query<KnowledgeDocumentRow>(
      `UPDATE knowledge_documents
          SET ${assignments.join(', ')}
        WHERE id = $${values.length - 2}
          AND knowledge_base_id = $${values.length - 1}
          AND owner_id = $${values.length}
      RETURNING ${documentColumns}`,
      values,
    );
    const document = result.rows[0];
    if (!document) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
    }
    return mapDocument(document);
  } catch (error) {
    if (error instanceof AppError) throw error;
    return documentWriteError(error);
  }
}

export async function disableKnowledgeDocument(
  ownerId: string,
  knowledgeBaseId: string,
  documentId: string,
): Promise<void> {
  const result = await query(
    `UPDATE knowledge_documents
        SET status = 'disabled'
      WHERE id = $1 AND knowledge_base_id = $2 AND owner_id = $3`,
    [documentId, knowledgeBaseId, ownerId],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
  }
}
