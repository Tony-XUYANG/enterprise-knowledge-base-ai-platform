import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { createAccessToken } from '../src/security/tokens.js';

const { sendMemberInvitationMessageMock, sendEmailVerificationMessageMock } = vi.hoisted(() => ({
  sendMemberInvitationMessageMock: vi.fn().mockResolvedValue(undefined),
  sendEmailVerificationMessageMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/modules/member-invitations/member-invitation-mailer.js', () => ({
  sendMemberInvitationMessage: sendMemberInvitationMessageMock,
}));

vi.mock('../src/modules/auth/email-verification-mailer.js', () => ({
  sendEmailVerificationMessage: sendEmailVerificationMessageMock,
}));

const suffix = randomUUID();
const adminEmail = `invitation-admin-${suffix}@example.com`;
const memberEmail = `invitation-member-${suffix}@example.com`;
const invitedEmail = `invited-${suffix}@example.com`;
const revokedEmail = `revoked-${suffix}@example.com`;
const concurrentEmail = `concurrent-${suffix}@example.com`;
const failedEmail = `failed-${suffix}@example.com`;
const registeredBeforeResendEmail = `registered-before-resend-${suffix}@example.com`;
const registeredAfterInvitationEmail = `registered-after-invitation-${suffix}@example.com`;
const password = 'Training9!Secure';
const app = createApp();

async function createTestUser(email: string, role: 'admin' | 'member') {
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (
       email, password_hash, display_name, status, email_verified_at
     ) VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP)
     RETURNING id`,
    [
      email,
      '$2b$12$nN55PR.IzlfSe7z6Pki2uup7PkPymPOUq8AQbKSy6jGiQyNl0RZQG',
      role === 'admin' ? '邀请测试管理员' : '邀请测试成员',
    ],
  );
  const userId = userResult.rows[0]!.id;
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE code = $2`,
    [userId, role],
  );
  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO refresh_tokens (
       user_id, token_hash, expires_at, user_agent, last_used_at
     ) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 day', $3, CURRENT_TIMESTAMP)
     RETURNING id`,
    [
      userId,
      createHash('sha256').update(randomUUID()).digest('hex'),
      'KnowledgeHub invitation integration test',
    ],
  );
  return {
    userId,
    accessToken: await createAccessToken({
      userId,
      roles: [role],
      sessionId: sessionResult.rows[0]!.id,
    }),
  };
}

function invitationToken(callIndex: number): string {
  const call = sendMemberInvitationMessageMock.mock.calls[callIndex];
  const invitationUrl = call?.[0]?.invitationUrl as string | undefined;
  const token = invitationUrl ? new URL(invitationUrl).searchParams.get('token') : null;
  if (!token) throw new Error(`Invitation token missing from mail call ${callIndex}`);
  return token;
}

describe('member invitations API', () => {
  let adminUserId: string;
  let adminAccessToken: string;
  let memberAccessToken: string;

  beforeAll(async () => {
    await pool.query('SELECT 1');
    const admin = await createTestUser(adminEmail, 'admin');
    const member = await createTestUser(memberEmail, 'member');
    adminUserId = admin.userId;
    adminAccessToken = admin.accessToken;
    memberAccessToken = member.accessToken;
  });

  beforeEach(() => {
    sendMemberInvitationMessageMock.mockReset();
    sendMemberInvitationMessageMock.mockResolvedValue(undefined);
    sendEmailVerificationMessageMock.mockReset();
    sendEmailVerificationMessageMock.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM member_invitations WHERE email = ANY($1::varchar[])',
      [[
        invitedEmail,
        revokedEmail,
        concurrentEmail,
        failedEmail,
        registeredBeforeResendEmail,
        registeredAfterInvitationEmail,
      ]],
    );
    await pool.query('DELETE FROM users WHERE email = ANY($1::varchar[])', [
      [
        adminEmail,
        memberEmail,
        invitedEmail,
        revokedEmail,
        concurrentEmail,
        failedEmail,
        registeredBeforeResendEmail,
        registeredAfterInvitationEmail,
      ],
    ]);
    await pool.end();
  });

  it('creates, resends, accepts, and audits a secure invitation', async () => {
    const unauthorized = await request(app).get('/api/v1/admin/invitations');
    expect(unauthorized.status).toBe(401);

    const memberForbidden = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Authorization', `Bearer ${memberAccessToken}`)
      .send({ email: invitedEmail, role: 'member' });
    expect(memberForbidden.status).toBe(403);
    expect(memberForbidden.body.error.code).toBe('ADMIN_REQUIRED');

    const createResponse = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: invitedEmail, role: 'member' });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data).toMatchObject({
      id: expect.any(String),
      email: invitedEmail,
      role: 'member',
      expiresAt: expect.any(String),
    });
    expect(createResponse.body.data.token).toBeUndefined();
    expect(sendMemberInvitationMessageMock).toHaveBeenCalledTimes(1);
    const originalToken = invitationToken(0);

    const storedToken = await pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM member_invitations WHERE id = $1',
      [createResponse.body.data.id],
    );
    expect(storedToken.rows[0]!.token_hash).toBe(
      createHash('sha256').update(originalToken).digest('hex'),
    );
    expect(storedToken.rows[0]!.token_hash).not.toContain(originalToken);

    const listResponse = await request(app)
      .get(`/api/v1/admin/invitations?status=pending&search=${encodeURIComponent(invitedEmail)}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.total).toBe(1);
    expect(listResponse.body.data.items[0]).toMatchObject({
      email: invitedEmail,
      role: 'member',
      status: 'pending',
      sendCount: 1,
    });

    const originalInspect = await request(app)
      .post('/api/v1/invitations/inspect')
      .send({ token: originalToken });
    expect(originalInspect.status).toBe(200);
    expect(originalInspect.body.data).toMatchObject({
      email: invitedEmail,
      role: 'member',
      inviterName: '邀请测试管理员',
    });

    const resendResponse = await request(app)
      .post(`/api/v1/admin/invitations/${createResponse.body.data.id}/resend`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(resendResponse.status).toBe(200);
    expect(sendMemberInvitationMessageMock).toHaveBeenCalledTimes(2);
    const replacementToken = invitationToken(1);
    expect(replacementToken).not.toBe(originalToken);

    const invalidatedOriginal = await request(app)
      .post('/api/v1/invitations/inspect')
      .send({ token: originalToken });
    expect(invalidatedOriginal.status).toBe(400);
    expect(invalidatedOriginal.body.error.code).toBe('INVITATION_INVALID');

    const weakPassword = await request(app)
      .post('/api/v1/invitations/accept')
      .send({
        token: replacementToken,
        displayName: '受邀成员',
        password: 'Password1!',
      });
    expect(weakPassword.status).toBe(400);
    expect(weakPassword.body.error.code).toBe('PASSWORD_POLICY_VIOLATION');

    const acceptResponse = await request(app)
      .post('/api/v1/invitations/accept')
      .send({
        token: replacementToken,
        displayName: '受邀成员',
        password,
      });
    expect(acceptResponse.status).toBe(201);
    expect(acceptResponse.body.data).toEqual({
      email: invitedEmail,
      displayName: '受邀成员',
      role: 'member',
    });

    const acceptedUser = await pool.query<{
      email_verified_at: Date | null;
      role: string;
      sessions: string;
    }>(
      `SELECT u.email_verified_at, r.code AS role,
              count(rt.id)::text AS sessions
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         LEFT JOIN refresh_tokens rt ON rt.user_id = u.id
        WHERE u.email = $1
        GROUP BY u.id, r.code`,
      [invitedEmail],
    );
    expect(acceptedUser.rows[0]).toMatchObject({
      email_verified_at: expect.any(Date),
      role: 'member',
      sessions: '0',
    });

    const replay = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token: replacementToken, displayName: '重复接受', password });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVITATION_INVALID');

    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: invitedEmail, password });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.user.roles).toEqual(['member']);

    const existingUserInvite = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: invitedEmail, role: 'member' });
    expect(existingUserInvite.status).toBe(409);
    expect(existingUserInvite.body.error.code).toBe('USER_ALREADY_EXISTS');

    const securityEvents = await pool.query<{ event_type: string; outcome: string }>(
      `SELECT event_type, outcome
         FROM security_events
        WHERE user_id = $1
          AND event_type = 'member_invitation_sent'
        ORDER BY created_at`,
      [adminUserId],
    );
    expect(securityEvents.rows).toHaveLength(2);
    expect(securityEvents.rows.every((event) => event.outcome === 'success')).toBe(true);
  });

  it('revokes invitations, invalidates delivery failures, and permits one concurrent acceptance', async () => {
    const revokedCreate = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: revokedEmail, role: 'admin' });
    expect(revokedCreate.status).toBe(201);
    const revokedToken = invitationToken(0);

    const revokeResponse = await request(app)
      .delete(`/api/v1/admin/invitations/${revokedCreate.body.data.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(revokeResponse.status).toBe(204);

    const revokedInspect = await request(app)
      .post('/api/v1/invitations/inspect')
      .send({ token: revokedToken });
    expect(revokedInspect.status).toBe(400);

    sendMemberInvitationMessageMock.mockReset();
    sendMemberInvitationMessageMock.mockRejectedValueOnce(new Error('SMTP unavailable'));
    const failedDelivery = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: failedEmail, role: 'member' });
    expect(failedDelivery.status).toBe(502);
    expect(failedDelivery.body.error.code).toBe('INVITATION_DELIVERY_FAILED');
    const failedToken = invitationToken(0);
    const failedInspect = await request(app)
      .post('/api/v1/invitations/inspect')
      .send({ token: failedToken });
    expect(failedInspect.status).toBe(400);

    sendMemberInvitationMessageMock.mockReset();
    sendMemberInvitationMessageMock.mockResolvedValue(undefined);
    const concurrentCreate = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: concurrentEmail, role: 'member' });
    expect(concurrentCreate.status).toBe(201);
    const concurrentToken = invitationToken(0);

    const [firstAcceptance, secondAcceptance] = await Promise.all([
      request(app).post('/api/v1/invitations/accept').send({
        token: concurrentToken,
        displayName: '并发成员',
        password,
      }),
      request(app).post('/api/v1/invitations/accept').send({
        token: concurrentToken,
        displayName: '并发成员',
        password,
      }),
    ]);
    expect([firstAcceptance.status, secondAcceptance.status].sort()).toEqual([201, 400]);
    const userCount = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM users WHERE email = $1',
      [concurrentEmail],
    );
    expect(userCount.rows[0]!.total).toBe('1');

    sendMemberInvitationMessageMock.mockReset();
    sendMemberInvitationMessageMock.mockResolvedValue(undefined);
    const staleCreate = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: registeredBeforeResendEmail, role: 'member' });
    expect(staleCreate.status).toBe(201);
    await pool.query(
      `INSERT INTO users (
         email, password_hash, display_name, status, email_verified_at
       ) VALUES ($1, $2, '已注册成员', 'active', CURRENT_TIMESTAMP)`,
      [
        registeredBeforeResendEmail,
        '$2b$12$nN55PR.IzlfSe7z6Pki2uup7PkPymPOUq8AQbKSy6jGiQyNl0RZQG',
      ],
    );
    const staleResend = await request(app)
      .post(`/api/v1/admin/invitations/${staleCreate.body.data.id}/resend`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(staleResend.status).toBe(409);
    expect(staleResend.body.error.code).toBe('USER_ALREADY_EXISTS');
    const staleInvitation = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM member_invitations WHERE id = $1',
      [staleCreate.body.data.id],
    );
    expect(staleInvitation.rows[0]!.revoked_at).toBeInstanceOf(Date);
  });

  it('revokes an outstanding invitation when the email registers normally', async () => {
    const invitationResponse = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: registeredAfterInvitationEmail, role: 'admin' });
    expect(invitationResponse.status).toBe(201);
    const token = invitationToken(0);

    const registrationResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: registeredAfterInvitationEmail,
        displayName: '普通注册成员',
        password,
      });
    expect(registrationResponse.status).toBe(201);
    expect(sendEmailVerificationMessageMock).toHaveBeenCalledTimes(1);

    const invitation = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM member_invitations WHERE id = $1',
      [invitationResponse.body.data.id],
    );
    expect(invitation.rows[0]!.revoked_at).toBeInstanceOf(Date);

    const inspectionResponse = await request(app)
      .post('/api/v1/invitations/inspect')
      .send({ token });
    expect(inspectionResponse.status).toBe(400);
    expect(inspectionResponse.body.error.code).toBe('INVITATION_INVALID');
  });
});
