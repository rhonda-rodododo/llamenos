CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_pubkey TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  credential_id TEXT,
  encrypted_meta TEXT NOT NULL,
  meta_envelope JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX user_sessions_user_pubkey_idx ON user_sessions (user_pubkey);
CREATE INDEX user_sessions_token_hash_idx ON user_sessions (token_hash);
CREATE INDEX user_sessions_expires_at_idx ON user_sessions (expires_at);
