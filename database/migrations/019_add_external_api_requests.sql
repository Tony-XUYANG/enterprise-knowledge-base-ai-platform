ALTER TABLE app_access_keys
    ADD CONSTRAINT app_access_keys_id_app_owner_unique
    UNIQUE (id, app_id, owner_id);

ALTER TABLE conversations
    ADD CONSTRAINT conversations_id_app_user_unique
    UNIQUE (id, app_id, user_id);

CREATE TABLE external_api_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    access_key_id UUID,
    access_key_name VARCHAR(80) NOT NULL
        CHECK (length(btrim(access_key_name)) BETWEEN 1 AND 80),
    access_key_prefix VARCHAR(15) NOT NULL
        CHECK (access_key_prefix ~ '^kh_app_[A-Za-z0-9_-]{8}$'),
    conversation_id UUID,
    endpoint VARCHAR(120) NOT NULL,
    outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('success', 'failure')),
    http_status SMALLINT NOT NULL CHECK (http_status BETWEEN 100 AND 599),
    error_code VARCHAR(100),
    latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
    prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
    completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
    client_ip VARCHAR(64),
    user_agent VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT external_api_requests_app_owner_fk
        FOREIGN KEY (app_id, owner_id)
        REFERENCES ai_apps(id, owner_id)
        ON DELETE CASCADE,
    CONSTRAINT external_api_requests_access_key_fk
        FOREIGN KEY (access_key_id, app_id, owner_id)
        REFERENCES app_access_keys(id, app_id, owner_id)
        ON DELETE SET NULL (access_key_id),
    CONSTRAINT external_api_requests_conversation_fk
        FOREIGN KEY (conversation_id, app_id, owner_id)
        REFERENCES conversations(id, app_id, user_id)
        ON DELETE SET NULL (conversation_id),
    CONSTRAINT external_api_requests_error_check
        CHECK (
            (outcome = 'success' AND error_code IS NULL)
            OR (outcome = 'failure' AND error_code IS NOT NULL)
        )
);

CREATE INDEX external_api_requests_app_recent_idx
    ON external_api_requests (app_id, created_at DESC, id DESC);

CREATE INDEX external_api_requests_key_recent_idx
    ON external_api_requests (access_key_id, created_at DESC)
    WHERE access_key_id IS NOT NULL;

CREATE INDEX external_api_requests_app_failure_idx
    ON external_api_requests (app_id, created_at DESC)
    WHERE outcome = 'failure';
