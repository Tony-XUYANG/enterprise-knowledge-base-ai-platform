CREATE TABLE member_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member'
        CHECK (role IN ('admin', 'member')),
    token_hash CHAR(64) NOT NULL UNIQUE
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    send_count SMALLINT NOT NULL DEFAULT 1 CHECK (send_count BETWEEN 1 AND 20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT member_invitations_email_normalized_check
        CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
    CHECK (expires_at > created_at),
    CHECK (delivered_at IS NULL OR delivered_at >= created_at),
    CHECK (accepted_at IS NULL OR accepted_at >= created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX member_invitations_active_email_idx
    ON member_invitations (email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX member_invitations_recent_idx
    ON member_invitations (created_at DESC, id DESC);

CREATE INDEX member_invitations_expiry_idx
    ON member_invitations (expires_at)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TRIGGER member_invitations_set_updated_at
BEFORE UPDATE ON member_invitations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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
            'email_verified',
            'user_role_changed',
            'user_status_changed',
            'member_invitation_sent',
            'member_invitation_revoked',
            'member_invitation_accepted'
        ));
