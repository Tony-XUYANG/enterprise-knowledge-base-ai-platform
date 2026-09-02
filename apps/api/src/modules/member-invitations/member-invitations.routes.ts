import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeAdmin } from '../../middleware/authorize-admin.js';
import type { SessionContext } from '../auth/auth.service.js';
import { sendMemberInvitationMessage } from './member-invitation-mailer.js';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  invitationIdSchema,
  invitationTokenSchema,
  listInvitationsQuerySchema,
} from './member-invitations.schemas.js';
import {
  acceptMemberInvitation,
  createMemberInvitation,
  failInvitationDelivery,
  inspectMemberInvitation,
  listMemberInvitations,
  markInvitationDelivered,
  resendMemberInvitation,
  revokeMemberInvitation,
  type InvitationDelivery,
} from './member-invitations.service.js';

export const adminInvitationsRouter = Router();
export const invitationsRouter = Router();

function sessionContext(request: Request): SessionContext {
  const userAgent = request.header('user-agent')?.trim().slice(0, 512) || null;
  const rawIpAddress = request.ip || request.socket.remoteAddress || '';
  return {
    userAgent,
    ipAddress: rawIpAddress.replace(/^::ffff:/u, '') || null,
  };
}

function authenticatedAdmin(request: Request) {
  if (!request.auth?.sessionId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }
  return request.auth;
}

const adminInvitationRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: 'INVITATION_RATE_LIMITED',
        message: '邀请操作过于频繁，请稍后再试',
      },
    });
  },
});

const invitationAcceptanceRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: 'INVITATION_RATE_LIMITED',
        message: '邀请验证请求过于频繁，请稍后再试',
      },
    });
  },
});

async function deliverInvitation(
  request: Request,
  delivery: InvitationDelivery,
  action: 'created' | 'resent',
): Promise<void> {
  const auth = authenticatedAdmin(request);
  const context = sessionContext(request);
  try {
    const invitationUrl = new URL('/accept-invitation', env.WEB_BASE_URL);
    invitationUrl.searchParams.set('token', delivery.token);
    await sendMemberInvitationMessage({
      email: delivery.email,
      inviterName: delivery.inviterName,
      role: delivery.role,
      invitationUrl: invitationUrl.toString(),
      expiresInHours: env.MEMBER_INVITATION_TTL_HOURS,
    });
    await markInvitationDelivered(
      delivery.id,
      auth.userId,
      auth.sessionId!,
      context,
      action,
    );
  } catch (error) {
    await failInvitationDelivery(
      delivery.id,
      auth.userId,
      auth.sessionId!,
      context,
    );
    request.log.error({ err: error, invitationId: delivery.id }, 'Member invitation delivery failed');
    throw new AppError(502, 'INVITATION_DELIVERY_FAILED', '邀请邮件发送失败，请稍后重试');
  }
}

adminInvitationsRouter.use(authenticate, authorizeAdmin);

adminInvitationsRouter.get('/', async (request, response) => {
  response.json({
    data: await listMemberInvitations(listInvitationsQuerySchema.parse(request.query)),
  });
});

adminInvitationsRouter.post('/', adminInvitationRateLimiter, async (request, response) => {
  const auth = authenticatedAdmin(request);
  const delivery = await createMemberInvitation(
    auth.userId,
    createInvitationSchema.parse(request.body),
  );
  await deliverInvitation(request, delivery, 'created');
  response.status(201).json({
    data: {
      id: delivery.id,
      email: delivery.email,
      role: delivery.role,
      expiresAt: delivery.expiresAt.toISOString(),
    },
  });
});

adminInvitationsRouter.post('/:invitationId/resend', adminInvitationRateLimiter, async (request, response) => {
  const auth = authenticatedAdmin(request);
  const delivery = await resendMemberInvitation(
    auth.userId,
    invitationIdSchema.parse(request.params.invitationId),
  );
  await deliverInvitation(request, delivery, 'resent');
  response.json({
    data: {
      id: delivery.id,
      email: delivery.email,
      role: delivery.role,
      expiresAt: delivery.expiresAt.toISOString(),
    },
  });
});

adminInvitationsRouter.delete('/:invitationId', adminInvitationRateLimiter, async (request, response) => {
  const auth = authenticatedAdmin(request);
  await revokeMemberInvitation(
    auth.userId,
    auth.sessionId!,
    invitationIdSchema.parse(request.params.invitationId),
    sessionContext(request),
  );
  response.status(204).send();
});

invitationsRouter.post('/inspect', invitationAcceptanceRateLimiter, async (request, response) => {
  const token = invitationTokenSchema.parse(request.body?.token);
  response.json({ data: await inspectMemberInvitation(token) });
});

invitationsRouter.post('/accept', invitationAcceptanceRateLimiter, async (request, response) => {
  response.status(201).json({
    data: await acceptMemberInvitation(
      acceptInvitationSchema.parse(request.body),
      sessionContext(request),
    ),
  });
});
