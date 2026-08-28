import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { query } from './db/pool.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { appsRouter } from './modules/apps/apps.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { conversationsRouter } from './modules/conversations/conversations.routes.js';
import { knowledgeBasesRouter } from './modules/knowledge-bases/knowledge-bases.routes.js';
import { overviewRouter } from './modules/overview/overview.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.body.password', 'req.body.refreshToken'],
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', async (_request, response) => {
    await query('SELECT 1');
    response.json({
      data: {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/apps', appsRouter);
  app.use('/api/v1/knowledge-bases', knowledgeBasesRouter);
  app.use('/api/v1/conversations', conversationsRouter);
  app.use('/api/v1/overview', overviewRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
