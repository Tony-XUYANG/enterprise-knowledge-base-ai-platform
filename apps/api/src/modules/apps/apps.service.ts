import { isPostgreSqlError } from '../../db/pg-error.js';
import { query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { encryptSecret } from '../../security/secret-encryption.js';
import type {
  AppMetricsQuery,
  CreateAppInput,
  ListAppsQuery,
  UpdateAppInput,
} from './apps.schemas.js';

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

interface AppMetricsSummaryRow {
  from_date: string;
  to_date: string;
  conversations: number;
  total_messages: number;
  user_messages: number;
  assistant_messages: number;
  completed_replies: number;
  failed_replies: number;
  pending_replies: number;
  prompt_tokens: string;
  completion_tokens: string;
  average_latency_ms: number | null;
}

interface AppMetricsActivityRow {
  day: string;
  conversations: number;
  messages: number;
  assistant_replies: number;
  failed_replies: number;
}

interface AppMetricsModelRow {
  model: string;
  replies: number;
  completed_replies: number;
  failed_replies: number;
  pending_replies: number;
  prompt_tokens: string;
  completion_tokens: string;
  average_latency_ms: number | null;
}

export interface AppMetrics {
  range: AppMetricsQuery['range'];
  fromDate: string;
  toDate: string;
  summary: {
    conversations: number;
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    completedReplies: number;
    failedReplies: number;
    pendingReplies: number;
    successRate: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    averageLatencyMs: number;
  };
  activity: Array<{
    day: string;
    conversations: number;
    messages: number;
    assistantReplies: number;
    failedReplies: number;
  }>;
  models: Array<{
    model: string;
    replies: number;
    completedReplies: number;
    failedReplies: number;
    pendingReplies: number;
    successRate: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    averageLatencyMs: number;
  }>;
}

const metricsRangeDays: Record<AppMetricsQuery['range'], number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function successRate(completed: number, failed: number): number {
  const ended = completed + failed;
  return ended === 0 ? 0 : Math.round((completed / ended) * 1000) / 10;
}

export async function getAppMetrics(
  ownerId: string,
  appId: string,
  input: AppMetricsQuery,
): Promise<AppMetrics> {
  await getApp(ownerId, appId);
  const days = metricsRangeDays[input.range];
  const values = [appId, ownerId, days];

  const [summaryResult, activityResult, modelsResult] = await Promise.all([
    query<AppMetricsSummaryRow>(
      `WITH bounds AS (
         SELECT timezone('UTC', CURRENT_TIMESTAMP)::date - ($3::int - 1) AS from_date,
                timezone('UTC', CURRENT_TIMESTAMP)::date AS to_date
       )
       SELECT to_char(bounds.from_date, 'YYYY-MM-DD') AS from_date,
              to_char(bounds.to_date, 'YYYY-MM-DD') AS to_date,
              count(DISTINCT conversation.id) FILTER (
                WHERE conversation.created_at >= bounds.from_date AT TIME ZONE 'UTC'
              )::int AS conversations,
              count(message.id)::int AS total_messages,
              count(message.id) FILTER (WHERE message.role = 'user')::int AS user_messages,
              count(message.id) FILTER (WHERE message.role = 'assistant')::int AS assistant_messages,
              count(message.id) FILTER (
                WHERE message.role = 'assistant' AND message.status = 'completed'
              )::int AS completed_replies,
              count(message.id) FILTER (
                WHERE message.role = 'assistant' AND message.status = 'failed'
              )::int AS failed_replies,
              count(message.id) FILTER (
                WHERE message.role = 'assistant' AND message.status = 'pending'
              )::int AS pending_replies,
              coalesce(sum(message.prompt_tokens) FILTER (
                WHERE message.role = 'assistant'
              ), 0)::bigint AS prompt_tokens,
              coalesce(sum(message.completion_tokens) FILTER (
                WHERE message.role = 'assistant'
              ), 0)::bigint AS completion_tokens,
              round(avg(message.latency_ms) FILTER (
                WHERE message.role = 'assistant' AND message.status = 'completed'
              ))::int AS average_latency_ms
         FROM bounds
         LEFT JOIN conversations conversation
           ON conversation.app_id = $1
          AND conversation.user_id = $2
         LEFT JOIN messages message
           ON message.conversation_id = conversation.id
          AND message.created_at >= bounds.from_date AT TIME ZONE 'UTC'
        GROUP BY bounds.from_date, bounds.to_date`,
      values,
    ),
    query<AppMetricsActivityRow>(
      `WITH bounds AS (
         SELECT timezone('UTC', CURRENT_TIMESTAMP)::date - ($3::int - 1) AS from_date,
                timezone('UTC', CURRENT_TIMESTAMP)::date AS to_date
       ),
       days AS (
         SELECT generate_series(bounds.from_date, bounds.to_date, interval '1 day')::date AS day
           FROM bounds
       ),
       conversation_activity AS (
         SELECT (conversation.created_at AT TIME ZONE 'UTC')::date AS day,
                count(*)::int AS conversations
           FROM conversations conversation, bounds
          WHERE conversation.app_id = $1
            AND conversation.user_id = $2
            AND conversation.created_at >= bounds.from_date AT TIME ZONE 'UTC'
          GROUP BY (conversation.created_at AT TIME ZONE 'UTC')::date
       ),
       message_activity AS (
         SELECT (message.created_at AT TIME ZONE 'UTC')::date AS day,
                count(*)::int AS messages,
                count(*) FILTER (WHERE message.role = 'assistant')::int AS assistant_replies,
                count(*) FILTER (
                  WHERE message.role = 'assistant' AND message.status = 'failed'
                )::int AS failed_replies
           FROM messages message
           JOIN conversations conversation ON conversation.id = message.conversation_id
           CROSS JOIN bounds
          WHERE conversation.app_id = $1
            AND conversation.user_id = $2
            AND message.created_at >= bounds.from_date AT TIME ZONE 'UTC'
          GROUP BY (message.created_at AT TIME ZONE 'UTC')::date
       )
       SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
              coalesce(conversation_activity.conversations, 0)::int AS conversations,
              coalesce(message_activity.messages, 0)::int AS messages,
              coalesce(message_activity.assistant_replies, 0)::int AS assistant_replies,
              coalesce(message_activity.failed_replies, 0)::int AS failed_replies
         FROM days
         LEFT JOIN conversation_activity USING (day)
         LEFT JOIN message_activity USING (day)
        ORDER BY days.day ASC`,
      values,
    ),
    query<AppMetricsModelRow>(
      `WITH bounds AS (
         SELECT timezone('UTC', CURRENT_TIMESTAMP)::date - ($3::int - 1) AS from_date
       )
       SELECT coalesce(nullif(btrim(message.model), ''), '未记录模型') AS model,
              count(*)::int AS replies,
              count(*) FILTER (WHERE message.status = 'completed')::int AS completed_replies,
              count(*) FILTER (WHERE message.status = 'failed')::int AS failed_replies,
              count(*) FILTER (WHERE message.status = 'pending')::int AS pending_replies,
              coalesce(sum(message.prompt_tokens), 0)::bigint AS prompt_tokens,
              coalesce(sum(message.completion_tokens), 0)::bigint AS completion_tokens,
              round(avg(message.latency_ms) FILTER (
                WHERE message.status = 'completed'
              ))::int AS average_latency_ms
         FROM messages message
         JOIN conversations conversation ON conversation.id = message.conversation_id
         CROSS JOIN bounds
        WHERE conversation.app_id = $1
          AND conversation.user_id = $2
          AND message.role = 'assistant'
          AND message.created_at >= bounds.from_date AT TIME ZONE 'UTC'
        GROUP BY coalesce(nullif(btrim(message.model), ''), '未记录模型')
        ORDER BY count(*) DESC, model ASC`,
      values,
    ),
  ]);

  const row = summaryResult.rows[0]!;
  const promptTokens = Number(row.prompt_tokens);
  const completionTokens = Number(row.completion_tokens);

  return {
    range: input.range,
    fromDate: row.from_date,
    toDate: row.to_date,
    summary: {
      conversations: row.conversations,
      totalMessages: row.total_messages,
      userMessages: row.user_messages,
      assistantMessages: row.assistant_messages,
      completedReplies: row.completed_replies,
      failedReplies: row.failed_replies,
      pendingReplies: row.pending_replies,
      successRate: successRate(row.completed_replies, row.failed_replies),
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      averageLatencyMs: row.average_latency_ms ?? 0,
    },
    activity: activityResult.rows.map((item) => ({
      day: item.day,
      conversations: item.conversations,
      messages: item.messages,
      assistantReplies: item.assistant_replies,
      failedReplies: item.failed_replies,
    })),
    models: modelsResult.rows.map((item) => {
      const modelPromptTokens = Number(item.prompt_tokens);
      const modelCompletionTokens = Number(item.completion_tokens);
      return {
        model: item.model,
        replies: item.replies,
        completedReplies: item.completed_replies,
        failedReplies: item.failed_replies,
        pendingReplies: item.pending_replies,
        successRate: successRate(item.completed_replies, item.failed_replies),
        promptTokens: modelPromptTokens,
        completionTokens: modelCompletionTokens,
        totalTokens: modelPromptTokens + modelCompletionTokens,
        averageLatencyMs: item.average_latency_ms ?? 0,
      };
    }),
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
