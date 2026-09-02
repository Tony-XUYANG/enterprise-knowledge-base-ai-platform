import type { PoolClient } from 'pg';
import { pool, query } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { describeClientDevice, type DeviceType } from './session-device.js';
import type { SessionContext } from './auth.service.js';

export type SecurityEventType =
  | 'account_registered'
  | 'login_succeeded'
  | 'login_failed'
  | 'account_locked'
  | 'account_unlocked'
  | 'profile_updated'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'refresh_token_reused'
  | 'session_revoked'
  | 'all_sessions_revoked'
  | 'logout'
  | 'mfa_setup_started'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_recovery_codes_regenerated'
  | 'mfa_login_failed'
  | 'email_verification_requested'
  | 'email_verified'
  | 'user_role_changed'
  | 'user_status_changed'
  | 'member_invitation_sent'
  | 'member_invitation_revoked'
  | 'member_invitation_accepted';

export type SecurityEventOutcome = 'success' | 'failure';

type SecurityEventMetadataValue = string | number | boolean | null;

interface SecurityEventRow {
  id: string;
  event_type: SecurityEventType;
  outcome: SecurityEventOutcome;
  actor_session_id: string | null;
  target_session_id: string | null;
  user_agent: string | null;
  ip_address: string | null;
  metadata: Record<string, SecurityEventMetadataValue>;
  created_at: Date;
}

interface RecordSecurityEventInput {
  userId: string;
  eventType: SecurityEventType;
  outcome: SecurityEventOutcome;
  context: SessionContext;
  actorSessionId?: string | undefined;
  targetSessionId?: string | undefined;
  metadata?: Record<string, SecurityEventMetadataValue>;
}

export interface SecurityEvent {
  id: string;
  eventType: SecurityEventType;
  outcome: SecurityEventOutcome;
  actorSessionId: string | null;
  targetSessionId: string | null;
  deviceName: string;
  deviceType: DeviceType;
  userAgent: string | null;
  ipAddress: string | null;
  metadata: Record<string, SecurityEventMetadataValue>;
  createdAt: string;
}

export interface SecurityEventList {
  items: SecurityEvent[];
  total: number;
}

export async function recordSecurityEvent(
  input: RecordSecurityEventInput,
  client: Pick<PoolClient, 'query'> = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO security_events (
       user_id, event_type, outcome, actor_session_id, target_session_id,
       user_agent, ip_address, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8::jsonb)`,
    [
      input.userId,
      input.eventType,
      input.outcome,
      input.actorSessionId ?? null,
      input.targetSessionId ?? null,
      input.context.userAgent,
      input.context.ipAddress,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function getSecurityEvents(
  userId: string,
  limit: number,
): Promise<SecurityEventList> {
  const userResult = await query<{ status: 'active' | 'disabled' }>(
    'SELECT status FROM users WHERE id = $1',
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌对应的用户不存在');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'USER_DISABLED', '账号已被停用');
  }

  const [eventsResult, countResult] = await Promise.all([
    query<SecurityEventRow>(
      `SELECT id, event_type, outcome, actor_session_id, target_session_id,
              user_agent, host(ip_address) AS ip_address, metadata, created_at
         FROM security_events
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [userId, limit],
    ),
    query<{ total: string }>(
      'SELECT count(*)::text AS total FROM security_events WHERE user_id = $1',
      [userId],
    ),
  ]);

  return {
    items: eventsResult.rows.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      outcome: event.outcome,
      actorSessionId: event.actor_session_id,
      targetSessionId: event.target_session_id,
      ...describeClientDevice(event.user_agent),
      userAgent: event.user_agent,
      ipAddress: event.ip_address,
      metadata: event.metadata,
      createdAt: event.created_at.toISOString(),
    })),
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}
