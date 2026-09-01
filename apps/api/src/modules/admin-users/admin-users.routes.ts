import { Router, type Request } from 'express';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeAdmin } from '../../middleware/authorize-admin.js';
import type { SessionContext } from '../auth/auth.service.js';
import {
  listManagedUsersQuerySchema,
  managedUserIdSchema,
  updateManagedUserSchema,
} from './admin-users.schemas.js';
import {
  getManagedUserStats,
  listManagedUsers,
  updateManagedUser,
} from './admin-users.service.js';

export const adminUsersRouter = Router();

adminUsersRouter.use(authenticate, authorizeAdmin);

function authenticatedRequest(request: Request) {
  if (!request.auth?.sessionId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  return request.auth;
}

function sessionContext(request: Request): SessionContext {
  const userAgent = request.header('user-agent')?.trim().slice(0, 512) || null;
  const rawIpAddress = request.ip || request.socket.remoteAddress || '';
  return {
    userAgent,
    ipAddress: rawIpAddress.replace(/^::ffff:/u, '') || null,
  };
}

adminUsersRouter.get('/', async (request, response) => {
  const auth = authenticatedRequest(request);
  response.json({
    data: await listManagedUsers(
      auth.userId,
      listManagedUsersQuerySchema.parse(request.query),
    ),
  });
});

adminUsersRouter.get('/stats', async (_request, response) => {
  response.json({ data: await getManagedUserStats() });
});

adminUsersRouter.patch('/:userId', async (request, response) => {
  const auth = authenticatedRequest(request);
  response.json({
    data: await updateManagedUser(
      auth.userId,
      auth.sessionId!,
      managedUserIdSchema.parse(request.params.userId),
      updateManagedUserSchema.parse(request.body),
      sessionContext(request),
    ),
  });
});
