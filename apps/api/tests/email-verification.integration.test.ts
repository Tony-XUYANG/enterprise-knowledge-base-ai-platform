import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';

const { sendEmailVerificationMessageMock } = vi.hoisted(() => ({
  sendEmailVerificationMessageMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/modules/auth/email-verification-mailer.js', () => ({
  sendEmailVerificationMessage: sendEmailVerificationMessageMock,
}));

const suffix = randomUUID();
const email = `verify-${suffix}@example.com`;
const failedDeliveryEmail = `verify-delivery-${suffix}@example.com`;
const password = 'Verification9!Secure';
const app = createApp();

describe('email verification', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = ANY($1::varchar[])', [
      [email, failedDeliveryEmail],
    ]);
    await pool.end();
  });

  it('requires a one-time verified email before issuing login sessions', async () => {
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .set('User-Agent', 'Email-Verification-Register/1.0')
      .send({ email, password, displayName: '邮箱验证用户' });
    expect(registration.status).toBe(201);
    expect(registration.body.data).toEqual({
      verificationRequired: true,
      email,
      expiresIn: env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60,
    });
    expect(registration.body.data.accessToken).toBeUndefined();
    expect(sendEmailVerificationMessageMock).toHaveBeenCalledTimes(1);

    const registrationMessage = sendEmailVerificationMessageMock.mock.calls[0]![0];
    const registrationUrl = new URL(registrationMessage.verificationUrl);
    const registrationToken = registrationUrl.searchParams.get('token')!;
    expect(registrationToken.length).toBeGreaterThanOrEqual(40);
    const storedRegistration = await pool.query<{
      email_verified_at: Date | null;
      token_hash: string;
      session_count: string;
    }>(
      `SELECT u.email_verified_at, evt.token_hash,
              (SELECT count(*)::text FROM refresh_tokens rt WHERE rt.user_id = u.id) AS session_count
         FROM users u
         JOIN email_verification_tokens evt ON evt.user_id = u.id
        WHERE u.email = $1
          AND evt.used_at IS NULL`,
      [email],
    );
    expect(storedRegistration.rows).toHaveLength(1);
    expect(storedRegistration.rows[0]!.email_verified_at).toBeNull();
    expect(storedRegistration.rows[0]!.session_count).toBe('0');
    expect(storedRegistration.rows[0]!.token_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(storedRegistration.rows)).not.toContain(registrationToken);

    const wrongPassword = await request(app).post('/api/v1/auth/login').send({
      email,
      password: 'WrongPassword9!',
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    const unverifiedLogin = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(unverifiedLogin.status).toBe(403);
    expect(unverifiedLogin.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');

    await pool.query(
      `UPDATE email_verification_tokens
          SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 hours',
              expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE token_hash = $1`,
      [storedRegistration.rows[0]!.token_hash],
    );
    const expiredConfirmation = await request(app)
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token: registrationToken });
    expect(expiredConfirmation.status).toBe(400);
    expect(expiredConfirmation.body.error.code).toBe('INVALID_EMAIL_VERIFICATION_TOKEN');

    const unknownResend = await request(app)
      .post('/api/v1/auth/email-verification/resend')
      .send({ email: `unknown-${suffix}@example.com` });
    expect(unknownResend.status).toBe(202);
    expect(unknownResend.body.data).toEqual({
      accepted: true,
      message: '如果该邮箱需要验证，新链接将在几分钟内发送',
    });
    expect(sendEmailVerificationMessageMock).toHaveBeenCalledTimes(1);

    const resend = await request(app)
      .post('/api/v1/auth/email-verification/resend')
      .set('User-Agent', 'Email-Verification-Resend/1.0')
      .send({ email });
    expect(resend.status).toBe(202);
    expect(resend.body.data).toEqual(unknownResend.body.data);
    expect(sendEmailVerificationMessageMock).toHaveBeenCalledTimes(2);
    const activeUrl = new URL(
      sendEmailVerificationMessageMock.mock.calls[1]![0].verificationUrl,
    );
    const activeToken = activeUrl.searchParams.get('token')!;
    expect(activeToken).not.toBe(registrationToken);

    const confirmations = await Promise.all([
      request(app)
        .post('/api/v1/auth/email-verification/confirm')
        .set('User-Agent', 'Email-Verification-Confirm/1.0')
        .send({ token: activeToken }),
      request(app)
        .post('/api/v1/auth/email-verification/confirm')
        .set('User-Agent', 'Email-Verification-Confirm/1.0')
        .send({ token: activeToken }),
    ]);
    expect(confirmations.map((response) => response.status).sort()).toEqual([204, 400]);
    expect(confirmations.find((response) => response.status === 400)!.body.error.code)
      .toBe('INVALID_EMAIL_VERIFICATION_TOKEN');

    const replay = await request(app)
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token: activeToken });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_EMAIL_VERIFICATION_TOKEN');

    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.data.user).toMatchObject({
      email,
      emailVerifiedAt: expect.any(String),
    });
    expect(login.body.data.accessToken).toEqual(expect.any(String));

    const verifiedResend = await request(app)
      .post('/api/v1/auth/email-verification/resend')
      .send({ email });
    expect(verifiedResend.status).toBe(202);
    expect(verifiedResend.body.data).toEqual(unknownResend.body.data);
    expect(sendEmailVerificationMessageMock).toHaveBeenCalledTimes(2);

    const securityEvents = await request(app)
      .get('/api/v1/auth/security-events?limit=20')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(securityEvents.status).toBe(200);
    expect(securityEvents.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'account_registered' }),
      expect.objectContaining({ eventType: 'email_verification_requested' }),
      expect.objectContaining({ eventType: 'email_verified' }),
      expect.objectContaining({
        eventType: 'login_failed',
        metadata: expect.objectContaining({ reason: 'email_not_verified' }),
      }),
    ]));
    expect(JSON.stringify(securityEvents.body)).not.toContain(registrationToken);
    expect(JSON.stringify(securityEvents.body)).not.toContain(activeToken);

    sendEmailVerificationMessageMock.mockRejectedValueOnce(new Error('SMTP unavailable'));
    const failedDelivery = await request(app).post('/api/v1/auth/register').send({
      email: failedDeliveryEmail,
      password,
      displayName: '投递失败用户',
    });
    expect(failedDelivery.status).toBe(201);
    const activeAfterFailure = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM email_verification_tokens evt
         JOIN users u ON u.id = evt.user_id
        WHERE u.email = $1
          AND evt.used_at IS NULL`,
      [failedDeliveryEmail],
    );
    expect(activeAfterFailure.rows[0]!.total).toBe('0');
  });
});
