import { isPostgreSqlError } from '../../db/pg-error.js';
import { query, withTransaction, type DatabaseClient } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { decryptSecret } from '../../security/secret-encryption.js';
import type { GenerateConversationReplyInput } from './conversations.schemas.js';
import type { ConversationMessage } from './conversations.service.js';
import {
  requestFastGptCompletion,
  type FastGptChatMessage,
} from './fastgpt-client.js';

interface ConversationExecutionRow {
  conversation_status: 'active' | 'archived';
  app_status: 'draft' | 'active' | 'disabled';
  fastgpt_app_id: string | null;
  fastgpt_api_key_ciphertext: string | null;
  settings: Record<string, unknown>;
}

interface GenerationMessageRow {
  id: string;
  conversation_id: string;
  sequence_no: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  status: 'pending' | 'completed' | 'failed';
  external_message_id: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  error_code: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface RetryableMessageRow extends GenerationMessageRow {
  is_latest: boolean;
}

interface PreparedGeneration {
  apiKey: string;
  fastgptAppId: string | null;
  temperature: number;
  history: FastGptChatMessage[];
  userMessage: ConversationMessage;
  pendingMessage: ConversationMessage;
}

export interface ConversationGenerationResult {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
}

function configuredTemperature(settings: Record<string, unknown>): number {
  const value = settings.temperature;
  return typeof value === 'number' && value >= 0 && value <= 2 ? value : 0.2;
}

function mapMessage(row: GenerationMessageRow): ConversationMessage {
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

async function loadExecution(
  client: DatabaseClient,
  ownerId: string,
  conversationId: string,
): Promise<ConversationExecutionRow> {
  const result = await client.query<ConversationExecutionRow>(
    `SELECT conversation.status AS conversation_status,
            app.status AS app_status,
            app.fastgpt_app_id,
            app.fastgpt_api_key_ciphertext,
            app.settings
       FROM conversations conversation
       JOIN ai_apps app ON app.id = conversation.app_id
      WHERE conversation.id = $1 AND conversation.user_id = $2
      FOR UPDATE OF conversation`,
    [conversationId, ownerId],
  );
  const execution = result.rows[0];
  if (!execution) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', '对话不存在');
  }
  if (execution.conversation_status === 'archived') {
    throw new AppError(409, 'CONVERSATION_ARCHIVED', '已归档对话不能生成回答');
  }
  if (execution.app_status === 'disabled') {
    throw new AppError(409, 'APP_DISABLED', '已停用应用不能生成回答');
  }
  if (!execution.fastgpt_api_key_ciphertext) {
    throw new AppError(409, 'FASTGPT_NOT_CONFIGURED', '应用尚未配置 FastGPT API Key');
  }
  return execution;
}

function decryptExecutionKey(execution: ConversationExecutionRow): string {
  try {
    return decryptSecret(execution.fastgpt_api_key_ciphertext!);
  } catch {
    throw new AppError(500, 'FASTGPT_CREDENTIAL_INVALID', 'FastGPT 凭据无法解密');
  }
}

async function ensureNoPendingReply(
  client: DatabaseClient,
  conversationId: string,
): Promise<void> {
  const pendingResult = await client.query(
    `SELECT 1
       FROM messages
      WHERE conversation_id = $1
        AND role = 'assistant'
        AND status = 'pending'
      LIMIT 1`,
    [conversationId],
  );
  if (pendingResult.rows[0]) {
    throw new AppError(409, 'GENERATION_IN_PROGRESS', '该对话已有回复正在生成');
  }
}

async function loadHistory(
  client: DatabaseClient,
  conversationId: string,
): Promise<FastGptChatMessage[]> {
  const result = await client.query<{ role: FastGptChatMessage['role']; content: string }>(
    `SELECT role, content
       FROM messages
      WHERE conversation_id = $1
        AND status = 'completed'
        AND role IN ('system', 'user', 'assistant')
      ORDER BY sequence_no DESC
      LIMIT 30`,
    [conversationId],
  );
  return result.rows.reverse();
}

function generationConflict(error: unknown): never {
  if (
    isPostgreSqlError(error)
    && error.code === '23505'
    && error.constraint === 'messages_one_pending_assistant_per_conversation_idx'
  ) {
    throw new AppError(409, 'GENERATION_IN_PROGRESS', '该对话已有回复正在生成');
  }
  throw error;
}

async function prepareNewGeneration(
  ownerId: string,
  conversationId: string,
  input: GenerateConversationReplyInput,
): Promise<PreparedGeneration> {
  try {
    return await withTransaction(async (client) => {
      const execution = await loadExecution(client, ownerId, conversationId);
      const apiKey = decryptExecutionKey(execution);
      await ensureNoPendingReply(client, conversationId);

      const sequenceResult = await client.query<{ next_sequence: number }>(
        `SELECT coalesce(max(sequence_no), 0)::int + 1 AS next_sequence
           FROM messages
          WHERE conversation_id = $1`,
        [conversationId],
      );
      const nextSequence = sequenceResult.rows[0]!.next_sequence;
      const userResult = await client.query<GenerationMessageRow>(
        `INSERT INTO messages (
           conversation_id, sequence_no, role, content, status, metadata
         ) VALUES ($1, $2, 'user', $3, 'completed', $4::jsonb)
         RETURNING *`,
        [conversationId, nextSequence, input.message, JSON.stringify({ source: 'fastgpt_chat' })],
      );
      const pendingResult = await client.query<GenerationMessageRow>(
        `INSERT INTO messages (
           conversation_id, sequence_no, role, content, status, metadata
         ) VALUES ($1, $2, 'assistant', '正在生成回复', 'pending', $3::jsonb)
         RETURNING *`,
        [conversationId, nextSequence + 1, JSON.stringify({ provider: 'fastgpt' })],
      );
      await client.query(
        `UPDATE conversations
            SET last_message_at = $1
          WHERE id = $2`,
        [pendingResult.rows[0]!.created_at, conversationId],
      );

      return {
        apiKey,
        fastgptAppId: execution.fastgpt_app_id,
        temperature: configuredTemperature(execution.settings),
        history: await loadHistory(client, conversationId),
        userMessage: mapMessage(userResult.rows[0]!),
        pendingMessage: mapMessage(pendingResult.rows[0]!),
      };
    });
  } catch (error) {
    return generationConflict(error);
  }
}

async function prepareRetryGeneration(
  ownerId: string,
  conversationId: string,
  messageId: string,
): Promise<PreparedGeneration> {
  try {
    return await withTransaction(async (client) => {
      const execution = await loadExecution(client, ownerId, conversationId);
      const apiKey = decryptExecutionKey(execution);
      await ensureNoPendingReply(client, conversationId);

      const failedResult = await client.query<RetryableMessageRow>(
        `SELECT message.*,
                message.sequence_no = (
                  SELECT max(latest.sequence_no)
                    FROM messages latest
                   WHERE latest.conversation_id = message.conversation_id
                ) AS is_latest
           FROM messages message
          WHERE message.id = $1 AND message.conversation_id = $2
          FOR UPDATE`,
        [messageId, conversationId],
      );
      const failedMessage = failedResult.rows[0];
      if (!failedMessage) {
        throw new AppError(404, 'MESSAGE_NOT_FOUND', '消息不存在');
      }
      if (
        failedMessage.role !== 'assistant'
        || failedMessage.status !== 'failed'
        || !failedMessage.is_latest
      ) {
        throw new AppError(409, 'MESSAGE_NOT_RETRYABLE', '只能重试最新一条失败的助手回复');
      }

      const userResult = await client.query<GenerationMessageRow>(
        `SELECT *
           FROM messages
          WHERE conversation_id = $1
            AND sequence_no = $2
            AND role = 'user'
            AND status = 'completed'`,
        [conversationId, failedMessage.sequence_no - 1],
      );
      const userMessage = userResult.rows[0];
      if (!userMessage) {
        throw new AppError(409, 'MESSAGE_NOT_RETRYABLE', '失败回复缺少可重试的用户消息');
      }

      const pendingResult = await client.query<GenerationMessageRow>(
        `UPDATE messages
            SET content = '正在重新生成回复',
                status = 'pending',
                external_message_id = NULL,
                model = NULL,
                prompt_tokens = NULL,
                completion_tokens = NULL,
                latency_ms = NULL,
                error_code = NULL,
                metadata = jsonb_set(
                  jsonb_set(
                    metadata,
                    '{retryCount}',
                    to_jsonb(
                      CASE
                        WHEN coalesce(metadata->>'retryCount', '') ~ '^[0-9]+$'
                          THEN (metadata->>'retryCount')::integer + 1
                        ELSE 1
                      END
                    ),
                    true
                  ),
                  '{previousErrors}',
                  (
                    CASE
                      WHEN jsonb_typeof(metadata->'previousErrors') = 'array'
                        THEN metadata->'previousErrors'
                      ELSE '[]'::jsonb
                    END
                  ) || jsonb_build_array(
                    jsonb_build_object(
                      'code', coalesce($3::varchar, 'UNKNOWN'),
                      'retriedAt', CURRENT_TIMESTAMP
                    )
                  ),
                  true
                )
          WHERE id = $1 AND conversation_id = $2
          RETURNING *`,
        [messageId, conversationId, failedMessage.error_code],
      );
      await client.query(
        `UPDATE conversations
            SET last_message_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [conversationId],
      );

      return {
        apiKey,
        fastgptAppId: execution.fastgpt_app_id,
        temperature: configuredTemperature(execution.settings),
        history: await loadHistory(client, conversationId),
        userMessage: mapMessage(userMessage),
        pendingMessage: mapMessage(pendingResult.rows[0]!),
      };
    });
  } catch (error) {
    return generationConflict(error);
  }
}

async function markGenerationFailed(
  ownerId: string,
  conversationId: string,
  messageId: string,
  errorCode: string,
): Promise<void> {
  await query(
    `UPDATE messages
        SET content = 'FastGPT 暂时无法生成回复。',
            status = 'failed',
            error_code = $1,
            metadata = metadata || jsonb_build_object(
              'provider', 'fastgpt',
              'lastFailureAt', CURRENT_TIMESTAMP
            )
      WHERE id = $2
        AND conversation_id = $3
        AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM conversations
           WHERE id = $3 AND user_id = $4
        )`,
    [errorCode, messageId, conversationId, ownerId],
  );
}

async function executePreparedGeneration(
  ownerId: string,
  conversationId: string,
  prepared: PreparedGeneration,
): Promise<ConversationGenerationResult> {
  let completion;
  try {
    completion = await requestFastGptCompletion({
      apiKey: prepared.apiKey,
      chatId: conversationId,
      messages: prepared.history,
      temperature: prepared.temperature,
    });
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError(502, 'FASTGPT_UNAVAILABLE', '无法连接 FastGPT 服务');
    await markGenerationFailed(
      ownerId,
      conversationId,
      prepared.pendingMessage.id,
      appError.code,
    ).catch(() => undefined);
    throw appError;
  }

  const updatedResult = await query<GenerationMessageRow>(
    `UPDATE messages
        SET content = $1,
            status = 'completed',
            external_message_id = $2,
            model = $3,
            prompt_tokens = $4,
            completion_tokens = $5,
            latency_ms = $6,
            error_code = NULL,
            metadata = metadata || $7::jsonb
      WHERE id = $8
        AND conversation_id = $9
        AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM conversations
           WHERE id = $9 AND user_id = $10
        )
      RETURNING *`,
    [
      completion.content,
      completion.externalMessageId,
      completion.model,
      completion.promptTokens,
      completion.completionTokens,
      completion.latencyMs,
      JSON.stringify({
        provider: 'fastgpt',
        ...(prepared.fastgptAppId ? { fastgptAppId: prepared.fastgptAppId } : {}),
      }),
      prepared.pendingMessage.id,
      conversationId,
      ownerId,
    ],
  );
  const assistantMessage = updatedResult.rows[0];
  if (!assistantMessage) {
    throw new AppError(409, 'GENERATION_STATE_CHANGED', '生成任务状态已发生变化');
  }

  return {
    userMessage: prepared.userMessage,
    assistantMessage: mapMessage(assistantMessage),
  };
}

export async function generateConversationReply(
  ownerId: string,
  conversationId: string,
  input: GenerateConversationReplyInput,
): Promise<ConversationGenerationResult> {
  return executePreparedGeneration(
    ownerId,
    conversationId,
    await prepareNewGeneration(ownerId, conversationId, input),
  );
}

export async function retryConversationReply(
  ownerId: string,
  conversationId: string,
  messageId: string,
): Promise<ConversationGenerationResult> {
  return executePreparedGeneration(
    ownerId,
    conversationId,
    await prepareRetryGeneration(ownerId, conversationId, messageId),
  );
}
