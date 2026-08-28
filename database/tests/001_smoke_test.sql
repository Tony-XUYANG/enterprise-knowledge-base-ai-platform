\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    owner_id UUID;
    visitor_id UUID;
    app_id UUID;
    owner_kb_id UUID;
    visitor_kb_id UUID;
    test_conversation_id UUID;
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

    RAISE NOTICE '数据库冒烟测试通过：关系、外键、唯一约束均正常。';
END;
$$;

ROLLBACK;
