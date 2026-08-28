CREATE TABLE security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL
        CHECK (event_type IN (
            'account_registered',
            'login_succeeded',
            'login_failed',
            'profile_updated',
            'password_changed',
            'session_revoked',
            'all_sessions_revoked',
            'logout'
        )),
    outcome VARCHAR(20) NOT NULL
        CHECK (outcome IN ('success', 'failure')),
    actor_session_id UUID,
    target_session_id UUID,
    user_agent VARCHAR(512),
    ip_address INET,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX security_events_user_recent_idx
    ON security_events (user_id, created_at DESC, id DESC);
