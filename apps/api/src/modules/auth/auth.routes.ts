import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  updateProfileSchema,
} from './auth.schemas.js';
import {
  changePassword,
  getCurrentUser,
  getSessionSummary,
  login,
  logout,
  refreshSession,
  register,
  revokeAllSessions,
  updateCurrentUser,
} from './auth.service.js';

export const authRouter = Router();

authRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message: '请求过于频繁，请稍后再试',
        },
      });
    },
  }),
);

authRouter.post('/register', async (request, response) => {
  const result = await register(registerSchema.parse(request.body));
  response.status(201).json({ data: result });
});

authRouter.post('/login', async (request, response) => {
  const result = await login(loginSchema.parse(request.body));
  response.json({ data: result });
});

authRouter.post('/refresh', async (request, response) => {
  const input = refreshSchema.parse(request.body);
  const result = await refreshSession(input.refreshToken);
  response.json({ data: result });
});

authRouter.post('/logout', async (request, response) => {
  const input = refreshSchema.parse(request.body);
  await logout(input.refreshToken);
  response.status(204).send();
});

authRouter.patch('/password', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  await changePassword(request.auth.userId, changePasswordSchema.parse(request.body));
  response.status(204).send();
});

authRouter.get('/me', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  response.json({ data: await getCurrentUser(request.auth.userId) });
});

authRouter.patch('/me', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  const user = await updateCurrentUser(
    request.auth.userId,
    updateProfileSchema.parse(request.body),
  );
  response.json({ data: user });
});

authRouter.get('/sessions', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  response.json({ data: await getSessionSummary(request.auth.userId) });
});

authRouter.delete('/sessions', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  const revokedSessions = await revokeAllSessions(request.auth.userId);
  response.json({ data: { revokedSessions } });
});
