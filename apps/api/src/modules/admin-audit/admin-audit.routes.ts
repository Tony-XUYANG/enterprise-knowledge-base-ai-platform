import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeAdmin } from '../../middleware/authorize-admin.js';
import type { SessionContext } from '../auth/auth.service.js';
import { recordSecurityEvent } from '../auth/security-events.service.js';
import {
  adminAuditStatsQuerySchema,
  exportAdminAuditEventsQuerySchema,
  listAdminAuditEventsQuerySchema,
} from './admin-audit.schemas.js';
import {
  exportAdminAuditEvents,
  getAdminAuditStats,
  listAdminAuditEvents,
} from './admin-audit.service.js';

export const adminAuditRouter = Router();

adminAuditRouter.use(authenticate, authorizeAdmin);

function authenticatedAdmin(request: Request) {
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

const auditExportRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: 'AUDIT_EXPORT_RATE_LIMITED',
        message: '审计日志导出过于频繁，请稍后再试',
      },
    });
  },
});

adminAuditRouter.get('/export', auditExportRateLimiter, async (request, response) => {
  const auth = authenticatedAdmin(request);
  const filters = exportAdminAuditEventsQuerySchema.parse(request.query);
  const result = await exportAdminAuditEvents(filters);
  await recordSecurityEvent({
    userId: auth.userId,
    eventType: 'admin_audit_exported',
    outcome: 'success',
    context: sessionContext(request),
    actorSessionId: auth.sessionId!,
    metadata: {
      range: filters.range,
      eventType: filters.eventType ?? null,
      outcome: filters.outcome ?? null,
      searchApplied: Boolean(filters.search),
      exportedRows: result.rowCount,
      truncated: result.truncated,
    },
  });
  response
    .status(200)
    .set({
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Type': 'text/csv; charset=utf-8',
      'X-Export-Row-Count': String(result.rowCount),
      'X-Export-Truncated': String(result.truncated),
    })
    .send(Buffer.from(result.contents, 'utf8'));
});

adminAuditRouter.get('/stats', async (request, response) => {
  const { range } = adminAuditStatsQuerySchema.parse(request.query);
  response.json({ data: await getAdminAuditStats(range) });
});

adminAuditRouter.get('/', async (request, response) => {
  response.json({
    data: await listAdminAuditEvents(listAdminAuditEventsQuerySchema.parse(request.query)),
  });
});
