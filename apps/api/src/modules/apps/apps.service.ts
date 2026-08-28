import { isPostgreSqlError } from '../../db/pg-error.js';
import { query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { encryptSecret } from '../../security/secret-encryption.js';
import type { CreateAppInput, ListAppsQuery, UpdateAppInput } from './apps.schemas.js';

interface AppRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  fastgpt_app_id: string | null;
  has_fastgpt_api_key: boolean;
  settings: Record<string, unknown>;
  status: 'draft' | 'active' | 'disabled';
  attached_knowledge_base_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface AiApp {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  fastgptAppId: string | null;
  hasFastgptApiKey: boolean;
  settings: Record<string, unknown>;
  status: 'draft' | 'active' | 'disabled';
  attachedKnowledgeBaseCount: number;
  createdAt: string;
  updatedAt: string;
}

function mapApp(row: AppRow): AiApp {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    fastgptAppId: row.fastgpt_app_id,
    hasFastgptApiKey: row.has_fastgpt_api_key,
    settings: row.settings,
    status: row.status,
    attachedKnowledgeBaseCount: row.attached_knowledge_base_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const appColumns = `
  app.id, app.owner_id, app.name, app.description, app.fastgpt_app_id,
  (app.fastgpt_api_key_ciphertext IS NOT NULL) AS has_fastgpt_api_key,
  app.settings, app.status, app.created_at, app.updated_at,
  count(akb.knowledge_base_id)::int AS attached_knowledge_base_count
`;

const appSortExpressions: Record<ListAppsQuery['sort'], string> = {
  updated_desc: 'app.updated_at DESC, app.id DESC',
  created_desc: 'app.created_at DESC, app.id DESC',
  name_asc: 'app.name ASC, app.id ASC',
};

function duplicateNameError(error: unknown): never {
  if (isPostgreSqlError(error) && error.code === '23505') {
    throw new AppError(409, 'APP_NAME_ALREADY_EXISTS', '你已经创建过同名应用');
  }
  throw error;
}

export async function createApp(ownerId: string, input: CreateAppInput): Promise<AiApp> {
  const apiKeyCiphertext = input.fastgptApiKey
    ? encryptSecret(input.fastgptApiKey)
    : null;
  try {
    const result = await query<AppRow>(
      `WITH inserted AS (
         INSERT INTO ai_apps (
           owner_id, name, description, fastgpt_app_id,
           fastgpt_api_key_ciphertext, settings, status
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING *
       )
       SELECT inserted.id, inserted.owner_id, inserted.name, inserted.description,
              inserted.fastgpt_app_id,
              (inserted.fastgpt_api_key_ciphertext IS NOT NULL) AS has_fastgpt_api_key,
              inserted.settings, inserted.status,
              inserted.created_at, inserted.updated_at,
              0::int AS attached_knowledge_base_count
         FROM inserted`,
      [
        ownerId,
        input.name,
        input.description ?? null,
        input.fastgptAppId ?? null,
        apiKeyCiphertext,
        JSON.stringify(input.settings),
        input.status,
      ],
    );
    return mapApp(result.rows[0]!);
  } catch (error) {
    return duplicateNameError(error);
  }
}

export async function listApps(
  ownerId: string,
  input: ListAppsQuery,
): Promise<{ items: AiApp[]; page: number; pageSize: number; total: number }> {
  const offset = (input.page - 1) * input.pageSize;
  const filterValues = [ownerId, input.status ?? null, input.search || null];
  const orderBy = appSortExpressions[input.sort];
  const [itemsResult, countResult] = await Promise.all([
    query<AppRow>(
      `SELECT ${appColumns}
       FROM ai_apps app
       LEFT JOIN app_knowledge_bases akb ON akb.app_id = app.id
      WHERE app.owner_id = $1
        AND ($2::varchar IS NULL OR app.status = $2)
        AND (
          $3::varchar IS NULL
          OR app.name ILIKE '%' || $3 || '%'
          OR coalesce(app.description, '') ILIKE '%' || $3 || '%'
        )
      GROUP BY app.id
      ORDER BY ${orderBy}
      LIMIT $4 OFFSET $5`,
      [...filterValues, input.pageSize, offset],
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM ai_apps
        WHERE owner_id = $1
          AND ($2::varchar IS NULL OR status = $2)
          AND (
            $3::varchar IS NULL
            OR name ILIKE '%' || $3 || '%'
            OR coalesce(description, '') ILIKE '%' || $3 || '%'
          )`,
      filterValues,
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapApp),
    page: input.page,
    pageSize: input.pageSize,
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function getApp(ownerId: string, appId: string): Promise<AiApp> {
  const result = await query<AppRow>(
    `SELECT ${appColumns}
       FROM ai_apps app
       LEFT JOIN app_knowledge_bases akb ON akb.app_id = app.id
      WHERE app.id = $1 AND app.owner_id = $2
      GROUP BY app.id`,
    [appId, ownerId],
  );
  const app = result.rows[0];

  if (!app) {
    throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
  }
  return mapApp(app);
}

export async function updateApp(
  ownerId: string,
  appId: string,
  input: UpdateAppInput,
): Promise<AiApp> {
  const assignments: string[] = [];
  const values: unknown[] = [];

  const addAssignment = (column: string, value: unknown, cast = '') => {
    values.push(value);
    assignments.push(`${column} = $${values.length}${cast}`);
  };

  if (input.name !== undefined) addAssignment('name', input.name);
  if ('description' in input) addAssignment('description', input.description ?? null);
  if ('fastgptAppId' in input) addAssignment('fastgpt_app_id', input.fastgptAppId ?? null);
  if (input.fastgptApiKey !== undefined) {
    addAssignment('fastgpt_api_key_ciphertext', encryptSecret(input.fastgptApiKey));
  } else if (input.clearFastgptApiKey) {
    addAssignment('fastgpt_api_key_ciphertext', null);
  }
  if (input.settings !== undefined) addAssignment('settings', JSON.stringify(input.settings), '::jsonb');
  if (input.status !== undefined) addAssignment('status', input.status);

  values.push(appId, ownerId);

  try {
    const result = await query<{ id: string }>(
      `UPDATE ai_apps
          SET ${assignments.join(', ')}
        WHERE id = $${values.length - 1}
          AND owner_id = $${values.length}
      RETURNING id`,
      values,
    );
    if (!result.rows[0]) {
      throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
    }
    return getApp(ownerId, appId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    return duplicateNameError(error);
  }
}

export interface AppStats {
  total: number;
  active: number;
  draft: number;
  disabled: number;
  knowledgeBaseBindings: number;
}

export async function getAppStats(ownerId: string): Promise<AppStats> {
  const result = await query<AppStats>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE app.status = 'active')::int AS active,
            count(*) FILTER (WHERE app.status = 'draft')::int AS draft,
            count(*) FILTER (WHERE app.status = 'disabled')::int AS disabled,
            (
              SELECT count(*)::int
                FROM app_knowledge_bases link
                JOIN ai_apps owned_app ON owned_app.id = link.app_id
               WHERE owned_app.owner_id = $1
            ) AS "knowledgeBaseBindings"
       FROM ai_apps app
      WHERE app.owner_id = $1`,
    [ownerId],
  );
  return result.rows[0] ?? {
    total: 0,
    active: 0,
    draft: 0,
    disabled: 0,
    knowledgeBaseBindings: 0,
  };
}

export async function disableApp(ownerId: string, appId: string): Promise<void> {
  const result = await query(
    `UPDATE ai_apps
        SET status = 'disabled'
      WHERE id = $1 AND owner_id = $2`,
    [appId, ownerId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
  }
}
