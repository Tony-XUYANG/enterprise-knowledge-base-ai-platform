CREATE TABLE refresh_token_history (
    token_hash CHAR(64) PRIMARY KEY
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    session_id UUID NOT NULL REFERENCES refresh_tokens(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    rotated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > rotated_at)
);

CREATE INDEX refresh_token_history_session_idx
    ON refresh_token_history (session_id, rotated_at DESC);

CREATE INDEX refresh_token_history_expiry_idx
    ON refresh_token_history (expires_at);

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
            'refresh_token_reused',
            'session_revoked',
            'all_sessions_revoked',
            'logout'
        ));
