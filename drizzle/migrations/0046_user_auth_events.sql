CREATE TABLE user_auth_events (
  id TEXT PRIMARY KEY,
  user_pubkey TEXT NOT NULL,
  event_type TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  payload_envelope JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reported_suspicious_at TIMESTAMPTZ
);

CREATE INDEX user_auth_events_user_created_idx ON user_auth_events (user_pubkey, created_at);
CREATE INDEX user_auth_events_created_at_idx ON user_auth_events (created_at);
