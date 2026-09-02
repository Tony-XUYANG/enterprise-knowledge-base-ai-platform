import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { createAccessToken } from '../src/security/tokens.js';

type TestRole = 'admin' | 'member';

const suffix = randomUUID();
const adminEmail = `audit-admin-${suffix}@example.com`;
const memberEmail = `audit-member-${suffix}@example.com`;
const invitedEmail = `audit-invitee-${suffix}@example.com`;
const app = createApp();

async function createTestUser(email: string, role: TestRole) {
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (
       email, password_hash, display_name, status, email_verified_at
     ) VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP)
     RETURNING id`,
    [
      email,
      '$2b$12$nN55PR.IzlfSe7z6Pki2uup7PkPymPOUq8AQbKSy6jGiQyNl0RZQG',
      role === 'admin' ? '审计测试管理员' : '审计测试成员',
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
       user_id, token_hash, expires_at, user_agent, ip_address, last_used_at
     ) VALUES (
       $1, $2, CURRENT_TIMESTAMP + INTERVAL '1 day', $3, '127.0.0.1', CURRENT_TIMESTAMP
     ) RETURNING id`,
    [
      userId,
      createHash('sha256').update(randomUUID()).digest('hex'),
      'KnowledgeHub admin-audit integration test',
    ],
  );
  const sessionId = sessionResult.rows[0]!.id;
  return {
    userId,
    sessionId,
    accessToken: await createAccessToken({ userId, roles: [role], sessionId }),
  };
}

describe('admin audit API', () => {
  let adminUserId: string;
  let memberUserId: string;
  let adminSessionId: string;
  let adminAccessToken: string;
  let memberAccessToken: string;

  beforeAll(async () => {
    await pool.query('SELECT 1');
    const admin = await createTestUser(adminEmail, 'admin');
    const member = await createTestUser(memberEmail, 'member');
    adminUserId = admin.userId;
    memberUserId = member.userId;
    adminSessionId = admin.sessionId;
    adminAccessToken = admin.accessToken;
    memberAccessToken = member.accessToken;

    await pool.query(
      `INSERT INTO security_events (
         user_id, event_type, outcome, actor_session_id,
         user_agent, ip_address, metadata
       ) VALUES
       ($1, 'login_failed', 'failure', NULL, $4, '203.0.113.15', $5::jsonb),
       ($1, 'user_role_changed', 'success', $3, $4, '198.51.100.8', $6::jsonb),
       ($2, 'member_invitation_sent', 'success', $3, $4, '198.51.100.8', $7::jsonb)`,
      [
        memberUserId,
        adminUserId,
        adminSessionId,
        'KnowledgeHub audit event fixture',
        JSON.stringify({ reason: 'invalid_credentials', fixture: suffix }),
        JSON.stringify({
          actorUserId: adminUserId,
          previousRole: 'member',
          role: 'admin',
          fixture: suffix,
        }),
        JSON.stringify({
          targetEmail: invitedEmail,
          role: 'member',
          action: 'created',
          fixture: suffix,
        }),
      ],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = ANY($1::varchar[])', [
      [adminEmail, memberEmail],
    ]);
    await pool.end();
  });

  it('enforces admin access and supports audit filters, actors, and stats', async () => {
    const unauthenticated = await request(app).get('/api/v1/admin/audit-events');
    expect(unauthenticated.status).toBe(401);

    const memberForbidden = await request(app)
      .get('/api/v1/admin/audit-events')
      .set('Authorization', `Bearer ${memberAccessToken}`);
    expect(memberForbidden.status).toBe(403);
    expect(memberForbidden.body.error.code).toBe('ADMIN_REQUIRED');

    const failedLoginResponse = await request(app)
      .get(
        `/api/v1/admin/audit-events?range=24h&outcome=failure&eventType=login_failed&search=${encodeURIComponent(memberEmail)}`,
      )
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(failedLoginResponse.status).toBe(200);
    expect(failedLoginResponse.body.data).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(failedLoginResponse.body.data.items[0]).toMatchObject({
      eventType: 'login_failed',
      outcome: 'failure',
      subject: {
        id: memberUserId,
        email: memberEmail,
        displayName: '审计测试成员',
      },
      actor: {
        id: memberUserId,
        email: memberEmail,
      },
      ipAddress: '203.0.113.15',
      metadata: { reason: 'invalid_credentials' },
    });
    expect(failedLoginResponse.body.data.items[0].metadata.fixture).toBeUndefined();

    const roleChangeResponse = await request(app)
      .get(
        `/api/v1/admin/audit-events?range=7d&eventType=user_role_changed&search=${encodeURIComponent(memberEmail)}`,
      )
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(roleChangeResponse.status).toBe(200);
    expect(roleChangeResponse.body.data.total).toBe(1);
    expect(roleChangeResponse.body.data.items[0]).toMatchObject({
      eventType: 'user_role_changed',
      subject: { id: memberUserId, email: memberEmail },
      actor: { id: adminUserId, email: adminEmail, displayName: '审计测试管理员' },
      actorSessionId: adminSessionId,
    });

    const invitationSearchResponse = await request(app)
      .get(`/api/v1/admin/audit-events?search=${encodeURIComponent(invitedEmail)}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(invitationSearchResponse.status).toBe(200);
    expect(invitationSearchResponse.body.data.total).toBe(1);
    expect(invitationSearchResponse.body.data.items[0]).toMatchObject({
      eventType: 'member_invitation_sent',
      subject: { id: adminUserId, email: adminEmail },
      actor: { id: adminUserId, email: adminEmail },
      metadata: { targetEmail: invitedEmail },
    });

    const statsResponse = await request(app)
      .get('/api/v1/admin/audit-events/stats?range=24h')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.data).toEqual(expect.objectContaining({
      total: expect.any(Number),
      failures: expect.any(Number),
      affectedMembers: expect.any(Number),
      adminActions: expect.any(Number),
    }));
    expect(statsResponse.body.data.total).toBeGreaterThanOrEqual(3);
    expect(statsResponse.body.data.failures).toBeGreaterThanOrEqual(1);
    expect(statsResponse.body.data.affectedMembers).toBeGreaterThanOrEqual(2);
    expect(statsResponse.body.data.adminActions).toBeGreaterThanOrEqual(2);

    const invalidRange = await request(app)
      .get('/api/v1/admin/audit-events?range=forever')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(invalidRange.status).toBe(400);
  });
});
