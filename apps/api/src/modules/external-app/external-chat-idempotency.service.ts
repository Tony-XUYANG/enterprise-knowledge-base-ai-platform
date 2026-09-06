import { createHash } from 'node:crypto';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type { AppAccessContext } from '../apps/app-access-keys.service.js';
import type { ExternalAppChatInput } from './external-app.schemas.js';
import type { ExternalAppChatResult } from './external-app.service.js';

interface IdempotencyRow {
  id: string;
  request_hash: string;
  status: 'pending' | 'succeeded' | 'failed';
  response_status: number | null;
  error_code: string | null;
  error_message: string | null;
  conversation_id: string | null;
  conversation_created: boolean | null;
  user_message_id: string | null;
  assistant_message_id: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sequence_no: number;
  role: 'user' | 'assistant';
  content: string;
  status: 'completed' | 'failed' | 'pending';
  external_message_id: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  error_code: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export type ExternalChatIdempotencyClaim =
  | { kind: 'new'; id: string }
  | { kind: 'replay'; data: ExternalAppChatResult }
  | { kind: 'in_progress' };

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requestFingerprint(input: ExternalAppChatInput): string {
  return JSON.stringify({
    message: input.message,
    conversationId: input.conversationId ?? null,
    title: input.title,
  });
}

function mapMessage(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequenceNo: row.sequence_no,
    role: row.role,
    content: row.content,
    status: row.status,
    externalMessageId: row.external_message_id,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    latencyMs: row.latency_ms,
    errorCode: row.error_code,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

function idempotencyConflict(): never {
  throw new AppError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    '幂等键已用于不同请求，请更换幂等键',
  );
}

function replayUnavailable(): never {
  throw new AppError(
    409,
    'IDEMPOTENCY_RESULT_UNAVAILABLE',
    '幂等请求结果暂不可用，请使用新的幂等键重试',
  );
}

async function loadReplay(
  access: AppAccessContext,
  row: IdempotencyRow,
): Promise<ExternalAppChatResult> {
  if (
    row.status !== 'succeeded'
    || !row.conversation_id
    || row.conversation_created === null
    || !row.user_message_id
    || !row.assistant_message_id
  ) {
    replayUnavailable();
  }

  const result = await query<MessageRow>(
    `SELECT message.*
       FROM messages message
       JOIN conversations conversation
         ON conversation.id = message.conversation_id
        AND conversation.app_id = $2
        AND conversation.user_id = $3
      WHERE message.conversation_id = $1
        AND message.id = ANY($4::uuid[])
      ORDER BY message.sequence_no ASC`,
    [
      row.conversation_id,
      access.appId,
      access.ownerId,
      [row.user_message_id, row.assistant_message_id],
    ],
  );
  const userMessage = result.rows.find((message) => message.id === row.user_message_id);
  const assistantMessage = result.rows.find((message) => message.id === row.assistant_message_id);
  if (!userMessage || !assistantMessage) replayUnavailable();

  return {
    appId: access.appId,
    conversationId: row.conversation_id,
    conversationCreated: row.conversation_created,
    userMessage: mapMessage(userMessage),
    assistantMessage: mapMessage(assistantMessage),
  };
}

export async function claimExternalChatIdempotency(
  access: AppAccessContext,
  input: ExternalAppChatInput,
  key: string,
): Promise<ExternalChatIdempotencyClaim> {
  const keyHash = hash(key);
  const requestHash = hash(requestFingerprint(input));
  const result = await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM external_chat_idempotencies
        WHERE app_id = $1
          AND access_key_id = $2
          AND idempotency_key_hash = $3
          AND expires_at <= CURRENT_TIMESTAMP`,
      [access.appId, access.accessKeyId, keyHash],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO external_chat_idempotencies (
         app_id, owner_id, access_key_id, idempotency_key_hash, request_hash, status
       ) VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (app_id, access_key_id, idempotency_key_hash) DO NOTHING
       RETURNING id`,
      [access.appId, access.ownerId, access.accessKeyId, keyHash, requestHash],
    );
    if (inserted.rows[0]?.id) {
      return { kind: 'new' as const, id: inserted.rows[0].id };
    }
    const existing = await client.query<IdempotencyRow>(
      `SELECT id, request_hash, status, response_status, error_code, error_message,
              conversation_id, conversation_created, user_message_id, assistant_message_id
         FROM external_chat_idempotencies
        WHERE app_id = $1
          AND access_key_id = $2
          AND idempotency_key_hash = $3`,
      [access.appId, access.accessKeyId, keyHash],
    );
    return { kind: 'existing' as const, row: existing.rows[0], requestHash };
  });

  if (result.kind === 'new') return result;
  const row = result.row;
  if (!row) throw new AppError(409, 'IDEMPOTENCY_RETRY_REQUIRED', '幂等请求正在初始化，请重试');
  if (row.request_hash !== result.requestHash) idempotencyConflict();
  if (row.status === 'pending') return { kind: 'in_progress' };
  if (row.status === 'succeeded') {
    return { kind: 'replay', data: await loadReplay(access, row) };
  }
  throw new AppError(
    row.response_status ?? 500,
    row.error_code ?? 'IDEMPOTENT_REQUEST_FAILED',
    row.error_message ?? '幂等请求上次执行失败，请使用新的幂等键重试',
  );
}

export async function completeExternalChatIdempotency(
  id: string,
  data: ExternalAppChatResult,
): Promise<void> {
  await query(
    `UPDATE external_chat_idempotencies
        SET status = 'succeeded',
            response_status = 201,
            conversation_id = $2,
            conversation_created = $3,
            user_message_id = $4,
            assistant_message_id = $5
      WHERE id = $1 AND status = 'pending'`,
    [
      id,
      data.conversationId,
      data.conversationCreated,
      data.userMessage.id,
      data.assistantMessage.id,
    ],
  );
}

export async function failExternalChatIdempotency(
  id: string,
  error: { status: number; code: string; message: string },
  conversationId: string | null,
): Promise<void> {
  await query(
    `UPDATE external_chat_idempotencies
        SET status = 'failed',
            response_status = $2,
            error_code = $3,
            error_message = $4,
            conversation_id = $5
      WHERE id = $1 AND status = 'pending'`,
    [id, error.status, error.code, error.message.slice(0, 240), conversationId],
  );
}
