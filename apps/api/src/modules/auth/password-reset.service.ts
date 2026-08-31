import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
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
import type {
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
} from './auth.schemas.js';
import type { SessionContext } from './auth.service.js';
import { recordSecurityEvent } from './security-events.service.js';

interface PasswordResetUserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: 'active' | 'disabled';
}

interface PasswordResetCandidateRow {
  id: string;
  user_id: string;
}

export interface PasswordResetDelivery {
  id: string;
  email: string;
  displayName: string;
  token: string;
  expiresAt: Date;
}

function createResetToken(): string {
  return randomBytes(48).toString('base64url');
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function passwordPolicyViolations(password: string, user: PasswordResetUserRow): string[] {
  const assessment = assessPassword(password, {
    email: user.email,
    displayName: user.display_name,
  });
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
  return violations;
}

async function assertPasswordNotRecentlyUsed(
  client: PoolClient,
  user: PasswordResetUserRow,
  newPassword: string,
): Promise<void> {
  if (await verifyPassword(newPassword, user.password_hash)) {
    throw new AppError(
      400,
      'PASSWORD_RECENTLY_USED',
      `新密码不能与最近 ${env.PASSWORD_HISTORY_LIMIT} 个密码重复`,
    );
  }

  const history = await client.query<{ password_hash: string }>(
    `SELECT password_hash
       FROM user_password_history
      WHERE user_id = $1
        AND password_hash <> $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [user.id, user.password_hash, env.PASSWORD_HISTORY_LIMIT - 1],
  );
  for (const historicalPassword of history.rows) {
    if (await verifyPassword(newPassword, historicalPassword.password_hash)) {
      throw new AppError(
        400,
        'PASSWORD_RECENTLY_USED',
        `新密码不能与最近 ${env.PASSWORD_HISTORY_LIMIT} 个密码重复`,
      );
    }
  }
}

export async function requestPasswordReset(
  input: PasswordResetRequestInput,
  context: SessionContext,
): Promise<PasswordResetDelivery | null> {
  const token = createResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(
    Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000,
  );

  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM password_reset_tokens
        WHERE expires_at <= CURRENT_TIMESTAMP - INTERVAL '7 days'`,
    );
    const userResult = await client.query<PasswordResetUserRow>(
      `SELECT id, email, password_hash, display_name, status
         FROM users
        WHERE email = $1
        FOR UPDATE`,
      [input.email],
    );
    const user = userResult.rows[0];
    if (!user || user.status !== 'active') return null;

    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND used_at IS NULL`,
      [user.id],
    );
    const resetResult = await client.query<{ id: string }>(
      `INSERT INTO password_reset_tokens (
         user_id, token_hash, expires_at, requested_ip
       ) VALUES ($1, $2, $3, $4::inet)
       RETURNING id`,
      [user.id, tokenHash, expiresAt, context.ipAddress],
    );
    const resetId = resetResult.rows[0]!.id;
    await recordSecurityEvent({
      userId: user.id,
      eventType: 'password_reset_requested',
      outcome: 'success',
      context,
      metadata: { expiresAt: expiresAt.toISOString() },
    }, client);

    return {
      id: resetId,
      email: user.email,
      displayName: user.display_name,
      token,
      expiresAt,
    };
  });
}

export async function invalidatePasswordReset(id: string): Promise<void> {
  await query(
    `UPDATE password_reset_tokens
        SET used_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND used_at IS NULL`,
    [id],
  );
}

export async function confirmPasswordReset(
  input: PasswordResetConfirmInput,
  context: SessionContext,
): Promise<void> {
  const tokenHash = hashResetToken(input.token);

  await withTransaction(async (client) => {
    const candidateResult = await client.query<PasswordResetCandidateRow>(
      `SELECT id, user_id
        FROM password_reset_tokens
       WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
      `,
      [tokenHash],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) {
      throw new AppError(
        400,
        'INVALID_PASSWORD_RESET_TOKEN',
        '密码重置链接无效或已过期',
      );
    }

    const userResult = await client.query<PasswordResetUserRow>(
      `SELECT id, email, password_hash, display_name, status
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [candidate.user_id],
    );
    const resetTokenResult = await client.query<{ id: string }>(
      `SELECT id
         FROM password_reset_tokens
        WHERE id = $1
          AND user_id = $2
          AND token_hash = $3
          AND used_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        FOR UPDATE`,
      [candidate.id, candidate.user_id, tokenHash],
    );
    const user = userResult.rows[0];
    const resetToken = resetTokenResult.rows[0];
    const reset = user && resetToken ? user : null;
    if (!reset || reset.status !== 'active') {
      throw new AppError(
        400,
        'INVALID_PASSWORD_RESET_TOKEN',
        '密码重置链接无效或已过期',
      );
    }

    const violations = passwordPolicyViolations(input.newPassword, reset);
    if (violations.length > 0) {
      throw new AppError(
        400,
        'PASSWORD_POLICY_VIOLATION',
        '新密码安全等级未达到要求',
        { violations },
      );
    }
    await assertPasswordNotRecentlyUsed(client, reset, input.newPassword);

    const passwordHash = await hashPassword(input.newPassword);
    await client.query(
      `UPDATE users
          SET password_hash = $1,
              failed_login_attempts = 0,
              last_failed_login_at = NULL,
              locked_until = NULL
        WHERE id = $2`,
      [passwordHash, reset.id],
    );
    await client.query(
      `INSERT INTO user_password_history (user_id, password_hash)
       VALUES ($1, $2)`,
      [reset.id, passwordHash],
    );
    await client.query(
      `DELETE FROM user_password_history
        WHERE user_id = $1
          AND id NOT IN (
            SELECT id
              FROM user_password_history
             WHERE user_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2
          )`,
      [reset.id, env.PASSWORD_HISTORY_LIMIT],
    );
    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND used_at IS NULL`,
      [reset.id],
    );
    const revokedSessions = await client.query(
      `UPDATE refresh_tokens
          SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND revoked_at IS NULL`,
      [reset.id],
    );
    await recordSecurityEvent({
      userId: reset.id,
      eventType: 'password_reset_completed',
      outcome: 'success',
      context,
      metadata: {
        revokedSessions: revokedSessions.rowCount ?? 0,
        passwordHistoryLimit: env.PASSWORD_HISTORY_LIMIT,
      },
    }, client);
  });
}
