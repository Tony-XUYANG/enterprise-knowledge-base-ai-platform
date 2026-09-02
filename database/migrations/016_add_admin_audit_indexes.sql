CREATE INDEX security_events_recent_idx
    ON security_events (created_at DESC, id DESC);

CREATE INDEX security_events_type_recent_idx
    ON security_events (event_type, created_at DESC, id DESC);

CREATE INDEX security_events_failure_recent_idx
    ON security_events (created_at DESC, id DESC)
    WHERE outcome = 'failure';
