import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type { SessionContext } from '../auth/auth.service.js';
import { recordSecurityEvent } from '../auth/security-events.service.js';
import type {
  ListManagedUsersQuery,
  ManagedUserRole,
  ManagedUserStatus,
  UpdateManagedUserInput,
} from './admin-users.schemas.js';

interface ManagedUserRow {
  id: string;
  email: string;
  display_name: string;
  status: ManagedUserStatus;
  email_verified_at: Date | null;
  mfa_enabled_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  roles: string[];
  active_sessions: string;
}

interface ManagedUserTargetRow {
  id: string;
  status: ManagedUserStatus;
  role: ManagedUserRole;
}

export interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  status: ManagedUserStatus;
  role: ManagedUserRole;
  emailVerifiedAt: string | null;
  mfaEnabledAt: string | null;
  lastLoginAt: string | null;
  activeSessions: number;
  current: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedUserList {
  items: ManagedUser[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ManagedUserStats {
  total: number;
  active: number;
  disabled: number;
  admins: number;
  pendingVerification: number;
}

function primaryRole(roles: string[]): ManagedUserRole {
  return roles.includes('admin') ? 'admin' : 'member';
}

function mapManagedUser(row: ManagedUserRow, actorUserId: string): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    role: primaryRole(row.roles),
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
    mfaEnabledAt: row.mfa_enabled_at?.toISOString() ?? null,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    activeSessions: Number(row.active_sessions),
    current: row.id === actorUserId,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function userFilters(input: ListManagedUsersQuery) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (input.status) {
    values.push(input.status);
    conditions.push(`u.status = $${values.length}`);
  }
  if (input.role) {
    values.push(input.role);
    conditions.push(`EXISTS (
      SELECT 1
        FROM user_roles filter_user_role
        JOIN roles filter_role ON filter_role.id = filter_user_role.role_id
       WHERE filter_user_role.user_id = u.id
         AND filter_role.code = $${values.length}
    )`);
  }
  if (input.search) {
    values.push(`%${input.search}%`);
    conditions.push(`(u.display_name ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }
  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

export async function listManagedUsers(
  actorUserId: string,
  input: ListManagedUsersQuery,
): Promise<ManagedUserList> {
  const filter = userFilters(input);
  const orderBy = {
    created_desc: 'u.created_at DESC, u.id DESC',
    last_login_desc: 'u.last_login_at DESC NULLS LAST, u.created_at DESC, u.id DESC',
    name_asc: 'lower(u.display_name), u.id',
  }[input.sort];
  const offset = (input.page - 1) * input.pageSize;
  const listValues = [...filter.values, input.pageSize, offset];

  const [usersResult, countResult] = await Promise.all([
    query<ManagedUserRow>(
      `SELECT u.id, u.email, u.display_name, u.status, u.email_verified_at,
              u.mfa_enabled_at, u.last_login_at, u.created_at, u.updated_at,
              COALESCE(
                array_agg(DISTINCT r.code ORDER BY r.code)
                  FILTER (WHERE r.code IS NOT NULL),
                ARRAY[]::varchar[]
              ) AS roles,
              count(DISTINCT rt.id) FILTER (
                WHERE rt.revoked_at IS NULL AND rt.expires_at > CURRENT_TIMESTAMP
              )::text AS active_sessions
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         LEFT JOIN refresh_tokens rt ON rt.user_id = u.id
         ${filter.sql}
        GROUP BY u.id
        ORDER BY ${orderBy}
        LIMIT $${filter.values.length + 1}
       OFFSET $${filter.values.length + 2}`,
      listValues,
    ),
    query<{ total: string }>(
      `SELECT count(*)::text AS total FROM users u ${filter.sql}`,
      filter.values,
    ),
  ]);

  return {
    items: usersResult.rows.map((row) => mapManagedUser(row, actorUserId)),
    page: input.page,
    pageSize: input.pageSize,
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

export async function getManagedUserStats(): Promise<ManagedUserStats> {
  const result = await query<{
    total: string;
    active: string;
    disabled: string;
    admins: string;
    pending_verification: string;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE u.status = 'active')::text AS active,
            count(*) FILTER (WHERE u.status = 'disabled')::text AS disabled,
            count(*) FILTER (WHERE u.email_verified_at IS NULL)::text AS pending_verification,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id AND r.code = 'admin'
            ))::text AS admins
       FROM users u`,
  );
  const row = result.rows[0]!;
  return {
    total: Number(row.total),
    active: Number(row.active),
    disabled: Number(row.disabled),
    admins: Number(row.admins),
    pendingVerification: Number(row.pending_verification),
  };
}

async function getTargetForUpdate(
  client: PoolClient,
  userId: string,
): Promise<ManagedUserTargetRow> {
  const result = await client.query<ManagedUserTargetRow>(
    `SELECT u.id, u.status,
            CASE WHEN EXISTS (
              SELECT 1
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id AND r.code = 'admin'
            ) THEN 'admin' ELSE 'member' END AS role
       FROM users u
      WHERE u.id = $1
      FOR UPDATE`,
    [userId],
  );
  const target = result.rows[0];
  if (!target) throw new AppError(404, 'USER_NOT_FOUND', '成员不存在');
  return target;
}

async function ensureAdminRemains(
  client: PoolClient,
  target: ManagedUserTargetRow,
  nextRole: ManagedUserRole,
  nextStatus: ManagedUserStatus,
): Promise<void> {
  if (target.role !== 'admin' || (nextRole === 'admin' && nextStatus === 'active')) return;
  const result = await client.query<{ remaining: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE r.code = 'admin'
          AND u.status = 'active'
          AND u.id <> $1
     ) AS remaining`,
    [target.id],
  );
  if (!result.rows[0]?.remaining) {
    throw new AppError(409, 'LAST_ADMIN_REQUIRED', '至少需要保留一位启用中的管理员');
  }
}

async function selectManagedUser(
  client: PoolClient,
  userId: string,
): Promise<ManagedUserRow> {
  const result = await client.query<ManagedUserRow>(
    `SELECT u.id, u.email, u.display_name, u.status, u.email_verified_at,
            u.mfa_enabled_at, u.last_login_at, u.created_at, u.updated_at,
            COALESCE(
              array_agg(DISTINCT r.code ORDER BY r.code)
                FILTER (WHERE r.code IS NOT NULL),
              ARRAY[]::varchar[]
            ) AS roles,
            count(DISTINCT rt.id) FILTER (
              WHERE rt.revoked_at IS NULL AND rt.expires_at > CURRENT_TIMESTAMP
            )::text AS active_sessions
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN refresh_tokens rt ON rt.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.id`,
    [userId],
  );
  return result.rows[0]!;
}

export async function updateManagedUser(
  actorUserId: string,
  actorSessionId: string,
  targetUserId: string,
  input: UpdateManagedUserInput,
  context: SessionContext,
): Promise<ManagedUser> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('knowledgehub_admin_role'))");
    const target = await getTargetForUpdate(client, targetUserId);
    const nextRole = input.role ?? target.role;
    const nextStatus = input.status ?? target.status;
    const roleChanged = nextRole !== target.role;
    const statusChanged = nextStatus !== target.status;

    if (target.id === actorUserId && (roleChanged || statusChanged)) {
      throw new AppError(409, 'SELF_ADMIN_UPDATE_FORBIDDEN', '不能修改自己的角色或账号状态');
    }
    await ensureAdminRemains(client, target, nextRole, nextStatus);

    if (roleChanged) {
      const roleResult = await client.query<{ id: number }>(
        'SELECT id FROM roles WHERE code = $1',
        [nextRole],
      );
      const role = roleResult.rows[0];
      if (!role) throw new AppError(500, 'ROLE_MISSING', '数据库缺少目标角色');
      await client.query(
        `DELETE FROM user_roles
          WHERE user_id = $1
            AND role_id IN (SELECT id FROM roles WHERE code IN ('admin', 'member'))`,
        [target.id],
      );
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [target.id, role.id],
      );
      await client.query('UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [target.id]);
      await recordSecurityEvent({
        userId: target.id,
        eventType: 'user_role_changed',
        outcome: 'success',
        context,
        actorSessionId,
        metadata: { actorUserId, previousRole: target.role, role: nextRole },
      }, client);
    }

    if (statusChanged) {
      await client.query('UPDATE users SET status = $2 WHERE id = $1', [target.id, nextStatus]);
      await recordSecurityEvent({
        userId: target.id,
        eventType: 'user_status_changed',
        outcome: 'success',
        context,
        actorSessionId,
        metadata: { actorUserId, previousStatus: target.status, status: nextStatus },
      }, client);
    }

    if (roleChanged || statusChanged) {
      await client.query(
        `UPDATE refresh_tokens
            SET revoked_at = CURRENT_TIMESTAMP
          WHERE user_id = $1
            AND revoked_at IS NULL`,
        [target.id],
      );
    }

    return mapManagedUser(await selectManagedUser(client, target.id), actorUserId);
  });
}
