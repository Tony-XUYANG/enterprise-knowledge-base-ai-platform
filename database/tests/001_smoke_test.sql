\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    owner_id UUID;
    visitor_id UUID;
    app_id UUID;
    access_key_id UUID;
    owner_kb_id UUID;
    visitor_kb_id UUID;
    test_conversation_id UUID;
    external_conversation_id UUID;
    idempotency_id UUID;
    rejected BOOLEAN;
BEGIN
    INSERT INTO users (email, password_hash, display_name)
    VALUES ('owner@example.com', repeat('a', 60), '项目所有者')
    RETURNING id INTO owner_id;

    INSERT INTO users (email, password_hash, display_name)
    VALUES ('visitor@example.com', repeat('b', 60), '访问者')
    RETURNING id INTO visitor_id;

    INSERT INTO user_roles (user_id, role_id)
    SELECT owner_id, id FROM roles WHERE code = 'admin';

    INSERT INTO ai_apps (owner_id, name, status)
    VALUES (owner_id, '企业知识助手', 'active')
    RETURNING id INTO app_id;

    INSERT INTO app_access_keys (
        app_id, owner_id, name, key_prefix, secret_hash, expires_at
    ) VALUES (
        app_id, owner_id, '生产接入', 'kh_app_abcdefgh', repeat('c', 64),
        CURRENT_TIMESTAMP + INTERVAL '90 days'
    ) RETURNING id INTO access_key_id;

    rejected := FALSE;
    BEGIN
        INSERT INTO app_access_keys (
            app_id, owner_id, name, key_prefix, secret_hash, expires_at
        ) VALUES (
            app_id, visitor_id, '越权接入', 'kh_app_ijklmnop', repeat('d', 64),
            CURRENT_TIMESTAMP + INTERVAL '90 days'
        );
    EXCEPTION WHEN foreign_key_violation THEN
        rejected := TRUE;
    END;
    ASSERT rejected, '访问密钥所有者必须与应用所有者一致';

    INSERT INTO knowledge_bases (owner_id, name, status)
    VALUES (owner_id, '产品文档', 'ready')
    RETURNING id INTO owner_kb_id;

    INSERT INTO knowledge_bases (owner_id, name, status)
    VALUES (visitor_id, '其他人的知识库', 'ready')
    RETURNING id INTO visitor_kb_id;

    INSERT INTO app_knowledge_bases (app_id, knowledge_base_id, owner_id)
    VALUES (app_id, owner_kb_id, owner_id);

    rejected := FALSE;
    BEGIN
        INSERT INTO app_knowledge_bases (app_id, knowledge_base_id, owner_id)
        VALUES (app_id, visitor_kb_id, owner_id);
    EXCEPTION WHEN foreign_key_violation THEN
        rejected := TRUE;
    END;
    ASSERT rejected, '不同所有者的知识库不应绑定到应用';

    INSERT INTO conversations (app_id, user_id, title)
    VALUES (app_id, visitor_id, '产品如何退款？')
    RETURNING id INTO test_conversation_id;

    INSERT INTO messages (conversation_id, sequence_no, role, content)
    VALUES
        (test_conversation_id, 1, 'user', '产品如何退款？'),
        (test_conversation_id, 2, 'assistant', '请在订单详情页提交退款申请。');

    rejected := FALSE;
    BEGIN
        INSERT INTO messages (conversation_id, sequence_no, role, content)
        VALUES (test_conversation_id, 2, 'assistant', '重复序号');
    EXCEPTION WHEN unique_violation THEN
        rejected := TRUE;
    END;
    ASSERT rejected, '同一会话内不应出现重复消息序号';

    ASSERT (SELECT count(*) FROM messages WHERE messages.conversation_id = test_conversation_id) = 2,
        '会话应包含两条消息';

    INSERT INTO conversations (app_id, user_id, title)
    VALUES (app_id, owner_id, '外部 API 对话')
    RETURNING id INTO external_conversation_id;

    INSERT INTO external_api_requests (
        app_id, owner_id, access_key_id, access_key_name, access_key_prefix,
        conversation_id, endpoint, outcome, http_status, latency_ms,
        prompt_tokens, completion_tokens, client_ip
    ) VALUES (
        app_id, owner_id, access_key_id, '生产接入', 'kh_app_abcdefgh',
        external_conversation_id, '/api/v1/external/chat', 'success', 201, 320,
        120, 35, '127.0.0.1'
    );

    rejected := FALSE;
    BEGIN
        INSERT INTO external_api_requests (
            app_id, owner_id, access_key_id, access_key_name, access_key_prefix,
            endpoint, outcome, http_status, latency_ms
        ) VALUES (
            app_id, visitor_id, access_key_id, '越权接入', 'kh_app_abcdefgh',
            '/api/v1/external/chat', 'success', 201, 10
        );
    EXCEPTION WHEN foreign_key_violation THEN
        rejected := TRUE;
    END;
    ASSERT rejected, '调用日志必须继承应用和访问密钥所有权';

    ASSERT (
        SELECT prompt_tokens + completion_tokens
          FROM external_api_requests
         WHERE conversation_id = external_conversation_id
    ) = 155, '调用日志应保留 Token 指标';

    INSERT INTO external_chat_idempotencies (
        app_id, owner_id, access_key_id, idempotency_key_hash, request_hash, status
    ) VALUES (
        app_id, owner_id, access_key_id, repeat('e', 64), repeat('f', 64), 'pending'
    ) RETURNING id INTO idempotency_id;

    rejected := FALSE;
    BEGIN
        INSERT INTO external_chat_idempotencies (
            app_id, owner_id, access_key_id, idempotency_key_hash, request_hash, status
        ) VALUES (
            app_id, visitor_id, access_key_id, repeat('d', 64), repeat('c', 64), 'pending'
        );
    EXCEPTION WHEN foreign_key_violation THEN
        rejected := TRUE;
    END;
    ASSERT rejected, '幂等记录必须继承应用和访问密钥所有权';

    UPDATE external_chat_idempotencies
       SET status = 'succeeded',
           response_status = 201,
           conversation_id = test_conversation_id,
           conversation_created = FALSE,
           user_message_id = (SELECT id FROM messages WHERE conversation_id = test_conversation_id AND sequence_no = 1),
           assistant_message_id = (SELECT id FROM messages WHERE conversation_id = test_conversation_id AND sequence_no = 2)
     WHERE id = idempotency_id;

    ASSERT (SELECT status FROM external_chat_idempotencies WHERE id = idempotency_id) = 'succeeded',
        '幂等成功状态应能保存完整消息引用';

    RAISE NOTICE '数据库冒烟测试通过：关系、外键、唯一约束均正常。';
END;
$$;

ROLLBACK;
