import { Router } from 'express';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import { knowledgeBaseIdSchema } from '../knowledge-bases/knowledge-bases.schemas.js';
import {
  attachKnowledgeBaseToApp,
  detachKnowledgeBaseFromApp,
  listAppKnowledgeBases,
} from '../knowledge-bases/knowledge-bases.service.js';
import {
  appIdSchema,
  createAppSchema,
  listAppsQuerySchema,
  updateAppSchema,
} from './apps.schemas.js';
import {
  createApp,
  disableApp,
  getApp,
  getAppStats,
  listApps,
  updateApp,
} from './apps.service.js';

export const appsRouter = Router();

appsRouter.use(authenticate);

function authenticatedUserId(request: Express.Request): string {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  return request.auth.userId;
}

appsRouter.post('/', async (request, response) => {
  const app = await createApp(
    authenticatedUserId(request),
    createAppSchema.parse(request.body),
  );
  response.status(201).json({ data: app });
});

appsRouter.get('/', async (request, response) => {
  const result = await listApps(
    authenticatedUserId(request),
    listAppsQuerySchema.parse(request.query),
  );
  response.json({ data: result });
});

appsRouter.get('/stats', async (request, response) => {
  response.json({ data: await getAppStats(authenticatedUserId(request)) });
});

appsRouter.get('/:appId', async (request, response) => {
  const app = await getApp(
    authenticatedUserId(request),
    appIdSchema.parse(request.params.appId),
  );
  response.json({ data: app });
});

appsRouter.patch('/:appId', async (request, response) => {
  const app = await updateApp(
    authenticatedUserId(request),
    appIdSchema.parse(request.params.appId),
    updateAppSchema.parse(request.body),
  );
  response.json({ data: app });
});

appsRouter.delete('/:appId', async (request, response) => {
  await disableApp(
    authenticatedUserId(request),
    appIdSchema.parse(request.params.appId),
  );
  response.status(204).send();
});

appsRouter.get('/:appId/knowledge-bases', async (request, response) => {
  const items = await listAppKnowledgeBases(
    authenticatedUserId(request),
    appIdSchema.parse(request.params.appId),
  );
  response.json({ data: items });
});

appsRouter.put('/:appId/knowledge-bases/:knowledgeBaseId', async (request, response) => {
  await attachKnowledgeBaseToApp(
    authenticatedUserId(request),
    appIdSchema.parse(request.params.appId),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
  );
  response.status(204).send();
});

appsRouter.delete('/:appId/knowledge-bases/:knowledgeBaseId', async (request, response) => {
  await detachKnowledgeBaseFromApp(
    authenticatedUserId(request),
    appIdSchema.parse(request.params.appId),
    knowledgeBaseIdSchema.parse(request.params.knowledgeBaseId),
  );
  response.status(204).send();
});
