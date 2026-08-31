import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';
import { createAccessToken } from '../src/security/tokens.js';

const suffix = randomUUID();
const ownerEmail = `owner-${suffix}@example.com`;
const outsiderEmail = `outsider-${suffix}@example.com`;
const lockoutEmail = `lockout-${suffix}@example.com`;
const password = 'Training9!Secure';
const fastgptApiKey = 'fastgpt-test-secret-2026';
const app = createApp();

describe('authentication and AI app API', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM conversations
        WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::varchar[]))`,
      [[ownerEmail, outsiderEmail, lockoutEmail]],
    );
    await pool.query(
      `DELETE FROM ai_apps
        WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::varchar[]))`,
      [[ownerEmail, outsiderEmail, lockoutEmail]],
    );
    await pool.query(
      `DELETE FROM knowledge_bases
        WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::varchar[]))`,
      [[ownerEmail, outsiderEmail, lockoutEmail]],
    );
    await pool.query('DELETE FROM users WHERE email = ANY($1::varchar[])', [
      [ownerEmail, outsiderEmail, lockoutEmail],
    ]);
    await pool.end();
  });

  it('enforces authentication, ownership, CRUD rules, and refresh-token rotation', async () => {
    const healthResponse = await request(app).get('/health');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.data.database).toBe('connected');

    const unauthorizedResponse = await request(app).post('/api/v1/apps').send({
      name: '未授权应用',
    });
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.body.error.code).toBe('AUTHENTICATION_REQUIRED');

    const unauthorizedOverviewResponse = await request(app).get('/api/v1/overview');
    expect(unauthorizedOverviewResponse.status).toBe(401);

    const shortPasswordRegistration = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `short-${suffix}@example.com`,
        password: 'Password1!',
        displayName: '短密码用户',
      });
    expect(shortPasswordRegistration.status).toBe(400);
    expect(shortPasswordRegistration.body.error.code).toBe('VALIDATION_ERROR');
    expect(shortPasswordRegistration.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'password' }),
      ]),
    );

    const commonPasswordRegistration = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `common-${suffix}@example.com`,
        password: 'Password123!',
        displayName: '常见密码用户',
      });
    expect(commonPasswordRegistration.status).toBe(400);
    expect(commonPasswordRegistration.body.error.code).toBe('VALIDATION_ERROR');

    const personalPasswordRegistration = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `personal-${suffix}@example.com`,
        password: 'Alice!Secure2026',
        displayName: 'Alice',
      });
    expect(personalPasswordRegistration.status).toBe(400);
    expect(personalPasswordRegistration.body.error.code).toBe('VALIDATION_ERROR');

    const ownerRegistration = await request(app).post('/api/v1/auth/register').send({
      email: ownerEmail,
      password,
      displayName: '项目所有者',
    });
    expect(ownerRegistration.status).toBe(201);
    expect(ownerRegistration.body.data.user.roles).toEqual(['member']);
    expect(ownerRegistration.body.data.accessToken).toEqual(expect.any(String));
    expect(ownerRegistration.body.data.refreshToken).toEqual(expect.any(String));

    const ownerAccessToken: string = ownerRegistration.body.data.accessToken;
    const originalRefreshToken: string = ownerRegistration.body.data.refreshToken;

    const sessionlessAccessToken = await createAccessToken({
      userId: ownerRegistration.body.data.user.id,
      roles: ['member'],
    });
    const sessionlessAccess = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${sessionlessAccessToken}`);
    expect(sessionlessAccess.status).toBe(401);
    expect(sessionlessAccess.body.error.code).toBe('INVALID_ACCESS_TOKEN');

    const meResponse = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.email).toBe(ownerEmail);

    const emptyProfileUpdate = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ displayName: '   ' });
    expect(emptyProfileUpdate.status).toBe(400);
    expect(emptyProfileUpdate.body.error.code).toBe('VALIDATION_ERROR');

    const profileUpdate = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ displayName: '项目负责人' });
    expect(profileUpdate.status).toBe(200);
    expect(profileUpdate.body.data).toMatchObject({
      email: ownerEmail,
      displayName: '项目负责人',
      roles: ['member'],
    });

    const meAfterProfileUpdate = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(meAfterProfileUpdate.status).toBe(200);
    expect(meAfterProfileUpdate.body.data.displayName).toBe('项目负责人');

    const duplicateRegistration = await request(app).post('/api/v1/auth/register').send({
      email: ownerEmail.toUpperCase(),
      password,
      displayName: '重复用户',
    });
    expect(duplicateRegistration.status).toBe(409);
    expect(duplicateRegistration.body.error.code).toBe('EMAIL_ALREADY_EXISTS');

    const invalidLogin = await request(app).post('/api/v1/auth/login').send({
      email: ownerEmail,
      password: 'WrongPassword123',
    });
    expect(invalidLogin.status).toBe(401);
    expect(invalidLogin.body.error.code).toBe('INVALID_CREDENTIALS');

    const outsiderRegistration = await request(app).post('/api/v1/auth/register').send({
      email: outsiderEmail,
      password,
      displayName: '其他用户',
    });
    expect(outsiderRegistration.status).toBe(201);
    const outsiderAccessToken: string = outsiderRegistration.body.data.accessToken;

    const lockoutRegistration = await request(app).post('/api/v1/auth/register').send({
      email: lockoutEmail,
      password,
      displayName: '锁定保护测试',
    });
    expect(lockoutRegistration.status).toBe(201);

    const concurrentFailures = await Promise.all(
      Array.from({ length: env.LOGIN_FAILURE_LIMIT }, () => (
        request(app).post('/api/v1/auth/login').send({
          email: lockoutEmail,
          password: 'WrongPassword9!',
        })
      )),
    );
    expect(concurrentFailures.filter((response) => response.status === 401))
      .toHaveLength(env.LOGIN_FAILURE_LIMIT - 1);
    const lockingLogin = concurrentFailures.find((response) => response.status === 423);
    expect(lockingLogin).toBeDefined();
    if (!lockingLogin) throw new Error('Expected one login attempt to lock the account');
    expect(lockingLogin.status).toBe(423);
    expect(lockingLogin.headers['retry-after']).toBe(String(env.LOGIN_LOCKOUT_MINUTES * 60));
    expect(lockingLogin.body.error).toMatchObject({
      code: 'ACCOUNT_TEMPORARILY_LOCKED',
      details: {
        lockedUntil: expect.any(String),
        retryAfterSeconds: env.LOGIN_LOCKOUT_MINUTES * 60,
      },
    });

    const correctPasswordDuringLockout = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: lockoutEmail, password });
    expect(correctPasswordDuringLockout.status).toBe(423);
    expect(correctPasswordDuringLockout.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    expect(correctPasswordDuringLockout.body.data).toBeUndefined();

    const lockedUser = await pool.query<{
      failed_login_attempts: number;
      locked_until: Date | null;
    }>(
      'SELECT failed_login_attempts, locked_until FROM users WHERE email = $1',
      [lockoutEmail],
    );
    expect(lockedUser.rows[0]).toMatchObject({
      failed_login_attempts: env.LOGIN_FAILURE_LIMIT,
      locked_until: expect.any(Date),
    });

    await pool.query(
      `UPDATE users
          SET locked_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
        WHERE email = $1`,
      [lockoutEmail],
    );
    const loginAfterLockout = await request(app).post('/api/v1/auth/login').send({
      email: lockoutEmail,
      password,
    });
    expect(loginAfterLockout.status).toBe(200);

    const protectionSummary = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${loginAfterLockout.body.data.accessToken}`);
    expect(protectionSummary.status).toBe(200);
    expect(protectionSummary.body.data.loginProtection).toEqual({
      status: 'protected',
      failedAttempts: 0,
      failureLimit: env.LOGIN_FAILURE_LIMIT,
      failureWindowMinutes: env.LOGIN_FAILURE_WINDOW_MINUTES,
      lockoutMinutes: env.LOGIN_LOCKOUT_MINUTES,
      lockedUntil: null,
    });

    const lockoutEvents = await request(app)
      .get('/api/v1/auth/security-events?limit=20')
      .set('Authorization', `Bearer ${loginAfterLockout.body.data.accessToken}`);
    expect(lockoutEvents.status).toBe(200);
    expect(lockoutEvents.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'account_locked',
        outcome: 'failure',
        metadata: expect.objectContaining({
          reason: 'too_many_attempts',
          failedAttempts: env.LOGIN_FAILURE_LIMIT,
          remainingAttempts: 0,
        }),
      }),
      expect.objectContaining({
        eventType: 'account_unlocked',
        outcome: 'success',
        metadata: { reason: 'lockout_expired' },
      }),
      expect.objectContaining({
        eventType: 'login_failed',
        outcome: 'failure',
        metadata: expect.objectContaining({ reason: 'account_locked' }),
      }),
    ]));

    const protectedUser = await pool.query<{
      failed_login_attempts: number;
      last_failed_login_at: Date | null;
      locked_until: Date | null;
    }>(
      `SELECT failed_login_attempts, last_failed_login_at, locked_until
         FROM users
        WHERE email = $1`,
      [lockoutEmail],
    );
    expect(protectedUser.rows[0]).toEqual({
      failed_login_attempts: 0,
      last_failed_login_at: null,
      locked_until: null,
    });

    const ownerSecurityEvents = await request(app)
      .get('/api/v1/auth/security-events?limit=10')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(ownerSecurityEvents.status).toBe(200);
    expect(ownerSecurityEvents.body.data.total).toBeGreaterThanOrEqual(3);
    expect(ownerSecurityEvents.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'account_registered',
        outcome: 'success',
      }),
      expect.objectContaining({
        eventType: 'profile_updated',
        outcome: 'success',
      }),
      expect.objectContaining({
        eventType: 'login_failed',
        outcome: 'failure',
        metadata: expect.objectContaining({ reason: 'invalid_credentials' }),
      }),
    ]));
    expect(ownerSecurityEvents.body.data.items[0]).toMatchObject({
      id: expect.any(String),
      deviceName: expect.any(String),
      deviceType: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(ownerSecurityEvents.body)).not.toContain(password);
    expect(JSON.stringify(ownerSecurityEvents.body)).not.toContain(originalRefreshToken);

    const outsiderSecurityEvents = await request(app)
      .get('/api/v1/auth/security-events?limit=10')
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(outsiderSecurityEvents.status).toBe(200);
    expect(outsiderSecurityEvents.body.data.items).toHaveLength(1);
    expect(outsiderSecurityEvents.body.data.items[0].eventType).toBe('account_registered');
    expect(
      ownerSecurityEvents.body.data.items.map((event: { id: string }) => event.id),
    ).not.toContain(outsiderSecurityEvents.body.data.items[0].id);

    const invalidSecurityEventLimit = await request(app)
      .get('/api/v1/auth/security-events?limit=100')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(invalidSecurityEventLimit.status).toBe(400);
    expect(invalidSecurityEventLimit.body.error.code).toBe('VALIDATION_ERROR');

    const createResponse = await request(app)
      .post('/api/v1/apps')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: '企业知识助手',
        description: '面向产品文档的智能问答应用',
        fastgptApiKey,
        status: 'draft',
        settings: { temperature: 0.2 },
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.name).toBe('企业知识助手');
    expect(createResponse.body.data.settings).toEqual({ temperature: 0.2 });
    expect(createResponse.body.data.hasFastgptApiKey).toBe(true);
    expect(JSON.stringify(createResponse.body)).not.toContain(fastgptApiKey);
    expect(createResponse.body.data.attachedKnowledgeBaseCount).toBe(0);
    const appId: string = createResponse.body.data.id;

    const storedCredential = await pool.query<{ fastgpt_api_key_ciphertext: string | null }>(
      'SELECT fastgpt_api_key_ciphertext FROM ai_apps WHERE id = $1',
      [appId],
    );
    expect(storedCredential.rows[0]?.fastgpt_api_key_ciphertext).toMatch(/^v1:/);
    expect(storedCredential.rows[0]?.fastgpt_api_key_ciphertext).not.toContain(fastgptApiKey);

    const duplicateApp = await request(app)
      .post('/api/v1/apps')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '企业知识助手' });
    expect(duplicateApp.status).toBe(409);
    expect(duplicateApp.body.error.code).toBe('APP_NAME_ALREADY_EXISTS');

    const crossUserRead = await request(app)
      .get(`/api/v1/apps/${appId}`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserRead.status).toBe(404);
    expect(crossUserRead.body.error.code).toBe('APP_NOT_FOUND');

    const updateResponse = await request(app)
      .patch(`/api/v1/apps/${appId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: '企业知识助手 Pro',
        status: 'active',
        fastgptAppId: 'fastgpt-demo-app',
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.status).toBe('active');
    expect(updateResponse.body.data.fastgptAppId).toBe('fastgpt-demo-app');
    expect(updateResponse.body.data.hasFastgptApiKey).toBe(true);

    const clearCredentialResponse = await request(app)
      .patch(`/api/v1/apps/${appId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ clearFastgptApiKey: true });
    expect(clearCredentialResponse.status).toBe(200);
    expect(clearCredentialResponse.body.data.hasFastgptApiKey).toBe(false);

    const replaceCredentialResponse = await request(app)
      .patch(`/api/v1/apps/${appId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ fastgptApiKey: 'fastgpt-replacement-secret-2026' });
    expect(replaceCredentialResponse.status).toBe(200);
    expect(replaceCredentialResponse.body.data.hasFastgptApiKey).toBe(true);
    expect(JSON.stringify(replaceCredentialResponse.body)).not.toContain('replacement-secret');

    const createConversationResponse = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ appId, title: '售后咨询记录' });
    expect(createConversationResponse.status).toBe(201);
    expect(createConversationResponse.body.data).toMatchObject({
      appId,
      appName: '企业知识助手 Pro',
      title: '售后咨询记录',
      status: 'active',
      messageCount: 0,
    });
    const conversationId: string = createConversationResponse.body.data.id;

    const userMessageResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ role: 'user', content: '产品可以申请退款吗？' });
    expect(userMessageResponse.status).toBe(201);
    expect(userMessageResponse.body.data.sequenceNo).toBe(1);

    const assistantMessageResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        role: 'assistant',
        content: '符合售后政策时可以申请退款。',
        model: 'fastgpt-test',
        promptTokens: 12,
        completionTokens: 18,
        latencyMs: 320,
      });
    expect(assistantMessageResponse.status).toBe(201);
    expect(assistantMessageResponse.body.data.sequenceNo).toBe(2);

    const conversationDetailResponse = await request(app)
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(conversationDetailResponse.status).toBe(200);
    expect(conversationDetailResponse.body.data.conversation.messageCount).toBe(2);
    expect(conversationDetailResponse.body.data.messages).toHaveLength(2);
    expect(conversationDetailResponse.body.data.messages[1]).toMatchObject({
      role: 'assistant',
      model: 'fastgpt-test',
      completionTokens: 18,
    });

    const conversationSearchResponse = await request(app)
      .get('/api/v1/conversations?search=退款&sort=title_asc')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(conversationSearchResponse.status).toBe(200);
    expect(conversationSearchResponse.body.data.total).toBe(1);
    expect(conversationSearchResponse.body.data.items[0].lastMessagePreview).toContain('退款');

    const conversationStatsResponse = await request(app)
      .get('/api/v1/conversations/stats')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(conversationStatsResponse.status).toBe(200);
    expect(conversationStatsResponse.body.data).toEqual({
      total: 1,
      active: 1,
      archived: 0,
      messages: 2,
    });

    let fastGptRequestUrl = '';
    let fastGptRequestHeaders: Headers | undefined;
    let fastGptRequestBody: Record<string, unknown> | undefined;
    const fastGptFetch = vi.spyOn(globalThis, 'fetch');
    fastGptFetch.mockImplementationOnce(async (url, init) => {
      fastGptRequestUrl = String(url);
      fastGptRequestHeaders = new Headers(init?.headers);
      fastGptRequestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'fastgpt-message-success',
        model: 'fastgpt-test-model',
        choices: [{ message: { content: '退款审核通过后会在三个工作日内原路退回。' } }],
        usage: { prompt_tokens: 24, completion_tokens: 15 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const generatedReplyResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/generate`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ message: '退款审核通过后多久到账？' });
    expect(generatedReplyResponse.status).toBe(201);
    expect(generatedReplyResponse.body.data.userMessage).toMatchObject({
      role: 'user',
      sequenceNo: 3,
      content: '退款审核通过后多久到账？',
    });
    expect(generatedReplyResponse.body.data.assistantMessage).toMatchObject({
      role: 'assistant',
      sequenceNo: 4,
      status: 'completed',
      externalMessageId: 'fastgpt-message-success',
      model: 'fastgpt-test-model',
      promptTokens: 24,
      completionTokens: 15,
    });
    expect(fastGptRequestUrl).toBe('https://api.fastgpt.in/api/v1/chat/completions');
    expect(fastGptRequestHeaders?.get('Authorization')).toBe(
      'Bearer fastgpt-replacement-secret-2026',
    );
    expect(fastGptRequestBody).toMatchObject({
      chatId: conversationId,
      stream: false,
      detail: false,
      temperature: 0.2,
    });
    expect(fastGptRequestBody?.messages).toHaveLength(3);
    expect(JSON.stringify(generatedReplyResponse.body)).not.toContain('replacement-secret');

    fastGptFetch.mockImplementationOnce(async () => new Response('rate limited', { status: 429 }));
    const rateLimitedReplyResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/generate`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ message: '请再试一次' });
    expect(rateLimitedReplyResponse.status).toBe(503);
    expect(rateLimitedReplyResponse.body.error.code).toBe('FASTGPT_RATE_LIMITED');

    const detailAfterGenerationFailure = await request(app)
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(detailAfterGenerationFailure.body.data.messages).toHaveLength(6);
    expect(detailAfterGenerationFailure.body.data.messages[5]).toMatchObject({
      role: 'assistant',
      sequenceNo: 6,
      status: 'failed',
      errorCode: 'FASTGPT_RATE_LIMITED',
    });
    const failedAssistantMessageId: string = detailAfterGenerationFailure.body.data.messages[5].id;

    const crossUserRetryResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/${failedAssistantMessageId}/retry`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserRetryResponse.status).toBe(404);
    expect(crossUserRetryResponse.body.error.code).toBe('CONVERSATION_NOT_FOUND');

    let retryRequestBody: Record<string, unknown> | undefined;
    fastGptFetch.mockImplementationOnce(async (_url, init) => {
      retryRequestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'fastgpt-message-retried',
        model: 'fastgpt-retry-model',
        choices: [{ message: { content: '系统已恢复，请重新查看退款进度。' } }],
        usage: { prompt_tokens: 31, completion_tokens: 12 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const retryReplyResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/${failedAssistantMessageId}/retry`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(retryReplyResponse.status).toBe(200);
    expect(retryReplyResponse.body.data.userMessage).toMatchObject({
      role: 'user',
      sequenceNo: 5,
      content: '请再试一次',
    });
    expect(retryReplyResponse.body.data.assistantMessage).toMatchObject({
      id: failedAssistantMessageId,
      role: 'assistant',
      sequenceNo: 6,
      status: 'completed',
      externalMessageId: 'fastgpt-message-retried',
      model: 'fastgpt-retry-model',
    });
    expect(retryRequestBody?.messages).toHaveLength(5);
    expect(retryReplyResponse.body.data.assistantMessage.metadata).toMatchObject({
      provider: 'fastgpt',
      retryCount: 1,
      previousErrors: [expect.objectContaining({ code: 'FASTGPT_RATE_LIMITED' })],
    });
    expect(JSON.stringify(retryReplyResponse.body)).not.toContain('replacement-secret');
    fastGptFetch.mockRestore();

    const detailAfterRetry = await request(app)
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(detailAfterRetry.body.data.messages).toHaveLength(6);
    expect(detailAfterRetry.body.data.messages[5]).toMatchObject({
      id: failedAssistantMessageId,
      status: 'completed',
      content: '系统已恢复，请重新查看退款进度。',
    });

    const completedRetryResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages/${failedAssistantMessageId}/retry`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(completedRetryResponse.status).toBe(409);
    expect(completedRetryResponse.body.error.code).toBe('MESSAGE_NOT_RETRYABLE');

    const pendingAssistantResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ role: 'assistant', content: '正在处理另一个请求', status: 'pending' });
    expect(pendingAssistantResponse.status).toBe(201);

    const blockedGenerationResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/generate`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ message: '这条消息不应被写入' });
    expect(blockedGenerationResponse.status).toBe(409);
    expect(blockedGenerationResponse.body.error.code).toBe('GENERATION_IN_PROGRESS');

    const duplicatePendingResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ role: 'assistant', content: '重复的生成任务', status: 'pending' });
    expect(duplicatePendingResponse.status).toBe(409);
    expect(duplicatePendingResponse.body.error.code).toBe('GENERATION_IN_PROGRESS');

    const detailAfterBlockedGeneration = await request(app)
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(detailAfterBlockedGeneration.body.data.messages).toHaveLength(7);
    expect(JSON.stringify(detailAfterBlockedGeneration.body)).not.toContain('这条消息不应被写入');
    await pool.query('DELETE FROM messages WHERE id = $1', [pendingAssistantResponse.body.data.id]);
    await pool.query(
      `UPDATE conversations
          SET last_message_at = (
            SELECT max(created_at) FROM messages WHERE conversation_id = $1
          )
        WHERE id = $1`,
      [conversationId],
    );

    const crossUserGenerationResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/generate`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`)
      .send({ message: '不应调用其他用户的应用' });
    expect(crossUserGenerationResponse.status).toBe(404);
    expect(crossUserGenerationResponse.body.error.code).toBe('CONVERSATION_NOT_FOUND');

    const crossUserConversationRead = await request(app)
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserConversationRead.status).toBe(404);
    expect(crossUserConversationRead.body.error.code).toBe('CONVERSATION_NOT_FOUND');

    const listResponse = await request(app)
      .get('/api/v1/apps?status=active&page=1&pageSize=10')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.total).toBe(1);
    expect(listResponse.body.data.items[0].id).toBe(appId);

    const searchResponse = await request(app)
      .get('/api/v1/apps?search=Pro&sort=name_asc')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.data.total).toBe(1);

    const beyondLastPageResponse = await request(app)
      .get('/api/v1/apps?status=active&page=2&pageSize=10')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(beyondLastPageResponse.status).toBe(200);
    expect(beyondLastPageResponse.body.data.total).toBe(1);
    expect(beyondLastPageResponse.body.data.items).toEqual([]);

    const createKnowledgeBaseResponse = await request(app)
      .post('/api/v1/knowledge-bases')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: '产品文档',
        description: '产品说明和售后政策',
        status: 'pending',
      });
    expect(createKnowledgeBaseResponse.status).toBe(201);
    expect(createKnowledgeBaseResponse.body.data.attachedAppCount).toBe(0);
    const knowledgeBaseId: string = createKnowledgeBaseResponse.body.data.id;

    const duplicateKnowledgeBase = await request(app)
      .post('/api/v1/knowledge-bases')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '产品文档' });
    expect(duplicateKnowledgeBase.status).toBe(409);
    expect(duplicateKnowledgeBase.body.error.code).toBe(
      'KNOWLEDGE_BASE_NAME_ALREADY_EXISTS',
    );

    const updateKnowledgeBaseResponse = await request(app)
      .patch(`/api/v1/knowledge-bases/${knowledgeBaseId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        status: 'ready',
        fastgptDatasetId: 'dataset-demo',
      });
    expect(updateKnowledgeBaseResponse.status).toBe(200);
    expect(updateKnowledgeBaseResponse.body.data.status).toBe('ready');

    const createDocumentResponse = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        name: '退款政策.md',
        sourceType: 'url',
        sourceUri: 'https://docs.example.com/refund-policy',
        mimeType: 'text/markdown',
        sizeBytes: 4096,
        status: 'processing',
      });
    expect(createDocumentResponse.status).toBe(201);
    expect(createDocumentResponse.body.data).toMatchObject({
      knowledgeBaseId,
      name: '退款政策.md',
      sourceType: 'url',
      status: 'processing',
      chunkCount: 0,
    });
    const documentId: string = createDocumentResponse.body.data.id;

    const invalidUrlDocumentResponse = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '缺少地址.md', sourceType: 'url' });
    expect(invalidUrlDocumentResponse.status).toBe(400);
    expect(invalidUrlDocumentResponse.body.error.code).toBe('VALIDATION_ERROR');

    const duplicateDocumentResponse = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: '退款政策.md', sourceType: 'file' });
    expect(duplicateDocumentResponse.status).toBe(409);
    expect(duplicateDocumentResponse.body.error.code).toBe('DOCUMENT_NAME_ALREADY_EXISTS');

    const crossUserDocumentList = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserDocumentList.status).toBe(404);
    expect(crossUserDocumentList.body.error.code).toBe('KNOWLEDGE_BASE_NOT_FOUND');

    const updateDocumentResponse = await request(app)
      .patch(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        status: 'ready',
        fastgptCollectionId: 'collection-refund-policy',
      });
    expect(updateDocumentResponse.status).toBe(200);
    expect(updateDocumentResponse.body.data).toMatchObject({
      status: 'ready',
      chunkCount: 0,
      fastgptCollectionId: 'collection-refund-policy',
    });

    const firstChunkResponse = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        content: '符合售后政策的订单，可以在签收后七天内申请退款。',
        tokenCount: 18,
        fastgptDataId: 'data-refund-1',
      });
    expect(firstChunkResponse.status).toBe(201);
    expect(firstChunkResponse.body.data.position).toBe(1);
    const firstChunkId: string = firstChunkResponse.body.data.id;

    const secondChunkResponse = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ content: '退款审核通过后，款项将在三个工作日内原路退回。' });
    expect(secondChunkResponse.status).toBe(201);
    expect(secondChunkResponse.body.data.position).toBe(2);
    const secondChunkId: string = secondChunkResponse.body.data.id;

    const crossUserChunkList = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserChunkList.status).toBe(404);
    expect(crossUserChunkList.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    const chunkSearchResponse = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks?search=工作日`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(chunkSearchResponse.status).toBe(200);
    expect(chunkSearchResponse.body.data.total).toBe(1);
    expect(chunkSearchResponse.body.data.items[0].id).toBe(secondChunkId);

    const updateChunkResponse = await request(app)
      .patch(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks/${firstChunkId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ tokenCount: 20 });
    expect(updateChunkResponse.status).toBe(200);
    expect(updateChunkResponse.body.data.tokenCount).toBe(20);

    const clearRequiredDocumentUrl = await request(app)
      .patch(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ sourceUri: null });
    expect(clearRequiredDocumentUrl.status).toBe(400);
    expect(clearRequiredDocumentUrl.body.error.code).toBe('DOCUMENT_SOURCE_URI_REQUIRED');

    const documentSearchResponse = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents?search=refund&sort=name_asc`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(documentSearchResponse.status).toBe(200);
    expect(documentSearchResponse.body.data.total).toBe(1);

    const documentStatsResponse = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/stats`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(documentStatsResponse.status).toBe(200);
    expect(documentStatsResponse.body.data).toEqual({
      total: 1,
      ready: 1,
      processing: 0,
      pending: 0,
      failed: 0,
      disabled: 0,
      chunks: 2,
      totalBytes: 4096,
    });

    const deleteFirstChunkResponse = await request(app)
      .delete(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks/${firstChunkId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(deleteFirstChunkResponse.status).toBe(204);

    const chunksAfterDelete = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(chunksAfterDelete.status).toBe(200);
    expect(chunksAfterDelete.body.data.total).toBe(1);
    expect(chunksAfterDelete.body.data.items[0]).toMatchObject({
      id: secondChunkId,
      position: 1,
    });

    const documentAfterChunkDelete = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(documentAfterChunkDelete.body.data.items[0].chunkCount).toBe(1);

    const markDocumentFailed = await request(app)
      .patch(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ status: 'failed', errorMessage: '旧的解析错误' });
    expect(markDocumentFailed.status).toBe(200);

    const crossUserContentPreview = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/content/preview`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`)
      .send({ content: '不应读取其他用户的文档内容。' });
    expect(crossUserContentPreview.status).toBe(404);
    expect(crossUserContentPreview.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    const excessiveChunkImport = await request(app)
      .put(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/content`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        content: 'x'.repeat(2201),
        chunkSize: 200,
        chunkOverlap: 199,
      });
    expect(excessiveChunkImport.status).toBe(400);
    expect(excessiveChunkImport.body.error.code).toBe('DOCUMENT_CHUNK_LIMIT_EXCEEDED');

    const chunksAfterRejectedImport = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(chunksAfterRejectedImport.body.data.total).toBe(1);
    expect(chunksAfterRejectedImport.body.data.items[0].id).toBe(secondChunkId);

    const importedContent = [
      '退款申请适用于已完成签收且仍在售后期限内的订单。用户提交申请时，需要填写订单号和退款原因。',
      '客服会核对订单状态、付款记录和商品情况。资料齐全的申请通常会在一个工作日内完成审核。',
      '审核通过后，退款将原路退回。不同支付渠道的到账时间可能不同，最长不超过七个工作日。',
      '如审核未通过，系统会保留失败原因，用户补充材料后可以再次提交申请。',
      '企业客户如需批量处理退款，应联系客户成功经理并提供对应的合同编号。',
    ].join('\n\n');

    const contentPreviewResponse = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/content/preview`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        content: importedContent,
        chunkSize: 200,
        chunkOverlap: 30,
        mimeType: 'text/markdown',
      });
    expect(contentPreviewResponse.status).toBe(200);
    expect(contentPreviewResponse.body.data.chunkCount).toBeGreaterThan(1);
    expect(contentPreviewResponse.body.data.chunks[0]).toMatchObject({ position: 1 });
    expect(contentPreviewResponse.body.data.sizeBytes).toBe(Buffer.byteLength(importedContent, 'utf8'));

    const contentImportResponse = await request(app)
      .put(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/content`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({
        content: importedContent,
        chunkSize: 200,
        chunkOverlap: 30,
        mimeType: 'text/markdown',
      });
    expect(contentImportResponse.status).toBe(200);
    expect(contentImportResponse.body.data.summary).toEqual(contentPreviewResponse.body.data);
    expect(contentImportResponse.body.data.document).toMatchObject({
      status: 'ready',
      errorMessage: null,
      mimeType: 'text/markdown',
      sizeBytes: Buffer.byteLength(importedContent, 'utf8'),
      chunkCount: contentPreviewResponse.body.data.chunkCount,
    });
    expect(contentImportResponse.body.data.document.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const chunksAfterImport = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks?pageSize=100`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(chunksAfterImport.body.data.total).toBe(contentPreviewResponse.body.data.chunkCount);
    expect(chunksAfterImport.body.data.items.map((chunk: { position: number }) => chunk.position))
      .toEqual(Array.from({ length: chunksAfterImport.body.data.total }, (_, index) => index + 1));
    expect(chunksAfterImport.body.data.items.some((chunk: { id: string }) => chunk.id === secondChunkId))
      .toBe(false);
    expect(chunksAfterImport.body.data.items[0].metadata).toMatchObject({
      source: 'content_import',
      chunkSize: 200,
      chunkOverlap: 30,
    });

    const statsAfterContentImport = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/stats`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(statsAfterContentImport.body.data).toMatchObject({
      ready: 1,
      failed: 0,
      chunks: contentPreviewResponse.body.data.chunkCount,
      totalBytes: Buffer.byteLength(importedContent, 'utf8'),
    });

    const exactKnowledgeSearch = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/search`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ query: '原路退回', limit: 5, minScore: 0.15 });
    expect(exactKnowledgeSearch.status).toBe(200);
    expect(exactKnowledgeSearch.body.data).toMatchObject({
      query: '原路退回',
      searchedChunks: contentPreviewResponse.body.data.chunkCount,
    });
    expect(exactKnowledgeSearch.body.data.durationMs).toBeGreaterThanOrEqual(0);
    expect(exactKnowledgeSearch.body.data.items[0]).toMatchObject({
      documentId,
      documentName: '退款政策.md',
      matchType: 'exact',
      score: 1,
    });
    expect(exactKnowledgeSearch.body.data.items[0].content).toContain('原路退回');

    const fuzzyKnowledgeSearch = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/search`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ query: '退款原路返回', limit: 5, minScore: 0.2 });
    expect(fuzzyKnowledgeSearch.status).toBe(200);
    expect(fuzzyKnowledgeSearch.body.data.items[0]).toMatchObject({
      documentId,
      matchType: 'fuzzy',
    });
    expect(fuzzyKnowledgeSearch.body.data.items[0].score).toBeGreaterThanOrEqual(0.2);

    const invalidKnowledgeSearch = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/search`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ query: '   ' });
    expect(invalidKnowledgeSearch.status).toBe(400);
    expect(invalidKnowledgeSearch.body.error.code).toBe('VALIDATION_ERROR');

    const crossUserKnowledgeSearch = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/search`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`)
      .send({ query: '退款' });
    expect(crossUserKnowledgeSearch.status).toBe(404);
    expect(crossUserKnowledgeSearch.body.error.code).toBe('KNOWLEDGE_BASE_NOT_FOUND');

    const disableDocumentResponse = await request(app)
      .delete(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(disableDocumentResponse.status).toBe(204);

    const disabledDocumentList = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents?status=disabled`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(disabledDocumentList.status).toBe(200);
    expect(disabledDocumentList.body.data.total).toBe(1);

    const searchAfterDocumentDisable = await request(app)
      .post(`/api/v1/knowledge-bases/${knowledgeBaseId}/search`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ query: '退款' });
    expect(searchAfterDocumentDisable.status).toBe(200);
    expect(searchAfterDocumentDisable.body.data.searchedChunks).toBe(0);
    expect(searchAfterDocumentDisable.body.data.items).toEqual([]);

    const searchKnowledgeBaseResponse = await request(app)
      .get('/api/v1/knowledge-bases?search=产品&page=1&pageSize=10&sort=name_asc')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(searchKnowledgeBaseResponse.status).toBe(200);
    expect(searchKnowledgeBaseResponse.body.data.total).toBe(1);

    const crossUserKnowledgeBaseRead = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserKnowledgeBaseRead.status).toBe(404);
    expect(crossUserKnowledgeBaseRead.body.error.code).toBe('KNOWLEDGE_BASE_NOT_FOUND');

    const attachResponse = await request(app)
      .put(`/api/v1/apps/${appId}/knowledge-bases/${knowledgeBaseId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(attachResponse.status).toBe(204);

    const attachedKnowledgeBasesResponse = await request(app)
      .get(`/api/v1/apps/${appId}/knowledge-bases`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(attachedKnowledgeBasesResponse.status).toBe(200);
    expect(attachedKnowledgeBasesResponse.body.data).toHaveLength(1);
    expect(attachedKnowledgeBasesResponse.body.data[0].attachedAppCount).toBe(1);

    const linkedAppsResponse = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}/apps`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(linkedAppsResponse.status).toBe(200);
    expect(linkedAppsResponse.body.data).toHaveLength(1);
    expect(linkedAppsResponse.body.data[0].id).toBe(appId);

    const appStatsResponse = await request(app)
      .get('/api/v1/apps/stats')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(appStatsResponse.status).toBe(200);
    expect(appStatsResponse.body.data).toMatchObject({
      total: 1,
      active: 1,
      draft: 0,
      knowledgeBaseBindings: 1,
    });

    const knowledgeBaseStatsResponse = await request(app)
      .get('/api/v1/knowledge-bases/stats')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(knowledgeBaseStatsResponse.status).toBe(200);
    expect(knowledgeBaseStatsResponse.body.data).toMatchObject({
      total: 1,
      ready: 1,
      pending: 0,
      appBindings: 1,
    });

    const overviewResponse = await request(app)
      .get('/api/v1/overview')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.body.data.summary).toEqual({
      apps: 1,
      activeApps: 1,
      knowledgeBases: 1,
      readyKnowledgeBases: 1,
      conversations: 1,
      activeConversations: 1,
      messages: 6,
      bindings: 1,
      boundApps: 1,
      boundKnowledgeBases: 1,
    });
    expect(overviewResponse.body.data.activity).toHaveLength(7);
    expect(
      overviewResponse.body.data.activity.reduce(
        (total: number, item: { messages: number }) => total + item.messages,
        0,
      ),
    ).toBe(6);
    expect(overviewResponse.body.data.recent).toHaveLength(3);
    expect(overviewResponse.body.data.recent.map((item: { type: string }) => item.type))
      .toEqual(expect.arrayContaining(['app', 'knowledge_base', 'conversation']));

    const outsiderOverviewResponse = await request(app)
      .get('/api/v1/overview')
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(outsiderOverviewResponse.status).toBe(200);
    expect(outsiderOverviewResponse.body.data.summary.apps).toBe(0);
    expect(outsiderOverviewResponse.body.data.summary.messages).toBe(0);
    expect(outsiderOverviewResponse.body.data.recent).toEqual([]);

    const crossUserAttachResponse = await request(app)
      .put(`/api/v1/apps/${appId}/knowledge-bases/${knowledgeBaseId}`)
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(crossUserAttachResponse.status).toBe(404);

    const detachResponse = await request(app)
      .delete(`/api/v1/apps/${appId}/knowledge-bases/${knowledgeBaseId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(detachResponse.status).toBe(204);

    const appAfterDetachResponse = await request(app)
      .get(`/api/v1/apps/${appId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(appAfterDetachResponse.body.data.attachedKnowledgeBaseCount).toBe(0);

    const knowledgeBaseAfterDetachResponse = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(knowledgeBaseAfterDetachResponse.body.data.attachedAppCount).toBe(0);

    const archiveConversationResponse = await request(app)
      .delete(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(archiveConversationResponse.status).toBe(204);

    const messageAfterArchiveResponse = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ role: 'user', content: '归档后消息' });
    expect(messageAfterArchiveResponse.status).toBe(409);
    expect(messageAfterArchiveResponse.body.error.code).toBe('CONVERSATION_ARCHIVED');

    const archivedConversationList = await request(app)
      .get('/api/v1/conversations?status=archived')
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(archivedConversationList.status).toBe(200);
    expect(archivedConversationList.body.data.total).toBe(1);

    const disableKnowledgeBaseResponse = await request(app)
      .delete(`/api/v1/knowledge-bases/${knowledgeBaseId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(disableKnowledgeBaseResponse.status).toBe(204);

    const disabledKnowledgeBaseResponse = await request(app)
      .get(`/api/v1/knowledge-bases/${knowledgeBaseId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(disabledKnowledgeBaseResponse.status).toBe(200);
    expect(disabledKnowledgeBaseResponse.body.data.status).toBe('disabled');

    const disableResponse = await request(app)
      .delete(`/api/v1/apps/${appId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(disableResponse.status).toBe(204);

    const disabledAppResponse = await request(app)
      .get(`/api/v1/apps/${appId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(disabledAppResponse.status).toBe(200);
    expect(disabledAppResponse.body.data.status).toBe('disabled');

    const sessionBeforeRotation = await pool.query<{ id: string }>(
      `SELECT rt.id
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE u.email = $1 AND rt.revoked_at IS NULL`,
      [ownerEmail],
    );
    expect(sessionBeforeRotation.rows).toHaveLength(1);

    const refreshResponse = await request(app).post('/api/v1/auth/refresh').send({
      refreshToken: originalRefreshToken,
    });
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.data.refreshToken).not.toBe(originalRefreshToken);
    const rotatedAccessToken: string = refreshResponse.body.data.accessToken;
    const rotatedRefreshToken: string = refreshResponse.body.data.refreshToken;
    const sessionAfterRotation = await pool.query<{ id: string }>(
      `SELECT rt.id
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE u.email = $1 AND rt.revoked_at IS NULL`,
      [ownerEmail],
    );
    expect(sessionAfterRotation.rows).toEqual(sessionBeforeRotation.rows);

    const accessAfterRotation = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotatedAccessToken}`);
    expect(accessAfterRotation.status).toBe(200);

    const replayResponse = await request(app).post('/api/v1/auth/refresh').send({
      refreshToken: originalRefreshToken,
    });
    expect(replayResponse.status).toBe(401);
    expect(replayResponse.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    const logoutResponse = await request(app).post('/api/v1/auth/logout').send({
      refreshToken: rotatedRefreshToken,
    });
    expect(logoutResponse.status).toBe(204);

    const accessAfterLogout = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotatedAccessToken}`);
    expect(accessAfterLogout.status).toBe(401);
    expect(accessAfterLogout.body.error.code).toBe('SESSION_REVOKED');

    const refreshAfterLogout = await request(app).post('/api/v1/auth/refresh').send({
      refreshToken: rotatedRefreshToken,
    });
    expect(refreshAfterLogout.status).toBe(401);

    const firstPasswordChangeSession = await request(app).post('/api/v1/auth/login').send({
      email: ownerEmail,
      password,
    });
    expect(firstPasswordChangeSession.status).toBe(200);
    const passwordChangeAccessToken: string =
      firstPasswordChangeSession.body.data.accessToken;
    const firstPasswordChangeRefreshToken: string =
      firstPasswordChangeSession.body.data.refreshToken;

    const secondPasswordChangeSession = await request(app).post('/api/v1/auth/login').send({
      email: ownerEmail,
      password,
    });
    expect(secondPasswordChangeSession.status).toBe(200);
    const secondPasswordChangeRefreshToken: string =
      secondPasswordChangeSession.body.data.refreshToken;

    const wrongCurrentPassword = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${passwordChangeAccessToken}`)
      .send({ currentPassword: 'WrongPassword9!', newPassword: 'Quasar!Maple7Bridge' });
    expect(wrongCurrentPassword.status).toBe(400);
    expect(wrongCurrentPassword.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');

    const weakNewPassword = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${passwordChangeAccessToken}`)
      .send({ currentPassword: password, newPassword: 'Password123!' });
    expect(weakNewPassword.status).toBe(400);
    expect(weakNewPassword.body.error.code).toBe('PASSWORD_POLICY_VIOLATION');

    const unchangedPassword = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${passwordChangeAccessToken}`)
      .send({ currentPassword: password, newPassword: password });
    expect(unchangedPassword.status).toBe(400);
    expect(unchangedPassword.body.error.code).toBe('PASSWORD_UNCHANGED');

    const newPassword = 'Quasar!Maple7Bridge';
    const passwordChange = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${passwordChangeAccessToken}`)
      .send({ currentPassword: password, newPassword });
    expect(passwordChange.status).toBe(204);

    const accessAfterPasswordChange = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${passwordChangeAccessToken}`);
    expect(accessAfterPasswordChange.status).toBe(401);
    expect(accessAfterPasswordChange.body.error.code).toBe('SESSION_REVOKED');

    for (const refreshToken of [
      firstPasswordChangeRefreshToken,
      secondPasswordChangeRefreshToken,
    ]) {
      const revokedSession = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });
      expect(revokedSession.status).toBe(401);
      expect(revokedSession.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    }

    const oldPasswordLogin = await request(app).post('/api/v1/auth/login').send({
      email: ownerEmail,
      password,
    });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36')
      .send({
        email: ownerEmail,
        password: newPassword,
      });
    expect(newPasswordLogin.status).toBe(200);
    const firstSessionAccessToken: string = newPasswordLogin.body.data.accessToken;
    const firstSessionRefreshToken: string = newPasswordLogin.body.data.refreshToken;

    const additionalSessionLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')
      .send({
        email: ownerEmail,
        password: newPassword,
      });
    expect(additionalSessionLogin.status).toBe(200);
    const additionalSessionAccessToken: string =
      additionalSessionLogin.body.data.accessToken;
    const additionalSessionRefreshToken: string =
      additionalSessionLogin.body.data.refreshToken;

    const sessionSummary = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${firstSessionAccessToken}`);
    expect(sessionSummary.status).toBe(200);
    expect(sessionSummary.body.data.activeSessions).toBe(2);
    expect(sessionSummary.body.data.lastLoginAt).toEqual(expect.any(String));
    expect(sessionSummary.body.data.items).toHaveLength(2);
    expect(sessionSummary.body.data.items[0]).toMatchObject({
      current: true,
      deviceName: 'Google Chrome · Windows',
      deviceType: 'desktop',
      ipAddress: expect.any(String),
      lastUsedAt: expect.any(String),
      expiresAt: expect.any(String),
      createdAt: expect.any(String),
    });
    const additionalSession = sessionSummary.body.data.items.find(
      (session: { current: boolean }) => !session.current,
    );
    expect(additionalSession).toMatchObject({
      deviceName: 'Safari · iOS',
      deviceType: 'mobile',
    });

    const staleActivityAt = new Date(Date.now() - 5 * 60_000);
    await pool.query(
      'UPDATE refresh_tokens SET last_used_at = $2 WHERE id = $1',
      [sessionSummary.body.data.items[0].id, staleActivityAt],
    );
    const requestAfterActivityStale = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${firstSessionAccessToken}`);
    expect(requestAfterActivityStale.status).toBe(200);
    const touchedActivity = await pool.query<{ last_used_at: Date }>(
      'SELECT last_used_at FROM refresh_tokens WHERE id = $1',
      [sessionSummary.body.data.items[0].id],
    );
    expect(touchedActivity.rows[0]!.last_used_at.getTime())
      .toBeGreaterThan(staleActivityAt.getTime());

    const outsiderSessionResult = await pool.query<{ id: string }>(
      `SELECT rt.id
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE u.email = $1 AND rt.revoked_at IS NULL
        ORDER BY rt.created_at DESC
        LIMIT 1`,
      [outsiderEmail],
    );
    const crossUserSessionRevoke = await request(app)
      .delete(`/api/v1/auth/sessions/${outsiderSessionResult.rows[0]!.id}`)
      .set('Authorization', `Bearer ${firstSessionAccessToken}`);
    expect(crossUserSessionRevoke.status).toBe(404);
    expect(crossUserSessionRevoke.body.error.code).toBe('SESSION_NOT_FOUND');

    const revokeAdditionalSession = await request(app)
      .delete(`/api/v1/auth/sessions/${additionalSession.id}`)
      .set('Authorization', `Bearer ${firstSessionAccessToken}`);
    expect(revokeAdditionalSession.status).toBe(200);
    expect(revokeAdditionalSession.body.data).toEqual({
      revokedSession: true,
      currentSession: false,
    });

    const accessAfterSingleSessionRevoke = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${additionalSessionAccessToken}`);
    expect(accessAfterSingleSessionRevoke.status).toBe(401);
    expect(accessAfterSingleSessionRevoke.body.error.code).toBe('SESSION_REVOKED');

    const eventsAfterSessionRevoke = await request(app)
      .get('/api/v1/auth/security-events?limit=20')
      .set('Authorization', `Bearer ${firstSessionAccessToken}`);
    expect(eventsAfterSessionRevoke.status).toBe(200);
    expect(eventsAfterSessionRevoke.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'session_revoked',
        outcome: 'success',
        actorSessionId: sessionSummary.body.data.items[0].id,
        targetSessionId: additionalSession.id,
        metadata: { currentSession: false },
      }),
      expect.objectContaining({
        eventType: 'login_succeeded',
        outcome: 'success',
      }),
    ]));

    const refreshAfterSingleSessionRevoke = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: additionalSessionRefreshToken });
    expect(refreshAfterSingleSessionRevoke.status).toBe(401);

    const revokeSessions = await request(app)
      .delete('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${firstSessionAccessToken}`);
    expect(revokeSessions.status).toBe(200);
    expect(revokeSessions.body.data.revokedSessions).toBe(1);

    const accessAfterAllSessionRevoke = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${firstSessionAccessToken}`);
    expect(accessAfterAllSessionRevoke.status).toBe(401);
    expect(accessAfterAllSessionRevoke.body.error.code).toBe('SESSION_REVOKED');

    const securityEventViewerLogin = await request(app).post('/api/v1/auth/login').send({
      email: ownerEmail,
      password: newPassword,
    });
    expect(securityEventViewerLogin.status).toBe(200);

    const eventsAfterAllSessionRevoke = await request(app)
      .get('/api/v1/auth/security-events?limit=20')
      .set('Authorization', `Bearer ${securityEventViewerLogin.body.data.accessToken}`);
    expect(eventsAfterAllSessionRevoke.status).toBe(200);
    expect(eventsAfterAllSessionRevoke.body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'all_sessions_revoked',
        outcome: 'success',
        metadata: { revokedSessions: 1 },
      }),
    ]));

    const refreshAfterSessionRevoke = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstSessionRefreshToken });
    expect(refreshAfterSessionRevoke.status).toBe(401);

    await pool.query("UPDATE users SET status = 'disabled' WHERE email = $1", [outsiderEmail]);
    const disabledUserAccess = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${outsiderAccessToken}`);
    expect(disabledUserAccess.status).toBe(403);
    expect(disabledUserAccess.body.error.code).toBe('USER_DISABLED');
  });
});
