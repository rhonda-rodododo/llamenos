CREATE TABLE user_signal_contacts (
  user_pubkey TEXT PRIMARY KEY,
  identifier_hash TEXT NOT NULL,
  identifier_ciphertext TEXT NOT NULL,
  identifier_envelope JSONB NOT NULL DEFAULT '[]',
  identifier_type TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_signal_contacts_identifier_hash_idx ON user_signal_contacts (identifier_hash);
