import { createHash, randomUUID } from 'node:crypto';
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

const suffix = randomUUID();
const ownerEmail = `access-key-owner-${suffix}@example.com`;
const outsiderEmail = `access-key-outsider-${suffix}@example.com`;
const password = 'AccessKey9!Secure';
const upstreamSecret = 'fastgpt-access-key-test-secret';
const app = createApp();

async function registerAndLogin(email: string, displayName: string): Promise<string> {
  const registration = await request(app).post('/api/v1/auth/register').send({
    email,
    password,
    displayName,
  });
  expect(registration.status).toBe(201);
  await pool.query(
    'UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE email = $1',
    [email],
  );
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return login.body.data.accessToken as string;
}

describe('application access keys and external chat API', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1 FROM app_access_keys LIMIT 1');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.query(
      `DELETE FROM conversations
        WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::varchar[]))`,
      [[ownerEmail, outsiderEmail]],
    );
    await pool.query(
      `DELETE FROM ai_apps
        WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::varchar[]))`,
      [[ownerEmail, outsiderEmail]],
    );
    await pool.query(
      `DELETE FROM knowledge_bases
        WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::varchar[]))`,
      [[ownerEmail, outsiderEmail]],
    );
    await pool.query('DELETE FROM users WHERE email = ANY($1::varchar[])', [
      [ownerEmail, outsiderEmail],
    ]);
    await pool.end();
  });

  it('manages hashed keys and isolates external conversations by application', async () => {
    const ownerAccessToken = await registerAndLogin(ownerEmail, '密钥所有者');
    const outsiderAccessToken = await registerAndLogin(outsiderEmail, '外部成员');

    const ownerAppResponse = await request(app)
      .post('/api/v1/apps')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: '外部客服助手',
        status: 'active',
        fastgptApiKey: upstreamSecret,
        settings: { temperature: 0.3 },
      });
    expect(ownerAppResponse.status).toBe(201);
    const ownerAppId: string = ownerAppResponse.body.data.id;

    const secondAppResponse = await request(app)
      .post('/api/v1/apps')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: '第二个外部助手',
        status: 'active',
        fastgptApiKey: upstreamSecret,
      });
    expect(secondAppResponse.status).toBe(201);
    const secondAppId: string = secondAppResponse.body.data.id;

    const unconfiguredAppResponse = await request(app)
      .post('/api/v1/apps')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '待配置助手', status: 'active' });
    expect(unconfiguredAppResponse.status).toBe(201);
    const unconfiguredAppId: string = unconfiguredAppResponse.body.data.id;

    const unauthorizedCreate = await request(app)
      .post(`/api/v1/apps/${ownerAppId}/access-keys`)
      .send({ name: '生产系统', expiresInDays: 90 });
    expect(unauthorizedCreate.status).toBe(401);

    const crossUserCreate = await request(app)
      .post(`/api/v1/apps/${ownerAppId}/access-keys`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`)
      .send({ name: '越权系统', expiresInDays: 90 });
    expect(crossUserCreate.status).toBe(404);
    expect(crossUserCreate.body.error.code).toBe('APP_NOT_FOUND');

    const invalidExpiry = await request(app)
      .post(`/api/v1/apps/${ownerAppId}/access-keys`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '无效期限', expiresInDays: 0 });
    expect(invalidExpiry.status).toBe(400);
    expect(invalidExpiry.body.error.code).toBe('VALIDATION_ERROR');

    const createKeyResponse = await request(app)
      .post(`/api/v1/apps/${ownerAppId}/access-keys`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '生产客服门户', expiresInDays: 90 });
    expect(createKeyResponse.status).toBe(201);
    expect(createKeyResponse.body.data.accessKey).toMatchObject({
      appId: ownerAppId,
      name: '生产客服门户',
      status: 'active',
      lastUsedAt: null,
    });
    const accessKeyId: string = createKeyResponse.body.data.accessKey.id;
    const accessKeySecret: string = createKeyResponse.body.data.secret;
    expect(accessKeySecret).toMatch(/^kh_app_[A-Za-z0-9_-]{43}$/u);
    expect(createKeyResponse.body.data.accessKey.prefix).toBe(accessKeySecret.slice(0, 15));

    const storedKey = await pool.query<{ secret_hash: string }>(
      'SELECT secret_hash FROM app_access_keys WHERE id = $1',
      [accessKeyId],
    );
    expect(storedKey.rows[0]?.secret_hash).toBe(
      createHash('sha256').update(accessKeySecret).digest('hex'),
    );
    expect(JSON.stringify(storedKey.rows[0])).not.toContain(accessKeySecret);

    const duplicateKeyName = await request(app)
      .post(`/api/v1/apps/${ownerAppId}/access-keys`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '生产客服门户', expiresInDays: 30 });
    expect(duplicateKeyName.status).toBe(409);
    expect(duplicateKeyName.body.error.code).toBe('APP_ACCESS_KEY_NAME_EXISTS');

    const listKeysResponse = await request(app)
      .get(`/api/v1/apps/${ownerAppId}/access-keys`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(listKeysResponse.status).toBe(200);
    expect(listKeysResponse.body.data).toHaveLength(1);
    expect(listKeysResponse.body.data[0]).toMatchObject({
      id: accessKeyId,
      prefix: accessKeySecret.slice(0, 15),
      status: 'active',
    });
    expect(JSON.stringify(listKeysResponse.body)).not.toContain(accessKeySecret);

    const crossUserList = await request(app)
      .get(`/api/v1/apps/${ownerAppId}/access-keys`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserList.status).toBe(404);

    const missingExternalCredential = await request(app)
      .post('/api/v1/external/chat')
      .send({ message: '没有凭据的请求' });
    expect(missingExternalCredential.status).toBe(401);
    expect(missingExternalCredential.body.error.code).toBe('APP_ACCESS_KEY_REQUIRED');

    const invalidExternalCredential = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', 'Bearer kh_app_invalid')
      .send({ message: '无效凭据请求' });
    expect(invalidExternalCredential.status).toBe(401);
    expect(invalidExternalCredential.body.error.code).toBe('INVALID_APP_ACCESS_KEY');

    let firstFastGptBody: Record<string, unknown> | undefined;
    const fastGptFetch = vi.spyOn(globalThis, 'fetch');
    fastGptFetch.mockImplementationOnce(async (_url, init) => {
      firstFastGptBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${upstreamSecret}`);
      return new Response(JSON.stringify({
        id: 'external-message-1',
        model: 'external-test-model',
        choices: [{ message: { content: '订单支持在签收后七天内申请退款。' } }],
        usage: { prompt_tokens: 20, completion_tokens: 14 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const firstExternalChat = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', `Bearer ${accessKeySecret}`)
      .send({ message: '订单如何退款？', title: '门户退款咨询' });
    expect(firstExternalChat.status).toBe(201);
    expect(firstExternalChat.body.data).toMatchObject({
      appId: ownerAppId,
      conversationCreated: true,
      userMessage: {
        sequenceNo: 1,
        content: '订单如何退款？',
        metadata: { source: 'app_access_key', accessKeyId },
      },
      assistantMessage: {
        sequenceNo: 2,
        content: '订单支持在签收后七天内申请退款。',
        model: 'external-test-model',
      },
    });
    const externalConversationId: string = firstExternalChat.body.data.conversationId;
    expect(firstFastGptBody?.messages).toHaveLength(1);
    expect(JSON.stringify(firstExternalChat.body)).not.toContain(accessKeySecret);
    expect(JSON.stringify(firstExternalChat.body)).not.toContain(upstreamSecret);

    const touchedKey = await pool.query<{ last_used_at: Date | null }>(
      'SELECT last_used_at FROM app_access_keys WHERE id = $1',
      [accessKeyId],
    );
    expect(touchedKey.rows[0]?.last_used_at).toBeInstanceOf(Date);

    const secondKeyResponse = await request(app)
      .post(`/api/v1/apps/${secondAppId}/access-keys`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '第二应用接入', expiresInDays: 90 });
    expect(secondKeyResponse.status).toBe(201);
    const secondKeyId: string = secondKeyResponse.body.data.accessKey.id;
    const secondKeySecret: string = secondKeyResponse.body.data.secret;

    const crossAppConversation = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', `Bearer ${secondKeySecret}`)
      .send({ message: '不应访问其他应用对话', conversationId: externalConversationId });
    expect(crossAppConversation.status).toBe(404);
    expect(crossAppConversation.body.error.code).toBe('EXTERNAL_CONVERSATION_NOT_FOUND');

    let continuedFastGptBody: Record<string, unknown> | undefined;
    fastGptFetch.mockImplementationOnce(async (_url, init) => {
      continuedFastGptBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'external-message-2',
        model: 'external-test-model',
        choices: [{ message: { content: '退款审核通常在一个工作日内完成。' } }],
        usage: { prompt_tokens: 38, completion_tokens: 18 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const continuedExternalChat = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', `Bearer ${accessKeySecret}`)
      .send({ message: '审核需要多久？', conversationId: externalConversationId });
    expect(continuedExternalChat.status).toBe(201);
    expect(continuedExternalChat.body.data).toMatchObject({
      conversationId: externalConversationId,
      conversationCreated: false,
      userMessage: { sequenceNo: 3 },
      assistantMessage: { sequenceNo: 4 },
    });
    expect(continuedFastGptBody?.messages).toHaveLength(3);
    fastGptFetch.mockRestore();

    const invalidExternalChat = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', `Bearer ${accessKeySecret}`)
      .send({ message: '' });
    expect(invalidExternalChat.status).toBe(400);
    expect(invalidExternalChat.body.error.code).toBe('VALIDATION_ERROR');

    const unauthorizedRequestLog = await request(app)
      .get(`/api/v1/apps/${ownerAppId}/external-requests`);
    expect(unauthorizedRequestLog.status).toBe(401);

    const crossUserRequestLog = await request(app)
      .get(`/api/v1/apps/${ownerAppId}/external-requests`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserRequestLog.status).toBe(404);

    const requestLogResponse = await request(app)
      .get(`/api/v1/apps/${ownerAppId}/external-requests`)
      .query({ range: '24h', pageSize: 1 })
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(requestLogResponse.status).toBe(200);
    expect(requestLogResponse.body.data).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 3,
      range: '24h',
      summary: {
        calls: 3,
        successes: 2,
        failures: 1,
        successRate: 66.7,
        promptTokens: 58,
        completionTokens: 32,
        totalTokens: 90,
      },
    });
    expect(requestLogResponse.body.data.items).toHaveLength(1);
    expect(requestLogResponse.body.data.items[0]).toMatchObject({
      appId: ownerAppId,
      accessKeyId,
      accessKeyName: '生产客服门户',
      accessKeyPrefix: accessKeySecret.slice(0, 15),
      outcome: 'failure',
      httpStatus: 400,
      errorCode: 'VALIDATION_ERROR',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(requestLogResponse.body.data.items[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(requestLogResponse.body)).not.toContain(accessKeySecret);
    expect(JSON.stringify(requestLogResponse.body)).not.toContain('订单如何退款？');

    const successfulRequestLog = await request(app)
      .get(`/api/v1/apps/${ownerAppId}/external-requests`)
      .query({ range: '7d', outcome: 'success', accessKeyId, pageSize: 20 })
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(successfulRequestLog.status).toBe(200);
    expect(successfulRequestLog.body.data.total).toBe(2);
    expect(successfulRequestLog.body.data.items).toHaveLength(2);
    expect(successfulRequestLog.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId: externalConversationId,
        outcome: 'success',
        httpStatus: 201,
      }),
    ]));

    const secondAppRequestLog = await request(app)
      .get(`/api/v1/apps/${secondAppId}/external-requests`)
      .query({ range: '7d', outcome: 'failure' })
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(secondAppRequestLog.status).toBe(200);
    expect(secondAppRequestLog.body.data).toMatchObject({
      total: 1,
      summary: { calls: 1, successes: 0, failures: 1, successRate: 0 },
    });
    expect(secondAppRequestLog.body.data.items[0]).toMatchObject({
      accessKeyId: secondKeyId,
      conversationId: null,
      outcome: 'failure',
      httpStatus: 404,
      errorCode: 'EXTERNAL_CONVERSATION_NOT_FOUND',
    });

    const crossUserRevoke = await request(app)
      .delete(`/api/v1/apps/${ownerAppId}/access-keys/${accessKeyId}`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserRevoke.status).toBe(404);

    const revokeResponse = await request(app)
      .delete(`/api/v1/apps/${ownerAppId}/access-keys/${accessKeyId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(revokeResponse.status).toBe(204);
    const repeatRevokeResponse = await request(app)
      .delete(`/api/v1/apps/${ownerAppId}/access-keys/${accessKeyId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(repeatRevokeResponse.status).toBe(204);

    const revokedExternalChat = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', `Bearer ${accessKeySecret}`)
      .send({ message: '已撤销密钥不应生效' });
    expect(revokedExternalChat.status).toBe(401);

    const expiringKeyResponse = await request(app)
      .post(`/api/v1/apps/${ownerAppId}/access-keys`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '过期接入', expiresInDays: 1 });
    expect(expiringKeyResponse.status).toBe(201);
    const expiredKeyId: string = expiringKeyResponse.body.data.accessKey.id;
    const expiredKeySecret: string = expiringKeyResponse.body.data.secret;
    await pool.query(
      `UPDATE app_access_keys
          SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 days',
              expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
        WHERE id = $1`,
      [expiredKeyId],
    );
    const expiredExternalChat = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', `Bearer ${expiredKeySecret}`)
      .send({ message: '过期密钥不应生效' });
    expect(expiredExternalChat.status).toBe(401);

    const disableSecondApp = await request(app)
      .delete(`/api/v1/apps/${secondAppId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(disableSecondApp.status).toBe(204);
    const disabledAppChat = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', `Bearer ${secondKeySecret}`)
      .send({ message: '停用应用不应被调用' });
    expect(disabledAppChat.status).toBe(403);
    expect(disabledAppChat.body.error.code).toBe('APP_NOT_ACTIVE');

    const unconfiguredKeyResponse = await request(app)
      .post(`/api/v1/apps/${unconfiguredAppId}/access-keys`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '未配置接入', expiresInDays: 30 });
    expect(unconfiguredKeyResponse.status).toBe(201);
    const unconfiguredChat = await request(app)
      .post('/api/v1/external/chat')
      .set('Authorization', `Bearer ${unconfiguredKeyResponse.body.data.secret}`)
      .send({ message: '未配置 FastGPT' });
    expect(unconfiguredChat.status).toBe(409);
    expect(unconfiguredChat.body.error.code).toBe('FASTGPT_NOT_CONFIGURED');

    const finalKeyList = await request(app)
      .get(`/api/v1/apps/${ownerAppId}/access-keys`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(finalKeyList.status).toBe(200);
    expect(finalKeyList.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: accessKeyId, status: 'revoked' }),
      expect.objectContaining({ id: expiredKeyId, status: 'expired' }),
    ]));

    await request(app)
      .delete(`/api/v1/apps/${secondAppId}/access-keys/${secondKeyId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
  });
});
