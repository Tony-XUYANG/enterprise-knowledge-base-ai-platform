import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { isPostgreSqlError } from '../../db/pg-error.js';
import { pool, query, withTransaction } from '../../db/pool.js';
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

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: 'active' | 'disabled';
}

interface RefreshSessionRow extends UserRow {
  refresh_token_id: string;
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

export interface SessionSummary {
  activeSessions: number;
  lastLoginAt: string | null;
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
): Promise<AuthResult> {
  const refreshToken = createRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);

  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, refreshTokenHash, refreshTokenExpiresAt()],
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      roles,
    },
    accessToken: await createAccessToken({ userId: user.id, roles }),
    refreshToken,
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
  };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
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

    return issueSession(client, user, ['member']);
  });
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const userResult = await query<UserRow>(
    `SELECT id, email, password_hash, display_name, status
       FROM users
      WHERE email = $1`,
    [input.email],
  );
  const user = userResult.rows[0];

  if (!user || !(await verifyPassword(input.password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
  }

  if (user.status !== 'active') {
    throw new AppError(403, 'USER_DISABLED', '账号已被停用');
  }

  return withTransaction(async (client) => {
    await client.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    const roles = await getRoles(client, user.id);
    return issueSession(client, user, roles);
  });
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

    await client.query(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1',
      [session.refresh_token_id],
    );

    const roles = await getRoles(client, session.id);
    return issueSession(client, session, roles);
  });
}

export async function logout(refreshToken: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
      WHERE token_hash = $1
        AND revoked_at IS NULL`,
    [hashRefreshToken(refreshToken)],
  );
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
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
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      passwordHash,
      userId,
    ]);
    await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND revoked_at IS NULL`,
      [userId],
    );
  });
}

export async function updateCurrentUser(
  userId: string,
  input: UpdateProfileInput,
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

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.display_name,
      roles: await getRoles(client, userId),
    };
  });
}

export async function getSessionSummary(userId: string): Promise<SessionSummary> {
  const result = await query<{
    status: 'active' | 'disabled';
    last_login_at: Date | null;
    active_sessions: number;
  }>(
    `SELECT u.status,
            u.last_login_at,
            count(rt.id)::integer AS active_sessions
       FROM users u
       LEFT JOIN refresh_tokens rt
         ON rt.user_id = u.id
        AND rt.revoked_at IS NULL
        AND rt.expires_at > CURRENT_TIMESTAMP
      WHERE u.id = $1
      GROUP BY u.id`,
    [userId],
  );
  const summary = result.rows[0];

  if (!summary) {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌对应的用户不存在');
  }
  if (summary.status !== 'active') {
    throw new AppError(403, 'USER_DISABLED', '账号已被停用');
  }

  return {
    activeSessions: summary.active_sessions,
    lastLoginAt: summary.last_login_at?.toISOString() ?? null,
  };
}

export async function revokeAllSessions(userId: string): Promise<number> {
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
