import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type { EmailVerificationRequestInput } from './auth.schemas.js';
import type { SessionContext } from './auth.service.js';
import { recordSecurityEvent } from './security-events.service.js';

interface EmailVerificationUser {
  id: string;
  email: string;
  display_name: string;
  status: 'active' | 'disabled';
  email_verified_at: Date | null;
}

interface EmailVerificationCandidate {
  id: string;
  user_id: string;
}

export interface EmailVerificationDelivery {
  id: string;
  email: string;
  displayName: string;
  token: string;
  expiresAt: Date;
}

function createVerificationToken(): string {
  return randomBytes(48).toString('base64url');
}

function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createDelivery(
  client: PoolClient,
  user: Pick<EmailVerificationUser, 'id' | 'email' | 'display_name'>,
  context: SessionContext,
): Promise<EmailVerificationDelivery> {
  const token = createVerificationToken();
  const expiresAt = new Date(
    Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60_000,
  );
  await client.query(
    `UPDATE email_verification_tokens
        SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND used_at IS NULL`,
    [user.id],
  );
  const result = await client.query<{ id: string }>(
    `INSERT INTO email_verification_tokens (
       user_id, token_hash, expires_at, requested_ip
     ) VALUES ($1, $2, $3, $4::inet)
     RETURNING id`,
    [user.id, hashVerificationToken(token), expiresAt, context.ipAddress],
  );
  await recordSecurityEvent({
    userId: user.id,
    eventType: 'email_verification_requested',
    outcome: 'success',
    context,
    metadata: { expiresAt: expiresAt.toISOString() },
  }, client);
  return {
    id: result.rows[0]!.id,
    email: user.email,
    displayName: user.display_name,
    token,
    expiresAt,
  };
}

export function createRegistrationEmailVerification(
  client: PoolClient,
  user: Pick<EmailVerificationUser, 'id' | 'email' | 'display_name'>,
  context: SessionContext,
): Promise<EmailVerificationDelivery> {
  return createDelivery(client, user, context);
}

export async function requestEmailVerification(
  input: EmailVerificationRequestInput,
  context: SessionContext,
): Promise<EmailVerificationDelivery | null> {
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM email_verification_tokens
        WHERE expires_at <= CURRENT_TIMESTAMP - INTERVAL '7 days'`,
    );
    const result = await client.query<EmailVerificationUser>(
      `SELECT id, email, display_name, status, email_verified_at
         FROM users
        WHERE email = $1
        FOR UPDATE`,
      [input.email],
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active' || user.email_verified_at) return null;
    return createDelivery(client, user, context);
  });
}

export async function invalidateEmailVerification(id: string): Promise<void> {
  await query(
    `UPDATE email_verification_tokens
        SET used_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND used_at IS NULL`,
    [id],
  );
}

export async function confirmEmailVerification(
  token: string,
  context: SessionContext,
): Promise<void> {
  const tokenHash = hashVerificationToken(token);
  await withTransaction(async (client) => {
    const candidateResult = await client.query<EmailVerificationCandidate>(
      `SELECT id, user_id
         FROM email_verification_tokens
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP`,
      [tokenHash],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) {
      throw new AppError(
        400,
        'INVALID_EMAIL_VERIFICATION_TOKEN',
        '邮箱验证链接无效或已过期',
      );
    }

    const userResult = await client.query<EmailVerificationUser>(
      `SELECT id, email, display_name, status, email_verified_at
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [candidate.user_id],
    );
    const tokenResult = await client.query<{ id: string }>(
      `SELECT id
         FROM email_verification_tokens
        WHERE id = $1
          AND user_id = $2
          AND token_hash = $3
          AND used_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        FOR UPDATE`,
      [candidate.id, candidate.user_id, tokenHash],
    );
    const user = userResult.rows[0];
    if (
      !user
      || user.status !== 'active'
      || user.email_verified_at
      || !tokenResult.rows[0]
    ) {
      throw new AppError(
        400,
        'INVALID_EMAIL_VERIFICATION_TOKEN',
        '邮箱验证链接无效或已过期',
      );
    }

    await client.query(
      'UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id],
    );
    await client.query(
      `UPDATE email_verification_tokens
          SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
          AND used_at IS NULL`,
      [user.id],
    );
    await recordSecurityEvent({
      userId: user.id,
      eventType: 'email_verified',
      outcome: 'success',
      context,
    }, client);
  });
}
