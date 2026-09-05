CREATE TABLE app_access_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    name VARCHAR(80) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    key_prefix VARCHAR(15) NOT NULL
        CHECK (key_prefix ~ '^kh_app_[A-Za-z0-9_-]{8}$'),
    secret_hash CHAR(64) NOT NULL UNIQUE
        CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT app_access_keys_app_owner_fk
        FOREIGN KEY (app_id, owner_id)
        REFERENCES ai_apps(id, owner_id)
        ON DELETE CASCADE,
    CONSTRAINT app_access_keys_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT app_access_keys_revocation_check
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX app_access_keys_active_name_unique_idx
    ON app_access_keys (app_id, lower(name))
    WHERE revoked_at IS NULL;

CREATE INDEX app_access_keys_app_recent_idx
    ON app_access_keys (app_id, created_at DESC, id DESC);
