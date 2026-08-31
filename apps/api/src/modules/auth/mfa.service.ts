import type { PoolClient } from 'pg';
import QRCode from 'qrcode';
import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import { decryptSecret, encryptSecret } from '../../security/secret-encryption.js';
import {
  createRecoveryCodes,
  createTotpSecret,
  createTotpUri,
  hashMfaValue,
  normalizeRecoveryCode,
  verifyTotpCode,
} from '../../security/mfa.js';
import { verifyPassword } from '../../security/password.js';
import type { SessionContext } from './auth.service.js';
import { recordSecurityEvent } from './security-events.service.js';

interface MfaUserRow {
  id: string;
  email: string;
  password_hash: string;
  status: 'active' | 'disabled';
  mfa_secret_ciphertext: string | null;
  mfa_enabled_at: Date | null;
}

interface SetupChallengeRow {
  secret_ciphertext: string;
  expires_at: Date;
}

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

export interface MfaSetup {
  manualKey: string;
  qrCodeDataUrl: string;
  expiresAt: string;
}

export interface MfaActivation {
  enabledAt: string;
  recoveryCodes: string[];
  revokedSessions: number;
}

export interface MfaRecoveryCodeResult {
  recoveryCodes: string[];
  revokedSessions: number;
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

async function getActiveMfaUser(
  client: PoolClient,
  userId: string,
): Promise<MfaUserRow> {
  const result = await client.query<MfaUserRow>(
    `SELECT id, email, password_hash, status, mfa_secret_ciphertext, mfa_enabled_at
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
  return user;
}

async function assertCurrentPassword(user: MfaUserRow, currentPassword: string): Promise<void> {
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new AppError(400, 'CURRENT_PASSWORD_INCORRECT', '当前密码不正确');
  }
}

async function revokeOtherSessions(
  client: PoolClient,
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const result = await client.query(
    `UPDATE refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND id <> $2
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP`,
    [userId, currentSessionId],
  );
  return result.rowCount ?? 0;
}

async function replaceRecoveryCodes(
  client: PoolClient,
  userId: string,
): Promise<string[]> {
  const recoveryCodes = createRecoveryCodes();
  const hashes = recoveryCodes.map((code) => hashMfaValue(normalizeRecoveryCode(code)!));
  await client.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
  await client.query(
    `INSERT INTO mfa_recovery_codes (user_id, code_hash)
     SELECT $1, code_hash
       FROM unnest($2::text[]) AS code_hash`,
    [userId, hashes],
  );
  return recoveryCodes;
}

export async function verifyMfaFactor(
  client: PoolClient,
  userId: string,
  secretCiphertext: string,
  code: string,
  allowRecoveryCode: boolean,
): Promise<'totp' | 'recovery_code' | null> {
  const trimmedCode = code.trim();
  if (await verifyTotpCode(decryptSecret(secretCiphertext), trimmedCode)) {
    return 'totp';
  }
  if (!allowRecoveryCode) return null;

  const recoveryCode = normalizeRecoveryCode(trimmedCode);
  if (!recoveryCode) return null;
  const result = await client.query(
    `UPDATE mfa_recovery_codes
        SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND code_hash = $2
        AND used_at IS NULL`,
    [userId, hashMfaValue(recoveryCode)],
  );
  return result.rowCount === 1 ? 'recovery_code' : null;
}

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const result = await query<{
    status: 'active' | 'disabled';
    mfa_enabled_at: Date | null;
    recovery_codes_remaining: string;
  }>(
    `SELECT u.status, u.mfa_enabled_at,
            count(rc.id) FILTER (WHERE rc.used_at IS NULL)::text AS recovery_codes_remaining
       FROM users u
       LEFT JOIN mfa_recovery_codes rc ON rc.user_id = u.id
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
    enabled: user.mfa_enabled_at !== null,
    enabledAt: user.mfa_enabled_at?.toISOString() ?? null,
    recoveryCodesRemaining: Number(user.recovery_codes_remaining),
  };
}

export async function startMfaSetup(
  userId: string,
  currentPassword: string,
  context: SessionContext,
  actorSessionId: string,
): Promise<MfaSetup> {
  const setup = await withTransaction(async (client) => {
    const user = await getActiveMfaUser(client, userId);
    await assertCurrentPassword(user, currentPassword);
    if (user.mfa_enabled_at) {
      throw new AppError(409, 'MFA_ALREADY_ENABLED', '双重验证已经启用');
    }

    const secret = createTotpSecret();
    const expiresAt = addMinutes(new Date(), env.MFA_SETUP_CHALLENGE_TTL_MINUTES);
    await client.query(
      `INSERT INTO mfa_setup_challenges (user_id, secret_ciphertext, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET secret_ciphertext = EXCLUDED.secret_ciphertext,
             expires_at = EXCLUDED.expires_at,
             created_at = CURRENT_TIMESTAMP`,
      [userId, encryptSecret(secret), expiresAt],
    );
    await recordSecurityEvent({
      userId,
      eventType: 'mfa_setup_started',
      outcome: 'success',
      context,
      actorSessionId,
    }, client);
    return { secret, email: user.email, expiresAt };
  });

  const uri = createTotpUri(setup.secret, setup.email, env.MFA_ISSUER);
  return {
    manualKey: setup.secret,
    qrCodeDataUrl: await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
    }),
    expiresAt: setup.expiresAt.toISOString(),
  };
}

export async function enableMfa(
  userId: string,
  code: string,
  context: SessionContext,
  actorSessionId: string,
): Promise<MfaActivation> {
  return withTransaction(async (client) => {
    const user = await getActiveMfaUser(client, userId);
    if (user.mfa_enabled_at) {
      throw new AppError(409, 'MFA_ALREADY_ENABLED', '双重验证已经启用');
    }
    const setupResult = await client.query<SetupChallengeRow>(
      `SELECT secret_ciphertext, expires_at
         FROM mfa_setup_challenges
        WHERE user_id = $1
        FOR UPDATE`,
      [userId],
    );
    const setup = setupResult.rows[0];
    if (!setup || setup.expires_at <= new Date()) {
      if (setup) await client.query('DELETE FROM mfa_setup_challenges WHERE user_id = $1', [userId]);
      throw new AppError(410, 'MFA_SETUP_EXPIRED', '设置已过期，请重新开始');
    }
    if (!(await verifyTotpCode(decryptSecret(setup.secret_ciphertext), code.trim()))) {
      throw new AppError(400, 'MFA_CODE_INVALID', '验证码不正确，请检查设备时间后重试');
    }

    const enabledResult = await client.query<{ mfa_enabled_at: Date }>(
      `UPDATE users
          SET mfa_secret_ciphertext = $2,
              mfa_enabled_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING mfa_enabled_at`,
      [userId, setup.secret_ciphertext],
    );
    await client.query('DELETE FROM mfa_setup_challenges WHERE user_id = $1', [userId]);
    const recoveryCodes = await replaceRecoveryCodes(client, userId);
    const revokedSessions = await revokeOtherSessions(client, userId, actorSessionId);
    await recordSecurityEvent({
      userId,
      eventType: 'mfa_enabled',
      outcome: 'success',
      context,
      actorSessionId,
      metadata: { recoveryCodeCount: recoveryCodes.length, revokedSessions },
    }, client);
    return {
      enabledAt: enabledResult.rows[0]!.mfa_enabled_at.toISOString(),
      recoveryCodes,
      revokedSessions,
    };
  });
}

export async function disableMfa(
  userId: string,
  currentPassword: string,
  code: string,
  context: SessionContext,
  actorSessionId: string,
): Promise<{ disabled: true; revokedSessions: number }> {
  return withTransaction(async (client) => {
    const user = await getActiveMfaUser(client, userId);
    await assertCurrentPassword(user, currentPassword);
    if (!user.mfa_secret_ciphertext || !user.mfa_enabled_at) {
      throw new AppError(409, 'MFA_NOT_ENABLED', '双重验证尚未启用');
    }
    const method = await verifyMfaFactor(
      client,
      userId,
      user.mfa_secret_ciphertext,
      code,
      true,
    );
    if (!method) {
      throw new AppError(400, 'MFA_CODE_INVALID', '验证码或恢复码不正确');
    }

    await client.query(
      `UPDATE users
          SET mfa_secret_ciphertext = NULL,
              mfa_enabled_at = NULL
        WHERE id = $1`,
      [userId],
    );
    await client.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM mfa_setup_challenges WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM mfa_login_challenges WHERE user_id = $1', [userId]);
    const revokedSessions = await revokeOtherSessions(client, userId, actorSessionId);
    await recordSecurityEvent({
      userId,
      eventType: 'mfa_disabled',
      outcome: 'success',
      context,
      actorSessionId,
      metadata: { verificationMethod: method, revokedSessions },
    }, client);
    return { disabled: true, revokedSessions };
  });
}

export async function regenerateMfaRecoveryCodes(
  userId: string,
  currentPassword: string,
  code: string,
  context: SessionContext,
  actorSessionId: string,
): Promise<MfaRecoveryCodeResult> {
  return withTransaction(async (client) => {
    const user = await getActiveMfaUser(client, userId);
    await assertCurrentPassword(user, currentPassword);
    if (!user.mfa_secret_ciphertext || !user.mfa_enabled_at) {
      throw new AppError(409, 'MFA_NOT_ENABLED', '双重验证尚未启用');
    }
    if (!(await verifyTotpCode(decryptSecret(user.mfa_secret_ciphertext), code.trim()))) {
      throw new AppError(400, 'MFA_CODE_INVALID', '验证码不正确，请检查设备时间后重试');
    }

    const recoveryCodes = await replaceRecoveryCodes(client, userId);
    const revokedSessions = await revokeOtherSessions(client, userId, actorSessionId);
    await recordSecurityEvent({
      userId,
      eventType: 'mfa_recovery_codes_regenerated',
      outcome: 'success',
      context,
      actorSessionId,
      metadata: { recoveryCodeCount: recoveryCodes.length, revokedSessions },
    }, client);
    return { recoveryCodes, revokedSessions };
  });
}
