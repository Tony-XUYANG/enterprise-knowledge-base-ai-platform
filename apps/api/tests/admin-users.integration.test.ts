import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { createAccessToken } from '../src/security/tokens.js';

type TestRole = 'admin' | 'member';

const suffix = randomUUID();
const adminEmail = `admin-users-admin-${suffix}@example.com`;
const memberEmail = `admin-users-member-${suffix}@example.com`;
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
      role === 'admin' ? '成员管理测试管理员' : '成员管理测试成员',
    ],
  );
  const userId = userResult.rows[0]!.id;
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE code = $2`,
    [userId, role],
  );
  return {
    userId,
    accessToken: await createTestSession(userId, [role]),
  };
}

async function createTestSession(userId: string, roles: string[]) {
  const sessionResult = await pool.query<{ id: string }>(
    `INSERT INTO refresh_tokens (
       user_id, token_hash, expires_at, user_agent, last_used_at
     ) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 day', $3, CURRENT_TIMESTAMP)
     RETURNING id`,
    [
      userId,
      createHash('sha256').update(randomUUID()).digest('hex'),
      'KnowledgeHub admin-users integration test',
    ],
  );
  return createAccessToken({
    userId,
    roles,
    sessionId: sessionResult.rows[0]!.id,
  });
}

describe('admin user management API', () => {
  let adminUserId: string;
  let memberUserId: string;
  let adminAccessToken: string;
  let memberAccessToken: string;

  beforeAll(async () => {
    await pool.query('SELECT 1');
    const admin = await createTestUser(adminEmail, 'admin');
    const member = await createTestUser(memberEmail, 'member');
    adminUserId = admin.userId;
    memberUserId = member.userId;
    adminAccessToken = admin.accessToken;
    memberAccessToken = member.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = ANY($1::varchar[])', [
      [adminEmail, memberEmail],
    ]);
    await pool.end();
  });

  it('enforces live admin authorization and safely manages roles and status', async () => {
    const unauthenticated = await request(app).get('/api/v1/admin/users');
    expect(unauthenticated.status).toBe(401);

    const memberForbidden = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${memberAccessToken}`);
    expect(memberForbidden.status).toBe(403);
    expect(memberForbidden.body.error.code).toBe('ADMIN_REQUIRED');

    const listResponse = await request(app)
      .get(`/api/v1/admin/users?search=${encodeURIComponent(memberEmail)}&role=member`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.total).toBe(1);
    expect(listResponse.body.data.items[0]).toMatchObject({
      id: memberUserId,
      email: memberEmail,
      role: 'member',
      status: 'active',
      current: false,
      activeSessions: 1,
    });

    const statsResponse = await request(app)
      .get('/api/v1/admin/users/stats')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body.data).toEqual(expect.objectContaining({
      total: expect.any(Number),
      active: expect.any(Number),
      admins: expect.any(Number),
      pendingVerification: expect.any(Number),
    }));

    const promoteResponse = await request(app)
      .patch(`/api/v1/admin/users/${memberUserId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ role: 'admin' });
    expect(promoteResponse.status).toBe(200);
    expect(promoteResponse.body.data).toMatchObject({
      role: 'admin',
      status: 'active',
      activeSessions: 0,
    });

    const revokedMemberSession = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${memberAccessToken}`);
    expect(revokedMemberSession.status).toBe(401);
    expect(revokedMemberSession.body.error.code).toBe('SESSION_REVOKED');

    const selfUpdate = await request(app)
      .patch(`/api/v1/admin/users/${adminUserId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'disabled' });
    expect(selfUpdate.status).toBe(409);
    expect(selfUpdate.body.error.code).toBe('SELF_ADMIN_UPDATE_FORBIDDEN');

    const promotedSession = await createTestSession(memberUserId, ['admin']);
    const disableResponse = await request(app)
      .patch(`/api/v1/admin/users/${memberUserId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'disabled' });
    expect(disableResponse.status).toBe(200);
    expect(disableResponse.body.data).toMatchObject({
      role: 'admin',
      status: 'disabled',
      activeSessions: 0,
    });

    const revokedPromotedSession = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${promotedSession}`);
    expect(revokedPromotedSession.status).toBe(401);

    const restoreResponse = await request(app)
      .patch(`/api/v1/admin/users/${memberUserId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ role: 'member', status: 'active' });
    expect(restoreResponse.status).toBe(200);
    expect(restoreResponse.body.data).toMatchObject({
      role: 'member',
      status: 'active',
    });

    const eventResult = await pool.query<{ event_type: string }>(
      `SELECT event_type
         FROM security_events
        WHERE user_id = $1
          AND event_type IN ('user_role_changed', 'user_status_changed')
        ORDER BY created_at`,
      [memberUserId],
    );
    expect(eventResult.rows.map((row) => row.event_type)).toEqual([
      'user_role_changed',
      'user_status_changed',
      'user_role_changed',
      'user_status_changed',
    ]);
  });
});
