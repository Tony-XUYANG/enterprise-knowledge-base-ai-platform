import { randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const { sendEmailVerificationMessageMock } = vi.hoisted(() => ({
  sendEmailVerificationMessageMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/modules/auth/email-verification-mailer.js', () => ({
  sendEmailVerificationMessage: sendEmailVerificationMessageMock,
}));

const email = `mfa-${randomUUID()}@example.com`;
const password = 'MfaTesting9!Secure';
const app = createApp();

describe('MFA authentication and account management', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    await pool.end();
  });

  it('protects login with TOTP and one-time recovery codes', async () => {
    const registration = await request(app).post('/api/v1/auth/register').send({
      email,
      password,
      displayName: 'MFA 测试用户',
    });
    expect(registration.status).toBe(201);
    await pool.query(
      'UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE email = $1',
      [email],
    );
    const primaryLogin = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(primaryLogin.status).toBe(200);
    const primaryAccessToken: string = primaryLogin.body.data.accessToken;

    const secondaryLogin = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(secondaryLogin.status).toBe(200);
    const secondaryAccessToken: string = secondaryLogin.body.data.accessToken;

    const initialStatus = await request(app)
      .get('/api/v1/auth/mfa')
      .set('Authorization', `Bearer ${primaryAccessToken}`);
    expect(initialStatus.status).toBe(200);
    expect(initialStatus.body.data).toEqual({
      enabled: false,
      enabledAt: null,
      recoveryCodesRemaining: 0,
    });

    const wrongPasswordSetup = await request(app)
      .post('/api/v1/auth/mfa/setup')
      .set('Authorization', `Bearer ${primaryAccessToken}`)
      .send({ currentPassword: 'incorrect-password' });
    expect(wrongPasswordSetup.status).toBe(400);
    expect(wrongPasswordSetup.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');

    const setup = await request(app)
      .post('/api/v1/auth/mfa/setup')
      .set('Authorization', `Bearer ${primaryAccessToken}`)
      .send({ currentPassword: password });
    expect(setup.status).toBe(200);
    expect(setup.body.data.manualKey).toMatch(/^[A-Z2-7]+$/u);
    expect(setup.body.data.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/u);
    const secret: string = setup.body.data.manualKey;

    const storedSetup = await pool.query<{ secret_ciphertext: string }>(
      `SELECT s.secret_ciphertext
         FROM mfa_setup_challenges s
         JOIN users u ON u.id = s.user_id
        WHERE u.email = $1`,
      [email],
    );
    expect(storedSetup.rows[0]!.secret_ciphertext).not.toContain(secret);

    const validCode = await generate({ secret });
    const invalidCode = validCode === '000000' ? '111111' : '000000';
    const invalidEnable = await request(app)
      .post('/api/v1/auth/mfa/enable')
      .set('Authorization', `Bearer ${primaryAccessToken}`)
      .send({ code: invalidCode });
    expect(invalidEnable.status).toBe(400);
    expect(invalidEnable.body.error.code).toBe('MFA_CODE_INVALID');

    const enabled = await request(app)
      .post('/api/v1/auth/mfa/enable')
      .set('Authorization', `Bearer ${primaryAccessToken}`)
      .send({ code: validCode });
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.recoveryCodes).toHaveLength(10);
    expect(enabled.body.data.revokedSessions).toBe(1);
    const originalRecoveryCodes: string[] = enabled.body.data.recoveryCodes;

    const revokedSecondarySession = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${secondaryAccessToken}`);
    expect(revokedSecondarySession.status).toBe(401);
    expect(revokedSecondarySession.body.error.code).toBe('SESSION_REVOKED');

    const storedMfa = await pool.query<{
      mfa_secret_ciphertext: string;
      recovery_hashes: string[];
    }>(
      `SELECT u.mfa_secret_ciphertext,
              array_agg(rc.code_hash ORDER BY rc.code_hash) AS recovery_hashes
         FROM users u
         JOIN mfa_recovery_codes rc ON rc.user_id = u.id
        WHERE u.email = $1
        GROUP BY u.id`,
      [email],
    );
    expect(storedMfa.rows[0]!.mfa_secret_ciphertext).not.toContain(secret);
    expect(storedMfa.rows[0]!.recovery_hashes).toHaveLength(10);
    expect(JSON.stringify(storedMfa.rows[0])).not.toContain(originalRecoveryCodes[0]);

    const exhaustedLogin = await request(app).post('/api/v1/auth/login').send({ email, password });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const rejected = await request(app).post('/api/v1/auth/mfa/verify').send({
        mfaToken: exhaustedLogin.body.data.mfaToken,
        code: invalidCode,
      });
      expect(rejected.status).toBe(401);
      expect(rejected.body.error.code).toBe('MFA_CODE_INVALID');
      expect(rejected.body.error.details.remainingAttempts).toBe(5 - attempt);
    }
    const exhaustedChallenge = await request(app).post('/api/v1/auth/mfa/verify').send({
      mfaToken: exhaustedLogin.body.data.mfaToken,
      code: await generate({ secret }),
    });
    expect(exhaustedChallenge.status).toBe(401);
    expect(exhaustedChallenge.body.error.code).toBe('MFA_CHALLENGE_INVALID');

    const passwordLogin = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(passwordLogin.status).toBe(200);
    expect(passwordLogin.body.data).toEqual({
      mfaRequired: true,
      mfaToken: expect.any(String),
      expiresIn: expect.any(Number),
    });
    expect(passwordLogin.body.data).not.toHaveProperty('accessToken');
    expect(passwordLogin.body.data).not.toHaveProperty('refreshToken');

    const failedMfa = await request(app).post('/api/v1/auth/mfa/verify').send({
      mfaToken: passwordLogin.body.data.mfaToken,
      code: invalidCode,
    });
    expect(failedMfa.status).toBe(401);
    expect(failedMfa.body.error.code).toBe('MFA_CODE_INVALID');
    expect(failedMfa.body.error.details.remainingAttempts).toBe(4);

    const totpLogin = await request(app).post('/api/v1/auth/mfa/verify').send({
      mfaToken: passwordLogin.body.data.mfaToken,
      code: await generate({ secret }),
    });
    expect(totpLogin.status).toBe(200);
    expect(totpLogin.body.data.accessToken).toEqual(expect.any(String));
    const mfaSessionAccessToken: string = totpLogin.body.data.accessToken;

    const replay = await request(app).post('/api/v1/auth/mfa/verify').send({
      mfaToken: passwordLogin.body.data.mfaToken,
      code: await generate({ secret }),
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('MFA_CHALLENGE_INVALID');

    const recoveryLoginStart = await request(app).post('/api/v1/auth/login').send({ email, password });
    const recoveryLogin = await request(app).post('/api/v1/auth/mfa/verify').send({
      mfaToken: recoveryLoginStart.body.data.mfaToken,
      code: originalRecoveryCodes[0],
    });
    expect(recoveryLogin.status).toBe(200);

    const statusAfterRecovery = await request(app)
      .get('/api/v1/auth/mfa')
      .set('Authorization', `Bearer ${primaryAccessToken}`);
    expect(statusAfterRecovery.body.data.recoveryCodesRemaining).toBe(9);

    const regenerate = await request(app)
      .post('/api/v1/auth/mfa/recovery-codes')
      .set('Authorization', `Bearer ${primaryAccessToken}`)
      .send({ currentPassword: password, code: await generate({ secret }) });
    expect(regenerate.status).toBe(200);
    expect(regenerate.body.data.recoveryCodes).toHaveLength(10);
    expect(regenerate.body.data.recoveryCodes).not.toEqual(originalRecoveryCodes);
    expect(regenerate.body.data.revokedSessions).toBeGreaterThanOrEqual(2);
    const newRecoveryCodes: string[] = regenerate.body.data.recoveryCodes;

    const revokedMfaSession = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${mfaSessionAccessToken}`);
    expect(revokedMfaSession.status).toBe(401);

    const freshLoginStart = await request(app).post('/api/v1/auth/login').send({ email, password });
    const oldRecoveryCode = await request(app).post('/api/v1/auth/mfa/verify').send({
      mfaToken: freshLoginStart.body.data.mfaToken,
      code: originalRecoveryCodes[1],
    });
    expect(oldRecoveryCode.status).toBe(401);
    expect(oldRecoveryCode.body.error.code).toBe('MFA_CODE_INVALID');
    const newRecoveryCode = await request(app).post('/api/v1/auth/mfa/verify').send({
      mfaToken: freshLoginStart.body.data.mfaToken,
      code: newRecoveryCodes[0],
    });
    expect(newRecoveryCode.status).toBe(200);

    const disable = await request(app)
      .post('/api/v1/auth/mfa/disable')
      .set('Authorization', `Bearer ${primaryAccessToken}`)
      .send({ currentPassword: password, code: newRecoveryCodes[1] });
    expect(disable.status).toBe(200);
    expect(disable.body.data.disabled).toBe(true);

    const finalStatus = await request(app)
      .get('/api/v1/auth/mfa')
      .set('Authorization', `Bearer ${primaryAccessToken}`);
    expect(finalStatus.body.data).toEqual({
      enabled: false,
      enabledAt: null,
      recoveryCodesRemaining: 0,
    });
    const normalLogin = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(normalLogin.status).toBe(200);
    expect(normalLogin.body.data.accessToken).toEqual(expect.any(String));
    expect(normalLogin.body.data.mfaRequired).toBeUndefined();

    const securityEvents = await request(app)
      .get('/api/v1/auth/security-events?limit=50')
      .set('Authorization', `Bearer ${primaryAccessToken}`);
    expect(securityEvents.status).toBe(200);
    expect(securityEvents.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'mfa_setup_started' }),
      expect.objectContaining({ eventType: 'mfa_enabled' }),
      expect.objectContaining({ eventType: 'mfa_login_failed' }),
      expect.objectContaining({ eventType: 'mfa_recovery_codes_regenerated' }),
      expect.objectContaining({ eventType: 'mfa_disabled' }),
      expect.objectContaining({ eventType: 'login_succeeded', metadata: { mfaMethod: 'totp' } }),
      expect.objectContaining({ eventType: 'login_succeeded', metadata: { mfaMethod: 'recovery_code' } }),
    ]));
    const serializedEvents = JSON.stringify(securityEvents.body);
    expect(serializedEvents).not.toContain(secret);
    expect(serializedEvents).not.toContain(originalRecoveryCodes[0]);
    expect(serializedEvents).not.toContain(newRecoveryCodes[0]);
  });
});
