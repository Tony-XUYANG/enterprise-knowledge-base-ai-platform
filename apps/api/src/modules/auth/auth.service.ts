import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { isPostgreSqlError } from '../../db/pg-error.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { hashPassword, verifyPassword } from '../../security/password.js';
import {
  assessPassword,
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MIN_CHARACTERS,
  PASSWORD_REQUIRED_CATEGORIES,
} from '../../security/password-policy.js';
import {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from '../../security/tokens.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from './auth.schemas.js';
import { recordSecurityEvent } from './security-events.service.js';
import { describeClientDevice } from './session-device.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: 'active' | 'disabled';
}

interface LoginUserRow extends UserRow {
  failed_login_attempts: number;
  last_failed_login_at: Date | null;
  locked_until: Date | null;
}

interface RefreshSessionRow extends UserRow {
  refresh_token_id: string;
}

interface ActiveSessionRow {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  last_used_at: Date;
  expires_at: Date;
  created_at: Date;
}

export interface SessionContext {
  userAgent: string | null;
  ipAddress: string | null;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

interface IssuedSession {
  result: AuthResult;
  sessionId: string;
}

export interface SessionSummary {
  activeSessions: number;
  lastLoginAt: string | null;
  loginProtection: LoginProtection;
  items: AuthSession[];
}

export interface LoginProtection {
  status: 'protected' | 'locked';
  failedAttempts: number;
  failureLimit: number;
  failureWindowMinutes: number;
  lockoutMinutes: number;
  lockedUntil: string | null;
}

export interface AuthSession {
  id: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  expiresAt: string;
  createdAt: string;
  current: boolean;
}

type LoginAttemptResult =
  | { kind: 'success'; result: AuthResult }
  | { kind: 'invalid' }
  | { kind: 'disabled' }
  | { kind: 'locked'; lockedUntil: Date; retryAfterSeconds: number };

const dummyPasswordHash = '$2b$12$nN55PR.IzlfSe7z6Pki2uup7PkPymPOUq8AQbKSy6jGiQyNl0RZQG';

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function lockoutError(lockedUntil: Date, retryAfterSeconds: number): AppError {
  return new AppError(
    423,
    'ACCOUNT_TEMPORARILY_LOCKED',
    `登录失败次数过多，账号已临时锁定 ${env.LOGIN_LOCKOUT_MINUTES} 分钟`,
    {
      lockedUntil: lockedUntil.toISOString(),
      retryAfterSeconds,
    },
  );
}

async function getRoles(client: PoolClient, userId: string): Promise<string[]> {
  const result = await client.query<{ code: string }>(
    `SELECT r.code
       FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = $1
      ORDER BY r.code`,
    [userId],
  );
  return result.rows.map((row) => row.code);
}

async function issueSession(
  client: PoolClient,
  user: Pick<UserRow, 'id' | 'email' | 'display_name'>,
  roles: string[],
  context: SessionContext,
): Promise<IssuedSession> {
  const refreshToken = createRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);

  const sessionResult = await client.query<{ id: string }>(
    `INSERT INTO refresh_tokens (
       user_id, token_hash, expires_at, user_agent, ip_address, last_used_at
     ) VALUES ($1, $2, $3, $4, $5::inet, CURRENT_TIMESTAMP)
     RETURNING id`,
    [
      user.id,
      refreshTokenHash,
      refreshTokenExpiresAt(),
      context.userAgent,
      context.ipAddress,
    ],
  );
  const sessionId = sessionResult.rows[0]!.id;

  return {
    sessionId,
    result: {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        roles,
      },
      accessToken: await createAccessToken({ userId: user.id, roles, sessionId }),
      refreshToken,
      accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
    },
  };
}

export async function register(
  input: RegisterInput,
  context: SessionContext,
): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    let user: UserRow;

    try {
      const userResult = await client.query<UserRow>(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, password_hash, display_name, status`,
        [input.email, passwordHash, input.displayName],
      );
      user = userResult.rows[0]!;
    } catch (error) {
      if (isPostgreSqlError(error) && error.code === '23505') {
        throw new AppError(409, 'EMAIL_ALREADY_EXISTS', '该邮箱已注册');
      }
      throw error;
    }

    const roleResult = await client.query<{ id: number }>(
      "SELECT id FROM roles WHERE code = 'member'",
    );
    const memberRole = roleResult.rows[0];
    if (!memberRole) {
      throw new AppError(500, 'MEMBER_ROLE_MISSING', '数据库缺少 member 角色');
    }

    await client.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [user.id, memberRole.id],
    );

    const issuedSession = await issueSession(client, user, ['member'], context);
    await recordSecurityEvent({
      userId: user.id,
      eventType: 'account_registered',
      outcome: 'success',
      context,
      actorSessionId: issuedSession.sessionId,
    }, client);
    return issuedSession.result;
  });
}

export async function login(
  input: LoginInput,
  context: SessionContext,
): Promise<AuthResult> {
  const attempt = await withTransaction<LoginAttemptResult>(async (client) => {
    const userResult = await client.query<LoginUserRow>(
      `SELECT id, email, password_hash, display_name, status,
              failed_login_attempts, last_failed_login_at, locked_until
         FROM users
        WHERE email = $1
        FOR UPDATE`,
      [input.email],
    );
    const user = userResult.rows[0];

    if (!user) {
      await verifyPassword(input.password, dummyPasswordHash);
      return { kind: 'invalid' };
    }

    const now = new Date();
    if (user.locked_until && user.locked_until > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((user.locked_until.getTime() - now.getTime()) / 1000),
      );
      await recordSecurityEvent({
        userId: user.id,
        eventType: 'login_failed',
        outcome: 'failure',
        context,
        metadata: {
          reason: 'account_locked',
          lockedUntil: user.locked_until.toISOString(),
          retryAfterSeconds,
        },
      }, client);
      return {
        kind: 'locked',
        lockedUntil: user.locked_until,
        retryAfterSeconds,
      };
    }

    const lockExpired = user.locked_until !== null;
    if (lockExpired) {
      await client.query(
        `UPDATE users
            SET failed_login_attempts = 0,
                last_failed_login_at = NULL,
                locked_until = NULL
          WHERE id = $1`,
        [user.id],
      );
      await recordSecurityEvent({
        userId: user.id,
        eventType: 'account_unlocked',
        outcome: 'success',
        context,
        metadata: { reason: 'lockout_expired' },
      }, client);
    }

    if (!(await verifyPassword(input.password, user.password_hash))) {
      const failureWindowStartedAt = addMinutes(now, -env.LOGIN_FAILURE_WINDOW_MINUTES);
      const withinFailureWindow = !lockExpired
        && user.last_failed_login_at !== null
        && user.last_failed_login_at >= failureWindowStartedAt;
      const failedAttempts = withinFailureWindow ? user.failed_login_attempts + 1 : 1;
      const lockedUntil = failedAttempts >= env.LOGIN_FAILURE_LIMIT
        ? addMinutes(now, env.LOGIN_LOCKOUT_MINUTES)
        : null;

      await client.query(
        `UPDATE users
            SET failed_login_attempts = $2,
                last_failed_login_at = $3,
                locked_until = $4
          WHERE id = $1`,
        [user.id, failedAttempts, now, lockedUntil],
      );
      await recordSecurityEvent({
        userId: user.id,
        eventType: lockedUntil ? 'account_locked' : 'login_failed',
        outcome: 'failure',
        context,
        metadata: {
          reason: lockedUntil ? 'too_many_attempts' : 'invalid_credentials',
          failedAttempts,
          remainingAttempts: Math.max(0, env.LOGIN_FAILURE_LIMIT - failedAttempts),
          lockedUntil: lockedUntil?.toISOString() ?? null,
        },
      }, client);

      if (lockedUntil) {
        return {
          kind: 'locked',
          lockedUntil,
          retryAfterSeconds: env.LOGIN_LOCKOUT_MINUTES * 60,
        };
      }
      return { kind: 'invalid' };
    }

    if (user.status !== 'active') {
      await recordSecurityEvent({
        userId: user.id,
        eventType: 'login_failed',
        outcome: 'failure',
        context,
        metadata: { reason: 'account_disabled' },
      }, client);
      return { kind: 'disabled' };
    }

    await client.query(
      `UPDATE users
          SET last_login_at = CURRENT_TIMESTAMP,
              failed_login_attempts = 0,
              last_failed_login_at = NULL,
              locked_until = NULL
        WHERE id = $1`,
      [user.id],
    );
    const roles = await getRoles(client, user.id);
    const issuedSession = await issueSession(client, user, roles, context);
    await recordSecurityEvent({
      userId: user.id,
      eventType: 'login_succeeded',
      outcome: 'success',
      context,
      actorSessionId: issuedSession.sessionId,
      metadata: {
        failedAttemptsCleared: lockExpired ? 0 : user.failed_login_attempts,
      },
    }, client);
    return { kind: 'success', result: issuedSession.result };
  });

  switch (attempt.kind) {
    case 'success':
      return attempt.result;
    case 'disabled':
      throw new AppError(403, 'USER_DISABLED', '账号已被停用');
    case 'locked':
      throw lockoutError(attempt.lockedUntil, attempt.retryAfterSeconds);
    case 'invalid':
      throw new AppError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
  }
}

export async function refreshSession(refreshToken: string): Promise<AuthResult> {
  const tokenHash = hashRefreshToken(refreshToken);

  return withTransaction(async (client) => {
    const result = await client.query<RefreshSessionRow>(
      `SELECT rt.id AS refresh_token_id,
              u.id, u.email, u.password_hash, u.display_name, u.status
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
          AND rt.revoked_at IS NULL
          AND rt.expires_at > CURRENT_TIMESTAMP
        FOR UPDATE OF rt`,
      [tokenHash],
    );
    const session = result.rows[0];

    if (!session) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '刷新令牌无效或已过期');
    }
    if (session.status !== 'active') {
      throw new AppError(403, 'USER_DISABLED', '账号已被停用');
    }

    const roles = await getRoles(client, session.id);
    const rotatedRefreshToken = createRefreshToken();
    await client.query(
      `UPDATE refresh_tokens
          SET token_hash = $1,
              expires_at = $2,
              last_used_at = CURRENT_TIMESTAMP
        WHERE id = $3`,
      [
        hashRefreshToken(rotatedRefreshToken),
        refreshTokenExpiresAt(),
        session.refresh_token_id,
      ],
    );

    return {
      user: {
        id: session.id,
        email: session.email,
        displayName: session.display_name,
        roles,
      },
      accessToken: await createAccessToken({
        userId: session.id,
        roles,
        sessionId: session.refresh_token_id,
      }),
      refreshToken: rotatedRefreshToken,
      accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
    };
  });
}

export async function logout(
  refreshToken: string,
  context: SessionContext,
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ id: string; user_id: string }>(
      `UPDATE refresh_tokens
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE token_hash = $1
          AND revoked_at IS NULL
        RETURNING id, user_id`,
      [hashRefreshToken(refreshToken)],
    );
    const session = result.rows[0];
    if (!session) return;

    await recordSecurityEvent({
      userId: session.user_id,
      eventType: 'logout',
      outcome: 'success',
      context,
      actorSessionId: session.id,
      targetSessionId: session.id,
    }, client);
  });
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  context: SessionContext,
  actorSessionId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<UserRow>(
      `SELECT id, email, password_hash, display_name, status
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId],
    );
    const user = result.rows[0];

    if (!user) {
      throw new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌对应的用户不存在');
    }
    if (user.status !== 'active') {
      throw new AppError(403, 'USER_DISABLED', '账号已被停用');
    }
    if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
      throw new AppError(400, 'CURRENT_PASSWORD_INCORRECT', '当前密码不正确');
    }
    if (await verifyPassword(input.newPassword, user.password_hash)) {
      throw new AppError(400, 'PASSWORD_UNCHANGED', '新密码不能与当前密码相同');
    }

    const assessment = assessPassword(input.newPassword, {
      email: user.email,
      displayName: user.display_name,
    });
    if (!assessment.acceptable) {
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
        '新密码安全等级未达到要求',
        { violations },
      );
    }

    const passwordHash = await hashPassword(input.newPassword);
    await client.query(
      `UPDATE users
          SET password_hash = $1,
              failed_login_attempts = 0,
              last_failed_login_at = NULL,
              locked_until = NULL
        WHERE id = $2`,
      [passwordHash, userId],
    );
    const revokedSessions = await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND revoked_at IS NULL`,
      [userId],
    );
    await recordSecurityEvent({
      userId,
      eventType: 'password_changed',
      outcome: 'success',
      context,
      actorSessionId,
      metadata: { revokedSessions: revokedSessions.rowCount ?? 0 },
    }, client);
  });
}

export async function updateCurrentUser(
  userId: string,
  input: UpdateProfileInput,
  context: SessionContext,
  actorSessionId?: string,
): Promise<PublicUser> {
  return withTransaction(async (client) => {
    const result = await client.query<UserRow>(
      `SELECT id, email, password_hash, display_name, status
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId],
    );
    const user = result.rows[0];

    if (!user) {
      throw new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌对应的用户不存在');
    }
    if (user.status !== 'active') {
      throw new AppError(403, 'USER_DISABLED', '账号已被停用');
    }

    const updatedResult = await client.query<Pick<UserRow, 'id' | 'email' | 'display_name'>>(
      `UPDATE users
          SET display_name = $2
        WHERE id = $1
        RETURNING id, email, display_name`,
      [userId, input.displayName],
    );
    const updatedUser = updatedResult.rows[0]!;
    await recordSecurityEvent({
      userId,
      eventType: 'profile_updated',
      outcome: 'success',
      context,
      actorSessionId,
      metadata: { displayNameChanged: user.display_name !== updatedUser.display_name },
    }, client);

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.display_name,
      roles: await getRoles(client, userId),
    };
  });
}

export async function getSessionSummary(
  userId: string,
  currentSessionId?: string,
): Promise<SessionSummary> {
  const userResult = await query<{
    status: 'active' | 'disabled';
    last_login_at: Date | null;
    failed_login_attempts: number;
    last_failed_login_at: Date | null;
    locked_until: Date | null;
  }>(
    `SELECT status, last_login_at, failed_login_attempts,
            last_failed_login_at, locked_until
       FROM users
      WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];

  if (!user) {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌对应的用户不存在');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'USER_DISABLED', '账号已被停用');
  }

  const sessionsResult = await query<ActiveSessionRow>(
    `SELECT id, user_agent, host(ip_address) AS ip_address,
            last_used_at, expires_at, created_at
       FROM refresh_tokens
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY last_used_at DESC, created_at DESC, id DESC`,
    [userId],
  );
  const items = sessionsResult.rows.map((session) => ({
    id: session.id,
    ...describeClientDevice(session.user_agent),
    userAgent: session.user_agent,
    ipAddress: session.ip_address,
    lastUsedAt: session.last_used_at.toISOString(),
    expiresAt: session.expires_at.toISOString(),
    createdAt: session.created_at.toISOString(),
    current: session.id === currentSessionId,
  })).sort((left, right) => Number(right.current) - Number(left.current));
  const now = new Date();
  const lockActive = user.locked_until !== null && user.locked_until > now;
  const failureWindowStartedAt = addMinutes(now, -env.LOGIN_FAILURE_WINDOW_MINUTES);
  const failureWindowActive = user.last_failed_login_at !== null
    && user.last_failed_login_at >= failureWindowStartedAt;

  return {
    activeSessions: items.length,
    lastLoginAt: user.last_login_at?.toISOString() ?? null,
    loginProtection: {
      status: lockActive ? 'locked' : 'protected',
      failedAttempts: lockActive || failureWindowActive ? user.failed_login_attempts : 0,
      failureLimit: env.LOGIN_FAILURE_LIMIT,
      failureWindowMinutes: env.LOGIN_FAILURE_WINDOW_MINUTES,
      lockoutMinutes: env.LOGIN_LOCKOUT_MINUTES,
      lockedUntil: lockActive ? user.locked_until?.toISOString() ?? null : null,
    },
    items,
  };
}

export async function revokeSession(
  userId: string,
  sessionId: string,
  context: SessionContext,
  currentSessionId?: string,
): Promise<{ revokedSession: boolean; currentSession: boolean }> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND user_id = $2
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP`,
      [sessionId, userId],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'SESSION_NOT_FOUND', '登录会话不存在或已失效');
    }
    const currentSession = sessionId === currentSessionId;
    await recordSecurityEvent({
      userId,
      eventType: 'session_revoked',
      outcome: 'success',
      context,
      actorSessionId: currentSessionId,
      targetSessionId: sessionId,
      metadata: { currentSession },
    }, client);
    return { revokedSession: true, currentSession };
  });
}

export async function revokeAllSessions(
  userId: string,
  context: SessionContext,
  actorSessionId?: string,
): Promise<number> {
  return withTransaction(async (client) => {
    const userResult = await client.query<Pick<UserRow, 'status'>>(
      'SELECT status FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const user = userResult.rows[0];

    if (!user) {
      throw new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌对应的用户不存在');
    }
    if (user.status !== 'active') {
      throw new AppError(403, 'USER_DISABLED', '账号已被停用');
    }

    const result = await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP`,
      [userId],
    );
    await recordSecurityEvent({
      userId,
      eventType: 'all_sessions_revoked',
      outcome: 'success',
      context,
      actorSessionId,
      metadata: { revokedSessions: result.rowCount ?? 0 },
    }, client);
    return result.rowCount ?? 0;
  });
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const result = await query<{
    id: string;
    email: string;
    display_name: string;
    status: 'active' | 'disabled';
    roles: string[];
  }>(
    `SELECT u.id, u.email, u.display_name, u.status,
            coalesce(
              array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL),
              ARRAY[]::varchar[]
            ) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = $1
      GROUP BY u.id`,
    [userId],
  );
  const user = result.rows[0];

  if (!user) {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌对应的用户不存在');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'USER_DISABLED', '账号已被停用');
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    roles: user.roles,
  };
}
