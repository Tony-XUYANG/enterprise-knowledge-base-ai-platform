import { query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { decryptSecret } from '../../security/secret-encryption.js';
import type { GenerateConversationReplyInput } from './conversations.schemas.js';
import {
  createMessage,
  getConversation,
  type ConversationMessage,
} from './conversations.service.js';
import { requestFastGptCompletion } from './fastgpt-client.js';

interface ConversationExecutionRow {
  conversation_status: 'active' | 'archived';
  app_status: 'draft' | 'active' | 'disabled';
  fastgpt_app_id: string | null;
  fastgpt_api_key_ciphertext: string | null;
  settings: Record<string, unknown>;
}

export interface ConversationGenerationResult {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
}

function configuredTemperature(settings: Record<string, unknown>): number {
  const value = settings.temperature;
  return typeof value === 'number' && value >= 0 && value <= 2 ? value : 0.2;
}

export async function generateConversationReply(
  ownerId: string,
  conversationId: string,
  input: GenerateConversationReplyInput,
): Promise<ConversationGenerationResult> {
  const executionResult = await query<ConversationExecutionRow>(
    `SELECT conversation.status AS conversation_status,
            app.status AS app_status,
            app.fastgpt_app_id,
            app.fastgpt_api_key_ciphertext,
            app.settings
       FROM conversations conversation
       JOIN ai_apps app ON app.id = conversation.app_id
      WHERE conversation.id = $1 AND conversation.user_id = $2`,
    [conversationId, ownerId],
  );
  const execution = executionResult.rows[0];
  if (!execution) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', '对话不存在');
  }
  if (execution.conversation_status === 'archived') {
    throw new AppError(409, 'CONVERSATION_ARCHIVED', '已归档对话不能生成回复');
  }
  if (execution.app_status === 'disabled') {
    throw new AppError(409, 'APP_DISABLED', '已停用应用不能生成回复');
  }
  if (!execution.fastgpt_api_key_ciphertext) {
    throw new AppError(409, 'FASTGPT_NOT_CONFIGURED', '应用尚未配置 FastGPT API Key');
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(execution.fastgpt_api_key_ciphertext);
  } catch {
    throw new AppError(500, 'FASTGPT_CREDENTIAL_INVALID', 'FastGPT 凭据无法解密');
  }

  const userMessage = await createMessage(ownerId, conversationId, {
    role: 'user',
    content: input.message,
    status: 'completed',
    metadata: { source: 'fastgpt_chat' },
  });
  const pendingMessage = await createMessage(ownerId, conversationId, {
    role: 'assistant',
    content: '正在生成回复',
    status: 'pending',
    metadata: { provider: 'fastgpt' },
  });
  const detail = await getConversation(ownerId, conversationId);
  const history = detail.messages
    .filter((message) => (
      message.status === 'completed'
      && (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    ))
    .slice(-30)
    .map((message) => ({ role: message.role as 'system' | 'user' | 'assistant', content: message.content }));

  try {
    const completion = await requestFastGptCompletion({
      apiKey,
      chatId: conversationId,
      messages: history,
      temperature: configuredTemperature(execution.settings),
    });
    await query(
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
          AND EXISTS (
            SELECT 1 FROM conversations
             WHERE id = $9 AND user_id = $10
          )`,
      [
        completion.content,
        completion.externalMessageId,
        completion.model,
        completion.promptTokens,
        completion.completionTokens,
        completion.latencyMs,
        JSON.stringify({
          provider: 'fastgpt',
          ...(execution.fastgpt_app_id ? { fastgptAppId: execution.fastgpt_app_id } : {}),
        }),
        pendingMessage.id,
        conversationId,
        ownerId,
      ],
    );
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError(502, 'FASTGPT_UNAVAILABLE', '无法连接 FastGPT 服务');
    await query(
      `UPDATE messages
          SET content = 'FastGPT 暂时无法生成回复。',
              status = 'failed',
              error_code = $1,
              metadata = metadata || $2::jsonb
        WHERE id = $3 AND conversation_id = $4`,
      [appError.code, JSON.stringify({ provider: 'fastgpt' }), pendingMessage.id, conversationId],
    );
    throw appError;
  }

  const updatedDetail = await getConversation(ownerId, conversationId);
  const assistantMessage = updatedDetail.messages.find((message) => message.id === pendingMessage.id);
  if (!assistantMessage) {
    throw new AppError(500, 'MESSAGE_UPDATE_FAILED', '助手消息更新失败');
  }
  return { userMessage, assistantMessage };
}
