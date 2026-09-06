CREATE TABLE external_chat_idempotencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    access_key_id UUID NOT NULL,
    idempotency_key_hash CHAR(64) NOT NULL
        CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    request_hash CHAR(64) NOT NULL
        CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    response_status SMALLINT,
    error_code VARCHAR(100),
    error_message VARCHAR(240),
    conversation_id UUID,
    conversation_created BOOLEAN,
    user_message_id UUID,
    assistant_message_id UUID,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT external_chat_idempotencies_app_owner_fk
        FOREIGN KEY (app_id, owner_id)
        REFERENCES ai_apps(id, owner_id)
        ON DELETE CASCADE,
    CONSTRAINT external_chat_idempotencies_access_key_fk
        FOREIGN KEY (access_key_id, app_id, owner_id)
        REFERENCES app_access_keys(id, app_id, owner_id)
        ON DELETE CASCADE,
    CONSTRAINT external_chat_idempotencies_state_check
        CHECK (
            (status = 'pending'
                AND response_status IS NULL
                AND error_code IS NULL
                AND error_message IS NULL)
            OR (status = 'succeeded'
                AND response_status = 201
                AND error_code IS NULL
                AND error_message IS NULL
                AND conversation_id IS NOT NULL
                AND conversation_created IS NOT NULL
                AND user_message_id IS NOT NULL
                AND assistant_message_id IS NOT NULL)
            OR (status = 'failed'
                AND response_status BETWEEN 400 AND 599
                AND error_code IS NOT NULL
                AND error_message IS NOT NULL)
        )
);

CREATE UNIQUE INDEX external_chat_idempotencies_key_unique_idx
    ON external_chat_idempotencies (app_id, access_key_id, idempotency_key_hash);

CREATE INDEX external_chat_idempotencies_pending_idx
    ON external_chat_idempotencies (updated_at)
    WHERE status = 'pending';

CREATE TRIGGER external_chat_idempotencies_set_updated_at
BEFORE UPDATE ON external_chat_idempotencies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
