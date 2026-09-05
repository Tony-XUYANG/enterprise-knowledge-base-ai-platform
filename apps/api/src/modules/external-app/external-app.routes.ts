import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../../errors/app-error.js';
import { authenticateAppAccessKey } from '../../middleware/authenticate-app-access-key.js';
import { externalAppChatSchema } from './external-app.schemas.js';
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
    response.status(201).json({
      data: await executeExternalAppChat(
        request.appAccess,
        externalAppChatSchema.parse(request.body),
      ),
    });
  },
);
