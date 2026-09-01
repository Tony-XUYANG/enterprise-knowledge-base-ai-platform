ALTER TABLE users
    ADD COLUMN email_verified_at TIMESTAMPTZ;

UPDATE users
   SET email_verified_at = CURRENT_TIMESTAMP
 WHERE email_verified_at IS NULL;

CREATE TABLE email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    requested_ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (expires_at > created_at),
    CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX email_verification_tokens_active_user_idx
    ON email_verification_tokens (user_id, expires_at DESC)
    WHERE used_at IS NULL;

CREATE INDEX email_verification_tokens_expiry_idx
    ON email_verification_tokens (expires_at);

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
            'mfa_login_failed',
            'email_verification_requested',
            'email_verified'
        ));
