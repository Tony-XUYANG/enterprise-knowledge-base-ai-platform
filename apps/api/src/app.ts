import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { query } from './db/pool.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { adminAuditRouter } from './modules/admin-audit/admin-audit.routes.js';
import { adminUsersRouter } from './modules/admin-users/admin-users.routes.js';
import { appsRouter } from './modules/apps/apps.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { conversationsRouter } from './modules/conversations/conversations.routes.js';
import { externalAppRouter } from './modules/external-app/external-app.routes.js';
import { knowledgeBasesRouter } from './modules/knowledge-bases/knowledge-bases.routes.js';
import {
  adminInvitationsRouter,
  invitationsRouter,
} from './modules/member-invitations/member-invitations.routes.js';
import { overviewRouter } from './modules/overview/overview.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(
    pinoHttp({
      level: env.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.idempotency-key',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.token',
        'req.body.code',
        'req.body.mfaToken',
        'req.body.refreshToken',
        'req.body.fastgptApiKey',
        'req.body.message',
      ],
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '4mb' }));

  app.get('/health/live', (_request, response) => {
    response.json({
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    });
  });

  const readinessHandler = async (_request: express.Request, response: express.Response) => {
    try {
      await query('SELECT 1');
      response.json({
        data: {
          status: 'ok',
          database: 'connected',
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      response.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: '数据库暂时不可用',
        },
      });
    }
  };

  app.get('/health/ready', readinessHandler);
  app.get('/health', readinessHandler);

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/admin/audit-events', adminAuditRouter);
  app.use('/api/v1/admin/users', adminUsersRouter);
  app.use('/api/v1/admin/invitations', adminInvitationsRouter);
  app.use('/api/v1/invitations', invitationsRouter);
  app.use('/api/v1/apps', appsRouter);
  app.use('/api/v1/knowledge-bases', knowledgeBasesRouter);
  app.use('/api/v1/conversations', conversationsRouter);
  app.use('/api/v1/external', externalAppRouter);
  app.use('/api/v1/overview', overviewRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
