import { isPostgreSqlError } from '../../db/pg-error.js';
import { query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type {
  CreateKnowledgeBaseInput,
  ListKnowledgeBasesQuery,
  UpdateKnowledgeBaseInput,
} from './knowledge-bases.schemas.js';

interface KnowledgeBaseRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  fastgpt_dataset_id: string | null;
  status: 'pending' | 'ready' | 'failed' | 'disabled';
  metadata: Record<string, unknown>;
  attached_app_count: number;
  document_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface KnowledgeBase {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  fastgptDatasetId: string | null;
  status: 'pending' | 'ready' | 'failed' | 'disabled';
  metadata: Record<string, unknown>;
  attachedAppCount: number;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

const knowledgeBaseColumns = `
  kb.id, kb.owner_id, kb.name, kb.description, kb.fastgpt_dataset_id,
  kb.status, kb.metadata, kb.created_at, kb.updated_at,
  count(DISTINCT akb.app_id)::int AS attached_app_count,
  count(DISTINCT doc.id)::int AS document_count
`;

const knowledgeBaseSortExpressions: Record<ListKnowledgeBasesQuery['sort'], string> = {
  updated_desc: 'kb.updated_at DESC, kb.id DESC',
  created_desc: 'kb.created_at DESC, kb.id DESC',
  name_asc: 'kb.name ASC, kb.id ASC',
};

function mapKnowledgeBase(row: KnowledgeBaseRow): KnowledgeBase {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    fastgptDatasetId: row.fastgpt_dataset_id,
    status: row.status,
    metadata: row.metadata,
    attachedAppCount: row.attached_app_count,
    documentCount: row.document_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function duplicateNameError(error: unknown): never {
  if (isPostgreSqlError(error) && error.code === '23505') {
    throw new AppError(409, 'KNOWLEDGE_BASE_NAME_ALREADY_EXISTS', '你已经创建过同名知识库');
  }
  throw error;
}

export async function createKnowledgeBase(
  ownerId: string,
  input: CreateKnowledgeBaseInput,
): Promise<KnowledgeBase> {
  try {
    const result = await query<KnowledgeBaseRow>(
      `WITH inserted AS (
         INSERT INTO knowledge_bases (
           owner_id, name, description, fastgpt_dataset_id, status, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING *
       )
       SELECT inserted.id, inserted.owner_id, inserted.name, inserted.description,
              inserted.fastgpt_dataset_id, inserted.status, inserted.metadata,
              inserted.created_at, inserted.updated_at,
              0::int AS attached_app_count, 0::int AS document_count
         FROM inserted`,
      [
        ownerId,
        input.name,
        input.description ?? null,
        input.fastgptDatasetId ?? null,
        input.status,
        JSON.stringify(input.metadata),
      ],
    );
    return mapKnowledgeBase(result.rows[0]!);
  } catch (error) {
    return duplicateNameError(error);
  }
}

export async function listKnowledgeBases(
  ownerId: string,
  input: ListKnowledgeBasesQuery,
): Promise<{ items: KnowledgeBase[]; page: number; pageSize: number; total: number }> {
  const offset = (input.page - 1) * input.pageSize;
  const filterValues = [ownerId, input.status ?? null, input.search || null];
  const orderBy = knowledgeBaseSortExpressions[input.sort];
  const [itemsResult, countResult] = await Promise.all([
    query<KnowledgeBaseRow>(
      `SELECT ${knowledgeBaseColumns}
         FROM knowledge_bases kb
         LEFT JOIN app_knowledge_bases akb ON akb.knowledge_base_id = kb.id
         LEFT JOIN knowledge_documents doc ON doc.knowledge_base_id = kb.id
        WHERE kb.owner_id = $1
          AND ($2::varchar IS NULL OR kb.status = $2)
          AND (
            $3::varchar IS NULL
            OR kb.name ILIKE '%' || $3 || '%'
            OR coalesce(kb.description, '') ILIKE '%' || $3 || '%'
          )
        GROUP BY kb.id
        ORDER BY ${orderBy}
        LIMIT $4 OFFSET $5`,
      [...filterValues, input.pageSize, offset],
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM knowledge_bases kb
        WHERE kb.owner_id = $1
          AND ($2::varchar IS NULL OR kb.status = $2)
          AND (
            $3::varchar IS NULL
            OR kb.name ILIKE '%' || $3 || '%'
            OR coalesce(kb.description, '') ILIKE '%' || $3 || '%'
          )`,
      filterValues,
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapKnowledgeBase),
    page: input.page,
    pageSize: input.pageSize,
    total: countResult.rows[0]?.total ?? 0,
  };
}

export interface KnowledgeBaseStats {
  total: number;
  ready: number;
  pending: number;
  failed: number;
  disabled: number;
  appBindings: number;
}

export async function getKnowledgeBaseStats(ownerId: string): Promise<KnowledgeBaseStats> {
  const result = await query<KnowledgeBaseStats>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE kb.status = 'ready')::int AS ready,
            count(*) FILTER (WHERE kb.status = 'pending')::int AS pending,
            count(*) FILTER (WHERE kb.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE kb.status = 'disabled')::int AS disabled,
            (
              SELECT count(*)::int
                FROM app_knowledge_bases link
                JOIN knowledge_bases owned_kb ON owned_kb.id = link.knowledge_base_id
               WHERE owned_kb.owner_id = $1
            ) AS "appBindings"
       FROM knowledge_bases kb
      WHERE kb.owner_id = $1`,
    [ownerId],
  );
  return result.rows[0] ?? {
    total: 0,
    ready: 0,
    pending: 0,
    failed: 0,
    disabled: 0,
    appBindings: 0,
  };
}

export async function getKnowledgeBase(
  ownerId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeBase> {
  const result = await query<KnowledgeBaseRow>(
    `SELECT ${knowledgeBaseColumns}
       FROM knowledge_bases kb
       LEFT JOIN app_knowledge_bases akb ON akb.knowledge_base_id = kb.id
       LEFT JOIN knowledge_documents doc ON doc.knowledge_base_id = kb.id
      WHERE kb.id = $1 AND kb.owner_id = $2
      GROUP BY kb.id`,
    [knowledgeBaseId, ownerId],
  );
  const knowledgeBase = result.rows[0];

  if (!knowledgeBase) {
    throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
  }
  return mapKnowledgeBase(knowledgeBase);
}

export async function updateKnowledgeBase(
  ownerId: string,
  knowledgeBaseId: string,
  input: UpdateKnowledgeBaseInput,
): Promise<KnowledgeBase> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const addAssignment = (column: string, value: unknown, cast = '') => {
    values.push(value);
    assignments.push(`${column} = $${values.length}${cast}`);
  };

  if (input.name !== undefined) addAssignment('name', input.name);
  if ('description' in input) addAssignment('description', input.description ?? null);
  if ('fastgptDatasetId' in input) {
    addAssignment('fastgpt_dataset_id', input.fastgptDatasetId ?? null);
  }
  if (input.status !== undefined) addAssignment('status', input.status);
  if (input.metadata !== undefined) {
    addAssignment('metadata', JSON.stringify(input.metadata), '::jsonb');
  }

  values.push(knowledgeBaseId, ownerId);

  try {
    const updateResult = await query<{ id: string }>(
      `UPDATE knowledge_bases
          SET ${assignments.join(', ')}
        WHERE id = $${values.length - 1}
          AND owner_id = $${values.length}
      RETURNING id`,
      values,
    );
    if (!updateResult.rows[0]) {
      throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
    }
    return getKnowledgeBase(ownerId, knowledgeBaseId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    return duplicateNameError(error);
  }
}

export async function disableKnowledgeBase(
  ownerId: string,
  knowledgeBaseId: string,
): Promise<void> {
  const result = await query(
    `UPDATE knowledge_bases
        SET status = 'disabled'
      WHERE id = $1 AND owner_id = $2`,
    [knowledgeBaseId, ownerId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
  }
}

export async function attachKnowledgeBaseToApp(
  ownerId: string,
  appId: string,
  knowledgeBaseId: string,
): Promise<void> {
  const result = await query(
    `INSERT INTO app_knowledge_bases (app_id, knowledge_base_id, owner_id)
     SELECT app.id, kb.id, $1
       FROM ai_apps app
       JOIN knowledge_bases kb ON kb.id = $3 AND kb.owner_id = $1
      WHERE app.id = $2 AND app.owner_id = $1
     ON CONFLICT (app_id, knowledge_base_id)
     DO UPDATE SET owner_id = EXCLUDED.owner_id
     RETURNING app_id`,
    [ownerId, appId, knowledgeBaseId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'APP_OR_KNOWLEDGE_BASE_NOT_FOUND', '应用或知识库不存在');
  }
}

export async function detachKnowledgeBaseFromApp(
  ownerId: string,
  appId: string,
  knowledgeBaseId: string,
): Promise<void> {
  await query(
    `DELETE FROM app_knowledge_bases
      WHERE app_id = $1
        AND knowledge_base_id = $2
        AND owner_id = $3`,
    [appId, knowledgeBaseId, ownerId],
  );
}

export async function listAppKnowledgeBases(
  ownerId: string,
  appId: string,
): Promise<KnowledgeBase[]> {
  const appResult = await query<{ id: string }>(
    'SELECT id FROM ai_apps WHERE id = $1 AND owner_id = $2',
    [appId, ownerId],
  );
  if (!appResult.rows[0]) {
    throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
  }

  const result = await query<KnowledgeBaseRow>(
    `SELECT ${knowledgeBaseColumns}
       FROM app_knowledge_bases owned_link
       JOIN knowledge_bases kb ON kb.id = owned_link.knowledge_base_id
       LEFT JOIN app_knowledge_bases akb ON akb.knowledge_base_id = kb.id
       LEFT JOIN knowledge_documents doc ON doc.knowledge_base_id = kb.id
      WHERE owned_link.app_id = $1 AND owned_link.owner_id = $2
      GROUP BY kb.id
      ORDER BY kb.name`,
    [appId, ownerId],
  );
  return result.rows.map(mapKnowledgeBase);
}

export interface KnowledgeBaseLinkedApp {
  id: string;
  name: string;
  description: string | null;
  fastgptAppId: string | null;
  status: 'draft' | 'active' | 'disabled';
  attachedAt: string;
}

export async function listKnowledgeBaseApps(
  ownerId: string,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseLinkedApp[]> {
  const knowledgeBaseResult = await query<{ id: string }>(
    'SELECT id FROM knowledge_bases WHERE id = $1 AND owner_id = $2',
    [knowledgeBaseId, ownerId],
  );
  if (!knowledgeBaseResult.rows[0]) {
    throw new AppError(404, 'KNOWLEDGE_BASE_NOT_FOUND', '知识库不存在');
  }

  const result = await query<{
    id: string;
    name: string;
    description: string | null;
    fastgpt_app_id: string | null;
    status: 'draft' | 'active' | 'disabled';
    attached_at: Date;
  }>(
    `SELECT app.id, app.name, app.description, app.fastgpt_app_id,
            app.status, link.attached_at
       FROM app_knowledge_bases link
       JOIN ai_apps app ON app.id = link.app_id
      WHERE link.knowledge_base_id = $1
        AND link.owner_id = $2
      ORDER BY app.name`,
    [knowledgeBaseId, ownerId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    fastgptAppId: row.fastgpt_app_id,
    status: row.status,
    attachedAt: row.attached_at.toISOString(),
  }));
}
