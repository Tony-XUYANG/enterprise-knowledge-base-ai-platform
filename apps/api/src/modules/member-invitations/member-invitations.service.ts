import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { isPostgreSqlError } from '../../db/pg-error.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { hashPassword } from '../../security/password.js';
import {
  assessPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MIN_CHARACTERS,
  PASSWORD_REQUIRED_CATEGORIES,
} from '../../security/password-policy.js';
import type { SessionContext } from '../auth/auth.service.js';
import { recordSecurityEvent } from '../auth/security-events.service.js';
import type {
  AcceptInvitationInput,
  CreateInvitationInput,
  InvitationRole,
  InvitationStatus,
  ListInvitationsQuery,
} from './member-invitations.schemas.js';

interface InvitationRow {
  id: string;
  email: string;
  role: InvitationRole;
  invited_by: string | null;
  inviter_name: string | null;
  expires_at: Date;
  delivered_at: Date | null;
  accepted_at: Date | null;
  revoked_at: Date | null;
  send_count: number;
  created_at: Date;
  updated_at: Date;
  status: InvitationStatus;
}

interface InvitationAcceptanceRow {
  id: string;
  email: string;
  role: InvitationRole;
  expires_at: Date;
  delivered_at: Date | null;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

export interface MemberInvitation {
  id: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  inviterName: string | null;
  expiresAt: string;
  deliveredAt: string | null;
  acceptedAt: string | null;
  sendCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemberInvitationList {
  items: MemberInvitation[];
  page: number;
  pageSize: number;
  total: number;
}

export interface InvitationDelivery {
  id: string;
  email: string;
  inviterName: string;
  role: InvitationRole;
  token: string;
  expiresAt: Date;
}

export interface InvitationPreview {
  email: string;
  role: InvitationRole;
  inviterName: string | null;
  expiresAt: string;
}

export interface InvitationAcceptance {
  email: string;
  displayName: string;
  role: InvitationRole;
}

const invitationSelect = `
  invitation.id, invitation.email, invitation.role, invitation.invited_by,
  inviter.display_name AS inviter_name, invitation.expires_at,
  invitation.delivered_at, invitation.accepted_at, invitation.revoked_at,
  invitation.send_count, invitation.created_at, invitation.updated_at,
  CASE
    WHEN invitation.accepted_at IS NOT NULL THEN 'accepted'
    WHEN invitation.revoked_at IS NOT NULL THEN 'revoked'
    WHEN invitation.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
    ELSE 'pending'
  END AS status`;

function createToken(): string {
  return randomBytes(48).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function expiresAt(): Date {
  return new Date(Date.now() + env.MEMBER_INVITATION_TTL_HOURS * 60 * 60_000);
}

function mapInvitation(row: InvitationRow): MemberInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    inviterName: row.inviter_name,
    expiresAt: row.expires_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    sendCount: row.send_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function assertStrongInvitationPassword(
  password: string,
  email: string,
  displayName: string,
): void {
  const assessment = assessPassword(password, { email, displayName });
  if (assessment.acceptable) return;
  const violations: string[] = [];
  if (!assessment.checks.length) {
    violations.push(`密码需要 ${PASSWORD_MIN_CHARACTERS}-${PASSWORD_MAX_CHARACTERS} 个字符`);
  }
  if (!assessment.checks.byteLimit) {
    violations.push(`密码 UTF-8 编码不能超过 ${PASSWORD_MAX_BYTES} 字节`);
  }
  if (!assessment.checks.categories) {
    violations.push(
      `密码需要在大写字母、小写字母、数字和符号中至少包含 ${PASSWORD_REQUIRED_CATEGORIES} 类`,
    );
  }
  if (!assessment.checks.unpredictable) {
    violations.push('密码不能使用常见密码、连续字符或大量重复字符');
  }
  if (!assessment.checks.excludesIdentity) {
    violations.push('密码不能包含姓名或邮箱前缀');
  }
  throw new AppError(
    400,
    'PASSWORD_POLICY_VIOLATION',
    '密码安全等级未达到要求',
    { violations },
  );
}

async function actorName(client: PoolClient, userId: string): Promise<string> {
  const result = await client.query<{ display_name: string }>(
    `SELECT display_name FROM users WHERE id = $1 AND status = 'active'`,
    [userId],
  );
  const actor = result.rows[0];
  if (!actor) throw new AppError(403, 'USER_DISABLED', '账号已被停用');
  return actor.display_name;
}

export async function createMemberInvitation(
  actorUserId: string,
  input: CreateInvitationInput,
): Promise<InvitationDelivery> {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.email]);
    const existingUser = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE email = $1) AS exists',
      [input.email],
    );
    if (existingUser.rows[0]?.exists) {
      throw new AppError(409, 'USER_ALREADY_EXISTS', '该邮箱已是平台成员');
    }

    await client.query(
      `UPDATE member_invitations
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE email = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL`,
      [input.email],
    );
    const inviterName = await actorName(client, actorUserId);
    const token = createToken();
    const expiry = expiresAt();
    const result = await client.query<{ id: string }>(
      `INSERT INTO member_invitations (
         email, role, token_hash, invited_by, expires_at
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [input.email, input.role, hashToken(token), actorUserId, expiry],
    );
    return {
      id: result.rows[0]!.id,
      email: input.email,
      inviterName,
      role: input.role,
      token,
      expiresAt: expiry,
    };
  });
}

export async function resendMemberInvitation(
  actorUserId: string,
  invitationId: string,
): Promise<InvitationDelivery> {
  const delivery = await withTransaction<InvitationDelivery | null>(async (client) => {
    const invitationEmailResult = await client.query<{ email: string }>(
      'SELECT email FROM member_invitations WHERE id = $1',
      [invitationId],
    );
    const invitationEmail = invitationEmailResult.rows[0]?.email;
    if (!invitationEmail) {
      throw new AppError(404, 'INVITATION_NOT_FOUND', '待处理邀请不存在');
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [invitationEmail]);

    const invitationResult = await client.query<{
      id: string;
      email: string;
      role: InvitationRole;
      accepted_at: Date | null;
      revoked_at: Date | null;
      send_count: number;
    }>(
      `SELECT id, email, role, accepted_at, revoked_at, send_count
         FROM member_invitations
        WHERE id = $1
        FOR UPDATE`,
      [invitationId],
    );
    const invitation = invitationResult.rows[0];
    if (!invitation || invitation.accepted_at || invitation.revoked_at) {
      throw new AppError(404, 'INVITATION_NOT_FOUND', '待处理邀请不存在');
    }
    if (invitation.send_count >= 20) {
      throw new AppError(409, 'INVITATION_SEND_LIMIT_REACHED', '该邀请已达到最大发送次数');
    }
    const existingUser = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE email = $1) AS exists',
      [invitation.email],
    );
    if (existingUser.rows[0]?.exists) {
      await client.query(
        'UPDATE member_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1',
        [invitation.id],
      );
      return null;
    }

    const inviterName = await actorName(client, actorUserId);
    const token = createToken();
    const expiry = expiresAt();
    await client.query(
      `UPDATE member_invitations
          SET token_hash = $2,
              invited_by = $3,
              expires_at = $4,
              delivered_at = NULL,
              send_count = send_count + 1
        WHERE id = $1`,
      [invitation.id, hashToken(token), actorUserId, expiry],
    );
    return {
      id: invitation.id,
      email: invitation.email,
      inviterName,
      role: invitation.role,
      token,
      expiresAt: expiry,
    };
  });
  if (!delivery) {
    throw new AppError(409, 'USER_ALREADY_EXISTS', '该邮箱已是平台成员');
  }
  return delivery;
}

export async function markInvitationDelivered(
  invitationId: string,
  actorUserId: string,
  actorSessionId: string,
  context: SessionContext,
  action: 'created' | 'resent',
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ email: string; role: InvitationRole }>(
      `UPDATE member_invitations
          SET delivered_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL
        RETURNING email, role`,
      [invitationId],
    );
    const invitation = result.rows[0];
    if (!invitation) throw new AppError(404, 'INVITATION_NOT_FOUND', '待处理邀请不存在');
    await recordSecurityEvent({
      userId: actorUserId,
      eventType: 'member_invitation_sent',
      outcome: 'success',
      context,
      actorSessionId,
      metadata: {
        invitationId,
        targetEmail: invitation.email,
        role: invitation.role,
        action,
      },
    }, client);
  });
}

export async function failInvitationDelivery(
  invitationId: string,
  actorUserId: string,
  actorSessionId: string,
  context: SessionContext,
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ email: string; role: InvitationRole }>(
      `UPDATE member_invitations
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL
        RETURNING email, role`,
      [invitationId],
    );
    const invitation = result.rows[0];
    if (!invitation) return;
    await recordSecurityEvent({
      userId: actorUserId,
      eventType: 'member_invitation_sent',
      outcome: 'failure',
      context,
      actorSessionId,
      metadata: {
        invitationId,
        targetEmail: invitation.email,
        role: invitation.role,
        reason: 'delivery_failed',
      },
    }, client);
  });
}

export async function revokeMemberInvitation(
  actorUserId: string,
  actorSessionId: string,
  invitationId: string,
  context: SessionContext,
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ email: string; role: InvitationRole }>(
      `UPDATE member_invitations
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND accepted_at IS NULL
          AND revoked_at IS NULL
        RETURNING email, role`,
      [invitationId],
    );
    const invitation = result.rows[0];
    if (!invitation) throw new AppError(404, 'INVITATION_NOT_FOUND', '待处理邀请不存在');
    await recordSecurityEvent({
      userId: actorUserId,
      eventType: 'member_invitation_revoked',
      outcome: 'success',
      context,
      actorSessionId,
      metadata: {
        invitationId,
        targetEmail: invitation.email,
        role: invitation.role,
      },
    }, client);
  });
}

export async function listMemberInvitations(
  input: ListInvitationsQuery,
): Promise<MemberInvitationList> {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (input.status) {
    values.push(input.status);
    conditions.push(`CASE
      WHEN invitation.accepted_at IS NOT NULL THEN 'accepted'
      WHEN invitation.revoked_at IS NOT NULL THEN 'revoked'
      WHEN invitation.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
      ELSE 'pending'
    END = $${values.length}`);
  }
  if (input.search) {
    values.push(`%${input.search}%`);
    conditions.push(`invitation.email ILIKE $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (input.page - 1) * input.pageSize;
  const [itemsResult, countResult] = await Promise.all([
    query<InvitationRow>(
      `SELECT ${invitationSelect}
         FROM member_invitations invitation
         LEFT JOIN users inviter ON inviter.id = invitation.invited_by
         ${where}
        ORDER BY invitation.created_at DESC, invitation.id DESC
        LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, input.pageSize, offset],
    ),
    query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM member_invitations invitation
         ${where}`,
      values,
    ),
  ]);
  return {
    items: itemsResult.rows.map(mapInvitation),
    page: input.page,
    pageSize: input.pageSize,
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

export async function inspectMemberInvitation(token: string): Promise<InvitationPreview> {
  const result = await query<InvitationRow>(
    `SELECT ${invitationSelect}
       FROM member_invitations invitation
       LEFT JOIN users inviter ON inviter.id = invitation.invited_by
      WHERE invitation.token_hash = $1
        AND invitation.delivered_at IS NOT NULL
        AND invitation.accepted_at IS NULL
        AND invitation.revoked_at IS NULL
        AND invitation.expires_at > CURRENT_TIMESTAMP`,
    [hashToken(token)],
  );
  const invitation = result.rows[0];
  if (!invitation) {
    throw new AppError(400, 'INVITATION_INVALID', '邀请链接无效或已过期');
  }
  return {
    email: invitation.email,
    role: invitation.role,
    inviterName: invitation.inviter_name,
    expiresAt: invitation.expires_at.toISOString(),
  };
}

export async function acceptMemberInvitation(
  input: AcceptInvitationInput,
  context: SessionContext,
): Promise<InvitationAcceptance> {
  return withTransaction(async (client) => {
    const invitationEmailResult = await client.query<{ email: string }>(
      'SELECT email FROM member_invitations WHERE token_hash = $1',
      [hashToken(input.token)],
    );
    const invitationEmail = invitationEmailResult.rows[0]?.email;
    if (!invitationEmail) {
      throw new AppError(400, 'INVITATION_INVALID', '邀请链接无效或已过期');
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [invitationEmail]);

    const result = await client.query<InvitationAcceptanceRow>(
      `SELECT id, email, role, expires_at, delivered_at, accepted_at, revoked_at
         FROM member_invitations
        WHERE token_hash = $1
        FOR UPDATE`,
      [hashToken(input.token)],
    );
    const invitation = result.rows[0];
    if (
      !invitation
      || !invitation.delivered_at
      || invitation.accepted_at
      || invitation.revoked_at
      || invitation.expires_at <= new Date()
    ) {
      throw new AppError(400, 'INVITATION_INVALID', '邀请链接无效或已过期');
    }

    const existingUser = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE email = $1) AS exists',
      [invitation.email],
    );
    if (existingUser.rows[0]?.exists) {
      throw new AppError(400, 'INVITATION_INVALID', '邀请链接无效或已过期');
    }
    assertStrongInvitationPassword(input.password, invitation.email, input.displayName);
    const passwordHash = await hashPassword(input.password);

    let userId: string;
    try {
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (
           email, password_hash, display_name, email_verified_at
         ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         RETURNING id`,
        [invitation.email, passwordHash, input.displayName],
      );
      userId = userResult.rows[0]!.id;
    } catch (error) {
      if (isPostgreSqlError(error) && error.code === '23505') {
        throw new AppError(400, 'INVITATION_INVALID', '邀请链接无效或已过期');
      }
      throw error;
    }

    const roleResult = await client.query<{ id: number }>(
      'SELECT id FROM roles WHERE code = $1',
      [invitation.role],
    );
    const role = roleResult.rows[0];
    if (!role) throw new AppError(500, 'ROLE_MISSING', '数据库缺少邀请角色');
    await client.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [userId, role.id],
    );
    await client.query(
      `INSERT INTO user_password_history (user_id, password_hash)
       VALUES ($1, $2)`,
      [userId, passwordHash],
    );
    await client.query(
      `UPDATE member_invitations
          SET accepted_at = CURRENT_TIMESTAMP,
              accepted_by = $2
        WHERE id = $1`,
      [invitation.id, userId],
    );
    await recordSecurityEvent({
      userId,
      eventType: 'account_registered',
      outcome: 'success',
      context,
      metadata: { registrationMethod: 'invitation' },
    }, client);
    await recordSecurityEvent({
      userId,
      eventType: 'member_invitation_accepted',
      outcome: 'success',
      context,
      metadata: { invitationId: invitation.id, role: invitation.role },
    }, client);
    return {
      email: invitation.email,
      displayName: input.displayName,
      role: invitation.role,
    };
  });
}
