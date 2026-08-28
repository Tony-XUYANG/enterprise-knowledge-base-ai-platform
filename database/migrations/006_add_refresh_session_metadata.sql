ALTER TABLE refresh_tokens
    ADD COLUMN user_agent VARCHAR(512),
    ADD COLUMN ip_address INET,
    ADD COLUMN last_used_at TIMESTAMPTZ;

UPDATE refresh_tokens
   SET last_used_at = created_at
 WHERE last_used_at IS NULL;

ALTER TABLE refresh_tokens
    ALTER COLUMN last_used_at SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN last_used_at SET NOT NULL;

CREATE INDEX refresh_tokens_user_last_used_idx
    ON refresh_tokens (user_id, last_used_at DESC)
    WHERE revoked_at IS NULL;
