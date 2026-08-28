import { Router } from 'express';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import {
  conversationIdSchema,
  createConversationSchema,
  createMessageSchema,
  generateConversationReplySchema,
  listConversationsQuerySchema,
  messageIdSchema,
  updateConversationSchema,
} from './conversations.schemas.js';
import {
  generateConversationReply,
  retryConversationReply,
} from './conversation-generation.service.js';
import {
  archiveConversation,
  createConversation,
  createMessage,
  getConversation,
  getConversationStats,
  listConversations,
  updateConversation,
} from './conversations.service.js';

export const conversationsRouter = Router();

conversationsRouter.use(authenticate);

function authenticatedUserId(request: Express.Request): string {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  return request.auth.userId;
}

conversationsRouter.post('/', async (request, response) => {
  response.status(201).json({
    data: await createConversation(
      authenticatedUserId(request),
      createConversationSchema.parse(request.body),
    ),
  });
});

conversationsRouter.get('/', async (request, response) => {
  response.json({
    data: await listConversations(
      authenticatedUserId(request),
      listConversationsQuerySchema.parse(request.query),
    ),
  });
});

conversationsRouter.get('/stats', async (request, response) => {
  response.json({ data: await getConversationStats(authenticatedUserId(request)) });
});

conversationsRouter.get('/:conversationId', async (request, response) => {
  response.json({
    data: await getConversation(
      authenticatedUserId(request),
      conversationIdSchema.parse(request.params.conversationId),
    ),
  });
});

conversationsRouter.patch('/:conversationId', async (request, response) => {
  response.json({
    data: await updateConversation(
      authenticatedUserId(request),
      conversationIdSchema.parse(request.params.conversationId),
      updateConversationSchema.parse(request.body),
    ),
  });
});

conversationsRouter.delete('/:conversationId', async (request, response) => {
  await archiveConversation(
    authenticatedUserId(request),
    conversationIdSchema.parse(request.params.conversationId),
  );
  response.status(204).send();
});

conversationsRouter.post('/:conversationId/messages', async (request, response) => {
  response.status(201).json({
    data: await createMessage(
      authenticatedUserId(request),
      conversationIdSchema.parse(request.params.conversationId),
      createMessageSchema.parse(request.body),
    ),
  });
});

conversationsRouter.post('/:conversationId/generate', async (request, response) => {
  response.status(201).json({
    data: await generateConversationReply(
      authenticatedUserId(request),
      conversationIdSchema.parse(request.params.conversationId),
      generateConversationReplySchema.parse(request.body),
    ),
  });
});

conversationsRouter.post('/:conversationId/messages/:messageId/retry', async (request, response) => {
  response.json({
    data: await retryConversationReply(
      authenticatedUserId(request),
      conversationIdSchema.parse(request.params.conversationId),
      messageIdSchema.parse(request.params.messageId),
    ),
  });
});
