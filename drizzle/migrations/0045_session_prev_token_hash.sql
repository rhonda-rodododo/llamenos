ALTER TABLE user_sessions ADD COLUMN prev_token_hash TEXT;
CREATE INDEX user_sessions_prev_token_hash_idx ON user_sessions (prev_token_hash);
