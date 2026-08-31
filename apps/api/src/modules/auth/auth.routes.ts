import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  securityEventQuerySchema,
  sessionIdSchema,
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
  revokeSession,
  type SessionContext,
  updateCurrentUser,
} from './auth.service.js';
import { getSecurityEvents } from './security-events.service.js';

export const authRouter = Router();

function sessionContext(request: Request): SessionContext {
  const userAgent = request.header('user-agent')?.trim().slice(0, 512) || null;
  const rawIpAddress = request.ip || request.socket.remoteAddress || '';
  const ipAddress = rawIpAddress.replace(/^::ffff:/u, '') || null;
  return { userAgent, ipAddress };
}

const credentialRateLimiter = rateLimit({
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
});

const sessionCredentialRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
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
});

authRouter.post('/register', credentialRateLimiter, async (request, response) => {
  const result = await register(registerSchema.parse(request.body), sessionContext(request));
  response.status(201).json({ data: result });
});

authRouter.post('/login', credentialRateLimiter, async (request, response) => {
  const result = await login(loginSchema.parse(request.body), sessionContext(request));
  response.json({ data: result });
});

authRouter.post('/refresh', sessionCredentialRateLimiter, async (request, response) => {
  const input = refreshSchema.parse(request.body);
  const result = await refreshSession(input.refreshToken, sessionContext(request));
  response.json({ data: result });
});

authRouter.post('/logout', sessionCredentialRateLimiter, async (request, response) => {
  const input = refreshSchema.parse(request.body);
  await logout(input.refreshToken, sessionContext(request));
  response.status(204).send();
});

authRouter.patch('/password', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  await changePassword(
    request.auth.userId,
    changePasswordSchema.parse(request.body),
    sessionContext(request),
    request.auth.sessionId,
  );
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
    sessionContext(request),
    request.auth.sessionId,
  );
  response.json({ data: user });
});

authRouter.get('/sessions', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  response.json({
    data: await getSessionSummary(request.auth.userId, request.auth.sessionId),
  });
});

authRouter.get('/security-events', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  const input = securityEventQuerySchema.parse(request.query);
  response.json({
    data: await getSecurityEvents(request.auth.userId, input.limit),
  });
});

authRouter.delete('/sessions/:sessionId', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  response.json({
    data: await revokeSession(
      request.auth.userId,
      sessionIdSchema.parse(request.params.sessionId),
      sessionContext(request),
      request.auth.sessionId,
    ),
  });
});

authRouter.delete('/sessions', authenticate, async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  const revokedSessions = await revokeAllSessions(
    request.auth.userId,
    sessionContext(request),
    request.auth.sessionId,
  );
  response.json({ data: { revokedSessions } });
});
