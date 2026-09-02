import { query } from '../../db/pool.js';
import { describeClientDevice, type DeviceType } from '../auth/session-device.js';
import type {
  AdminAuditEventType,
  AdminAuditOutcome,
  AdminAuditRange,
  ExportAdminAuditEventsQuery,
  ListAdminAuditEventsQuery,
} from './admin-audit.schemas.js';

type AuditMetadataValue = string | number | boolean | null;

interface AdminAuditEventRow {
  id: string;
  event_type: AdminAuditEventType;
  outcome: AdminAuditOutcome;
  subject_user_id: string;
  subject_email: string;
  subject_display_name: string;
  actor_user_id: string;
  actor_email: string;
  actor_display_name: string;
  actor_session_id: string | null;
  target_session_id: string | null;
  user_agent: string | null;
  ip_address: string | null;
  metadata: Record<string, AuditMetadataValue>;
  created_at: Date;
}

export interface AuditUserSummary {
  id: string;
  email: string;
  displayName: string;
}

export interface AdminAuditEvent {
  id: string;
  eventType: AdminAuditEventType;
  outcome: AdminAuditOutcome;
  subject: AuditUserSummary;
  actor: AuditUserSummary;
  actorSessionId: string | null;
  targetSessionId: string | null;
  deviceName: string;
  deviceType: DeviceType;
  userAgent: string | null;
  ipAddress: string | null;
  metadata: Record<string, AuditMetadataValue>;
  createdAt: string;
}

export interface AdminAuditEventList {
  items: AdminAuditEvent[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminAuditStats {
  total: number;
  failures: number;
  affectedMembers: number;
  adminActions: number;
}

export interface AdminAuditExport {
  contents: string;
  filename: string;
  rowCount: number;
  truncated: boolean;
}

const auditExportLimit = 10_000;

const safeMetadataKeys = new Set([
  'action',
  'actorUserId',
  'currentSession',
  'displayNameChanged',
  'eventType',
  'expiresAt',
  'exportedRows',
  'failedAttempts',
  'failedAttemptsCleared',
  'invitationId',
  'lockedUntil',
  'mfaMethod',
  'outcome',
  'passwordHistoryLimit',
  'previousRole',
  'previousStatus',
  'reason',
  'recoveryCodeCount',
  'registrationMethod',
  'range',
  'remainingAttempts',
  'retryAfterSeconds',
  'revokedSessions',
  'role',
  'status',
  'searchApplied',
  'targetEmail',
  'truncated',
  'verificationMethod',
]);

const actorJoins = `
  LEFT JOIN refresh_tokens actor_session
    ON actor_session.id = event.actor_session_id
  LEFT JOIN users session_actor
    ON session_actor.id = actor_session.user_id
  LEFT JOIN users metadata_actor
    ON metadata_actor.id::text = event.metadata->>'actorUserId'`;

function rangeInterval(range: AdminAuditRange): string | null {
  return {
    '24h': '24 hours',
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    all: null,
  }[range];
}

function auditFilters(input: ExportAdminAuditEventsQuery) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const interval = rangeInterval(input.range);

  if (interval) {
    values.push(interval);
    conditions.push(`event.created_at >= CURRENT_TIMESTAMP - $${values.length}::interval`);
  }
  if (input.eventType) {
    values.push(input.eventType);
    conditions.push(`event.event_type = $${values.length}`);
  }
  if (input.outcome) {
    values.push(input.outcome);
    conditions.push(`event.outcome = $${values.length}`);
  }
  if (input.search) {
    values.push(`%${input.search}%`);
    conditions.push(`(
      subject.display_name ILIKE $${values.length}
      OR subject.email ILIKE $${values.length}
      OR COALESCE(session_actor.display_name, metadata_actor.display_name, subject.display_name)
        ILIKE $${values.length}
      OR COALESCE(session_actor.email, metadata_actor.email, subject.email)
        ILIKE $${values.length}
      OR COALESCE(event.metadata->>'targetEmail', '') ILIKE $${values.length}
      OR COALESCE(host(event.ip_address), '') ILIKE $${values.length}
    )`);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

async function selectAuditEventRows(
  input: ExportAdminAuditEventsQuery,
  limit: number,
  offset: number,
): Promise<AdminAuditEventRow[]> {
  const filter = auditFilters(input);
  const result = await query<AdminAuditEventRow>(
    `SELECT event.id, event.event_type, event.outcome,
            subject.id AS subject_user_id,
            subject.email AS subject_email,
            subject.display_name AS subject_display_name,
            COALESCE(session_actor.id, metadata_actor.id, subject.id) AS actor_user_id,
            COALESCE(session_actor.email, metadata_actor.email, subject.email) AS actor_email,
            COALESCE(
              session_actor.display_name,
              metadata_actor.display_name,
              subject.display_name
            ) AS actor_display_name,
            event.actor_session_id, event.target_session_id, event.user_agent,
            host(event.ip_address) AS ip_address, event.metadata, event.created_at
       FROM security_events event
       JOIN users subject ON subject.id = event.user_id
       ${actorJoins}
       ${filter.sql}
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT $${filter.values.length + 1}
     OFFSET $${filter.values.length + 2}`,
    [...filter.values, limit, offset],
  );
  return result.rows;
}

function mapAuditEvent(row: AdminAuditEventRow): AdminAuditEvent {
  const metadata = Object.fromEntries(
    Object.entries(row.metadata).filter(([key]) => safeMetadataKeys.has(key)),
  );
  return {
    id: row.id,
    eventType: row.event_type,
    outcome: row.outcome,
    subject: {
      id: row.subject_user_id,
      email: row.subject_email,
      displayName: row.subject_display_name,
    },
    actor: {
      id: row.actor_user_id,
      email: row.actor_email,
      displayName: row.actor_display_name,
    },
    actorSessionId: row.actor_session_id,
    targetSessionId: row.target_session_id,
    ...describeClientDevice(row.user_agent),
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    metadata,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listAdminAuditEvents(
  input: ListAdminAuditEventsQuery,
): Promise<AdminAuditEventList> {
  const filter = auditFilters(input);
  const offset = (input.page - 1) * input.pageSize;

  const [eventsResult, countResult] = await Promise.all([
    selectAuditEventRows(input, input.pageSize, offset),
    query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM security_events event
         JOIN users subject ON subject.id = event.user_id
         ${actorJoins}
         ${filter.sql}`,
      filter.values,
    ),
  ]);

  return {
    items: eventsResult.map(mapAuditEvent),
    page: input.page,
    pageSize: input.pageSize,
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

export async function getAdminAuditStats(range: AdminAuditRange): Promise<AdminAuditStats> {
  const interval = rangeInterval(range);
  const where = interval
    ? 'WHERE created_at >= CURRENT_TIMESTAMP - $1::interval'
    : '';
  const values = interval ? [interval] : [];
  const result = await query<{
    total: string;
    failures: string;
    affected_members: string;
    admin_actions: string;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE outcome = 'failure')::text AS failures,
            count(DISTINCT user_id)::text AS affected_members,
            count(*) FILTER (WHERE event_type IN (
              'user_role_changed',
              'user_status_changed',
              'member_invitation_sent',
              'member_invitation_revoked',
              'admin_audit_exported'
            ))::text AS admin_actions
       FROM security_events
       ${where}`,
    values,
  );
  const row = result.rows[0]!;
  return {
    total: Number(row.total),
    failures: Number(row.failures),
    affectedMembers: Number(row.affected_members),
    adminActions: Number(row.admin_actions),
  };
}

function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportFilename(now: Date): string {
  return `knowledgehub-audit-${now.toISOString().replace(/[-:]/gu, '').slice(0, 15)}Z.csv`;
}

export async function exportAdminAuditEvents(
  input: ExportAdminAuditEventsQuery,
): Promise<AdminAuditExport> {
  const rows = await selectAuditEventRows(input, auditExportLimit + 1, 0);
  const truncated = rows.length > auditExportLimit;
  const events = rows.slice(0, auditExportLimit).map(mapAuditEvent);
  const header = [
    '发生时间',
    '事件类型',
    '执行结果',
    '影响账号姓名',
    '影响账号邮箱',
    '操作人姓名',
    '操作人邮箱',
    '设备',
    '来源 IP',
    '目标邮箱',
    '原因',
  ];
  const records = events.map((event) => [
    event.createdAt,
    event.eventType,
    event.outcome,
    event.subject.displayName,
    event.subject.email,
    event.actor.displayName,
    event.actor.email,
    event.deviceName,
    event.ipAddress,
    typeof event.metadata.targetEmail === 'string' ? event.metadata.targetEmail : null,
    typeof event.metadata.reason === 'string' ? event.metadata.reason : null,
  ]);
  return {
    contents: `\ufeff${[header, ...records]
      .map((record) => record.map(csvCell).join(','))
      .join('\r\n')}\r\n`,
    filename: exportFilename(new Date()),
    rowCount: events.length,
    truncated,
  };
}
