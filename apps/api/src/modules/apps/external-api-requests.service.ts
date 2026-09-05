import { query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type { AppAccessContext } from './app-access-keys.service.js';
import type { ExternalApiRequestListQuery } from './external-api-requests.schemas.js';

type ExternalApiRequestOutcome = 'success' | 'failure';

interface ExternalApiRequestRow {
  id: string;
  app_id: string;
  access_key_id: string | null;
  access_key_name: string;
  access_key_prefix: string;
  conversation_id: string | null;
  endpoint: string;
  outcome: ExternalApiRequestOutcome;
  http_status: number;
  error_code: string | null;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  client_ip: string | null;
  created_at: Date;
}

interface ExternalApiRequestSummaryRow {
  total: number;
  successes: number;
  failures: number;
  average_latency_ms: number | null;
  prompt_tokens: string;
  completion_tokens: string;
}

export interface ExternalApiRequestRecord {
  id: string;
  appId: string;
  accessKeyId: string | null;
  accessKeyName: string;
  accessKeyPrefix: string;
  conversationId: string | null;
  endpoint: string;
  outcome: ExternalApiRequestOutcome;
  httpStatus: number;
  errorCode: string | null;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  clientIp: string | null;
  createdAt: string;
}

interface RecordExternalApiRequestInput {
  access: AppAccessContext;
  conversationId?: string | null;
  endpoint: string;
  outcome: ExternalApiRequestOutcome;
  httpStatus: number;
  errorCode?: string | null;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

const rangeHours: Record<ExternalApiRequestListQuery['range'], number> = {
  '24h': 24,
  '7d': 7 * 24,
  '30d': 30 * 24,
  '90d': 90 * 24,
};

function mapRequest(row: ExternalApiRequestRow): ExternalApiRequestRecord {
  const promptTokens = row.prompt_tokens ?? 0;
  const completionTokens = row.completion_tokens ?? 0;
  return {
    id: row.id,
    appId: row.app_id,
    accessKeyId: row.access_key_id,
    accessKeyName: row.access_key_name,
    accessKeyPrefix: row.access_key_prefix,
    conversationId: row.conversation_id,
    endpoint: row.endpoint,
    outcome: row.outcome,
    httpStatus: row.http_status,
    errorCode: row.error_code,
    latencyMs: row.latency_ms,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    clientIp: row.client_ip,
    createdAt: row.created_at.toISOString(),
  };
}

export async function recordExternalApiRequest(
  input: RecordExternalApiRequestInput,
): Promise<void> {
  await query(
    `INSERT INTO external_api_requests (
       app_id, owner_id, access_key_id, access_key_name, access_key_prefix,
       conversation_id, endpoint, outcome, http_status, error_code,
       latency_ms, prompt_tokens, completion_tokens, client_ip, user_agent
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15
     )`,
    [
      input.access.appId,
      input.access.ownerId,
      input.access.accessKeyId,
      input.access.accessKeyName,
      input.access.accessKeyPrefix,
      input.conversationId ?? null,
      input.endpoint,
      input.outcome,
      input.httpStatus,
      input.errorCode ?? null,
      Math.max(0, Math.round(input.latencyMs)),
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.clientIp?.slice(0, 64) || null,
      input.userAgent?.slice(0, 512) || null,
    ],
  );
}

export async function listExternalApiRequests(
  ownerId: string,
  appId: string,
  input: ExternalApiRequestListQuery,
) {
  const appResult = await query(
    'SELECT 1 FROM ai_apps WHERE id = $1 AND owner_id = $2',
    [appId, ownerId],
  );
  if (!appResult.rows[0]) {
    throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
  }

  const offset = (input.page - 1) * input.pageSize;
  const hours = rangeHours[input.range];
  const baseValues = [appId, ownerId, hours, input.accessKeyId ?? null];
  const listValues = [...baseValues, input.outcome ?? null];
  const [itemsResult, countResult, summaryResult] = await Promise.all([
    query<ExternalApiRequestRow>(
      `SELECT id, app_id, access_key_id, access_key_name, access_key_prefix,
              conversation_id, endpoint, outcome, http_status, error_code,
              latency_ms, prompt_tokens, completion_tokens, client_ip, created_at
         FROM external_api_requests
        WHERE app_id = $1
          AND owner_id = $2
          AND created_at >= CURRENT_TIMESTAMP - ($3::int * INTERVAL '1 hour')
          AND ($4::uuid IS NULL OR access_key_id = $4)
          AND ($5::varchar IS NULL OR outcome = $5)
        ORDER BY created_at DESC, id DESC
        LIMIT $6 OFFSET $7`,
      [...listValues, input.pageSize, offset],
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM external_api_requests
        WHERE app_id = $1
          AND owner_id = $2
          AND created_at >= CURRENT_TIMESTAMP - ($3::int * INTERVAL '1 hour')
          AND ($4::uuid IS NULL OR access_key_id = $4)
          AND ($5::varchar IS NULL OR outcome = $5)`,
      listValues,
    ),
    query<ExternalApiRequestSummaryRow>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE outcome = 'success')::int AS successes,
              count(*) FILTER (WHERE outcome = 'failure')::int AS failures,
              round(avg(latency_ms))::int AS average_latency_ms,
              coalesce(sum(prompt_tokens), 0)::bigint AS prompt_tokens,
              coalesce(sum(completion_tokens), 0)::bigint AS completion_tokens
         FROM external_api_requests
        WHERE app_id = $1
          AND owner_id = $2
          AND created_at >= CURRENT_TIMESTAMP - ($3::int * INTERVAL '1 hour')
          AND ($4::uuid IS NULL OR access_key_id = $4)`,
      baseValues,
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    total: 0,
    successes: 0,
    failures: 0,
    average_latency_ms: null,
    prompt_tokens: '0',
    completion_tokens: '0',
  };
  const promptTokens = Number(summary.prompt_tokens);
  const completionTokens = Number(summary.completion_tokens);

  return {
    items: itemsResult.rows.map(mapRequest),
    page: input.page,
    pageSize: input.pageSize,
    total: countResult.rows[0]?.total ?? 0,
    range: input.range,
    summary: {
      calls: summary.total,
      successes: summary.successes,
      failures: summary.failures,
      successRate: summary.total === 0
        ? 0
        : Math.round((summary.successes / summary.total) * 1000) / 10,
      averageLatencyMs: summary.average_latency_ms ?? 0,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}
