import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeAdmin } from '../../middleware/authorize-admin.js';
import {
  adminAuditStatsQuerySchema,
  listAdminAuditEventsQuerySchema,
} from './admin-audit.schemas.js';
import {
  getAdminAuditStats,
  listAdminAuditEvents,
} from './admin-audit.service.js';

export const adminAuditRouter = Router();

adminAuditRouter.use(authenticate, authorizeAdmin);

adminAuditRouter.get('/stats', async (request, response) => {
  const { range } = adminAuditStatsQuerySchema.parse(request.query);
  response.json({ data: await getAdminAuditStats(range) });
});

adminAuditRouter.get('/', async (request, response) => {
  response.json({
    data: await listAdminAuditEvents(listAdminAuditEventsQuerySchema.parse(request.query)),
  });
});
