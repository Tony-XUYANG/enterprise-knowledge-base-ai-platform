import { Router } from 'express';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import { getOverview } from './overview.service.js';

export const overviewRouter = Router();

overviewRouter.use(authenticate);

overviewRouter.get('/', async (request, response) => {
  if (!request.auth) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  response.json({ data: await getOverview(request.auth.userId) });
});
