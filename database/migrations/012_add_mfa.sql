ALTER TABLE users
    ADD COLUMN mfa_secret_ciphertext TEXT,
    ADD COLUMN mfa_enabled_at TIMESTAMPTZ,
    ADD CONSTRAINT users_mfa_state_check CHECK (
        (mfa_secret_ciphertext IS NULL AND mfa_enabled_at IS NULL)
        OR (mfa_secret_ciphertext IS NOT NULL AND mfa_enabled_at IS NOT NULL)
    );

CREATE TABLE mfa_setup_challenges (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_ciphertext TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > created_at)
);

CREATE INDEX mfa_setup_challenges_expiry_idx
    ON mfa_setup_challenges (expires_at);

CREATE TABLE mfa_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash CHAR(64) NOT NULL
        CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, code_hash),
    CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX mfa_recovery_codes_available_user_idx
    ON mfa_recovery_codes (user_id, created_at DESC)
    WHERE used_at IS NULL;

CREATE TABLE mfa_login_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    attempt_count SMALLINT NOT NULL DEFAULT 0
        CHECK (attempt_count BETWEEN 0 AND 5),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > created_at),
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX mfa_login_challenges_active_token_idx
    ON mfa_login_challenges (token_hash, expires_at)
    WHERE consumed_at IS NULL;

CREATE INDEX mfa_login_challenges_user_idx
    ON mfa_login_challenges (user_id, created_at DESC);

ALTER TABLE security_events
    DROP CONSTRAINT security_events_event_type_check,
    ADD CONSTRAINT security_events_event_type_check
        CHECK (event_type IN (
            'account_registered',
            'login_succeeded',
            'login_failed',
            'account_locked',
            'account_unlocked',
            'profile_updated',
            'password_changed',
            'password_reset_requested',
            'password_reset_completed',
            'refresh_token_reused',
            'session_revoked',
            'all_sessions_revoked',
            'logout',
            'mfa_setup_started',
            'mfa_enabled',
            'mfa_disabled',
            'mfa_recovery_codes_regenerated',
            'mfa_login_failed'
        ));
