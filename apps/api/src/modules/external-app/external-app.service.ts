import { query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type { AppAccessContext } from '../apps/app-access-keys.service.js';
import { generateConversationReply } from '../conversations/conversation-generation.service.js';
import { createConversation } from '../conversations/conversations.service.js';
import type { ExternalAppChatInput } from './external-app.schemas.js';

export interface ExternalAppChatResult {
  appId: string;
  conversationId: string;
  conversationCreated: boolean;
  userMessage: Awaited<ReturnType<typeof generateConversationReply>>['userMessage'];
  assistantMessage: Awaited<ReturnType<typeof generateConversationReply>>['assistantMessage'];
}

export async function executeExternalAppChat(
  access: AppAccessContext,
  input: ExternalAppChatInput,
  onConversationResolved?: (conversationId: string) => void,
): Promise<ExternalAppChatResult> {
  let conversationId = input.conversationId;
  let created = false;

  if (conversationId) {
    const conversationResult = await query(
      `SELECT 1
         FROM conversations
        WHERE id = $1
          AND app_id = $2
          AND user_id = $3
          AND status = 'active'`,
      [conversationId, access.appId, access.ownerId],
    );
    if (!conversationResult.rows[0]) {
      throw new AppError(
        404,
        'EXTERNAL_CONVERSATION_NOT_FOUND',
        '对话不存在、已归档或不属于当前应用',
      );
    }
  } else {
    const conversation = await createConversation(access.ownerId, {
      appId: access.appId,
      title: input.title,
    });
    conversationId = conversation.id;
    created = true;
  }

  onConversationResolved?.(conversationId);

  const generation = await generateConversationReply(
    access.ownerId,
    conversationId,
    { message: input.message },
    { source: 'app_access_key', accessKeyId: access.accessKeyId },
  );

  return {
    appId: access.appId,
    conversationId,
    conversationCreated: created,
    userMessage: generation.userMessage,
    assistantMessage: generation.assistantMessage,
  };
}
