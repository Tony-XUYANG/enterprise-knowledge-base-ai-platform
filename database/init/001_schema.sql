BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL,
    password_hash TEXT NOT NULL CHECK (length(password_hash) >= 20),
    display_name VARCHAR(80) NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_email_normalized_check
        CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1)
);

CREATE UNIQUE INDEX users_email_unique_idx ON users (lower(email));

CREATE TABLE roles (
    id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE
        CHECK (code ~ '^[a-z][a-z0-9_]*$'),
    name VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_id_idx ON user_roles (role_id);

CREATE TABLE ai_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    description TEXT,
    fastgpt_app_id VARCHAR(120),
    fastgpt_api_key_ciphertext TEXT,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(settings) = 'object'),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_id, name),
    UNIQUE (id, owner_id)
);

CREATE INDEX ai_apps_owner_status_idx ON ai_apps (owner_id, status);

CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    description TEXT,
    fastgpt_dataset_id VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ready', 'failed', 'disabled')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_id, name),
    UNIQUE (id, owner_id)
);

CREATE INDEX knowledge_bases_owner_status_idx
    ON knowledge_bases (owner_id, status);

CREATE TABLE app_knowledge_bases (
    app_id UUID NOT NULL,
    knowledge_base_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    attached_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (app_id, knowledge_base_id),
    CONSTRAINT app_knowledge_bases_app_owner_fk
        FOREIGN KEY (app_id, owner_id)
        REFERENCES ai_apps(id, owner_id)
        ON DELETE CASCADE,
    CONSTRAINT app_knowledge_bases_kb_owner_fk
        FOREIGN KEY (knowledge_base_id, owner_id)
        REFERENCES knowledge_bases(id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX app_knowledge_bases_kb_id_idx
    ON app_knowledge_bases (knowledge_base_id);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES ai_apps(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title VARCHAR(200) NOT NULL DEFAULT '新对话'
        CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX conversations_user_recent_idx
    ON conversations (user_id, updated_at DESC);

CREATE INDEX conversations_app_recent_idx
    ON conversations (app_id, updated_at DESC);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
    role VARCHAR(20) NOT NULL
        CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL CHECK (length(content) > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed')),
    external_message_id VARCHAR(160),
    model VARCHAR(100),
    prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
    completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
    latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
    error_code VARCHAR(100),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (conversation_id, sequence_no)
);

CREATE INDEX messages_conversation_created_idx
    ON messages (conversation_id, created_at);

CREATE UNIQUE INDEX messages_external_id_unique_idx
    ON messages (external_message_id)
    WHERE external_message_id IS NOT NULL;

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX refresh_tokens_active_user_idx
    ON refresh_tokens (user_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER ai_apps_set_updated_at
BEFORE UPDATE ON ai_apps
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER knowledge_bases_set_updated_at
BEFORE UPDATE ON knowledge_bases
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER conversations_set_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
