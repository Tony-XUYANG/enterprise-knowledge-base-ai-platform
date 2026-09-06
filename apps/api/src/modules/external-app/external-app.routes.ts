import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { AppError } from '../../errors/app-error.js';
import { authenticateAppAccessKey } from '../../middleware/authenticate-app-access-key.js';
import { recordExternalApiRequest } from '../apps/external-api-requests.service.js';
import { externalAppChatSchema } from './external-app.schemas.js';
import { externalIdempotencyKeySchema } from './external-chat-idempotency.schemas.js';
import {
  claimExternalChatIdempotency,
  completeExternalChatIdempotency,
  failExternalChatIdempotency,
} from './external-chat-idempotency.service.js';
import { executeExternalAppChat } from './external-app.service.js';

export const externalAppRouter = Router();

const externalChatRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: 'EXTERNAL_CHAT_RATE_LIMITED',
        message: '应用调用过于频繁，请稍后重试',
      },
    });
  },
});

externalAppRouter.post(
  '/chat',
  externalChatRateLimiter,
  authenticateAppAccessKey,
  async (request, response) => {
    if (!request.appAccess) {
      throw new AppError(401, 'APP_ACCESS_KEY_REQUIRED', '请提供应用访问密钥');
    }
    const startedAt = Date.now();
    let requestedConversationId: string | null = null;
    let idempotencyId: string | null = null;

    try {
      const input = externalAppChatSchema.parse(request.body);
      const idempotencyHeader = request.header('idempotency-key');
      const idempotencyKey = idempotencyHeader
        ? externalIdempotencyKeySchema.parse(idempotencyHeader)
        : null;
      if (idempotencyKey) {
        const claim = await claimExternalChatIdempotency(request.appAccess, input, idempotencyKey);
        if (claim.kind === 'in_progress') {
          throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', '相同幂等请求正在处理中，请稍后重试');
        }
        if (claim.kind === 'replay') {
          response.status(201).json({ data: claim.data });
          return;
        }
        idempotencyId = claim.id;
      }
      const data = await executeExternalAppChat(request.appAccess, input, (conversationId) => {
        requestedConversationId = conversationId;
      });
      if (idempotencyId) {
        await completeExternalChatIdempotency(idempotencyId, data).catch((idempotencyError: unknown) => {
          request.log.error({ err: idempotencyError }, 'Failed to persist external idempotency result');
        });
      }
      await recordExternalApiRequest({
        access: request.appAccess,
        conversationId: data.conversationId,
        endpoint: '/api/v1/external/chat',
        outcome: 'success',
        httpStatus: 201,
        latencyMs: Date.now() - startedAt,
        promptTokens: data.assistantMessage.promptTokens,
        completionTokens: data.assistantMessage.completionTokens,
        clientIp: request.ip ?? null,
        userAgent: request.header('user-agent') ?? null,
      }).catch((error: unknown) => {
        request.log.error({ err: error }, 'Failed to record external API request');
      });
      response.status(201).json({ data });
    } catch (error) {
      const status = error instanceof AppError
        ? error.status
        : error instanceof ZodError
          ? 400
          : 500;
      const errorCode = error instanceof AppError
        ? error.code
        : error instanceof ZodError
          ? 'VALIDATION_ERROR'
          : 'INTERNAL_SERVER_ERROR';
      if (idempotencyId) {
        await failExternalChatIdempotency(
          idempotencyId,
          {
            status,
            code: errorCode,
            message: error instanceof AppError
              ? error.message
              : error instanceof ZodError
                ? '请求参数不合法'
                : '服务暂时不可用，请稍后重试',
          },
          requestedConversationId,
        ).catch((idempotencyError: unknown) => {
          request.log.error({ err: idempotencyError }, 'Failed to persist external idempotency failure');
        });
      }
      await recordExternalApiRequest({
        access: request.appAccess,
        conversationId: requestedConversationId,
        endpoint: '/api/v1/external/chat',
        outcome: 'failure',
        httpStatus: status,
        errorCode,
        latencyMs: Date.now() - startedAt,
        clientIp: request.ip ?? null,
        userAgent: request.header('user-agent') ?? null,
      }).catch((loggingError: unknown) => {
        request.log.error({ err: loggingError }, 'Failed to record external API request');
      });
      throw error;
    }
  },
);
