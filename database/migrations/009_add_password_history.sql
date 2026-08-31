CREATE TABLE user_password_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL CHECK (length(password_hash) >= 20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX user_password_history_recent_idx
    ON user_password_history (user_id, created_at DESC, id DESC);

INSERT INTO user_password_history (user_id, password_hash, created_at)
SELECT id, password_hash, updated_at
  FROM users;
