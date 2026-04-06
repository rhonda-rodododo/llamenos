CREATE TABLE user_security_prefs (
  user_pubkey TEXT PRIMARY KEY,
  lock_delay_ms INTEGER NOT NULL DEFAULT 30000,
  disappearing_timer_days INTEGER NOT NULL DEFAULT 1,
  digest_cadence TEXT NOT NULL DEFAULT 'weekly',
  alert_on_new_device BOOLEAN NOT NULL DEFAULT TRUE,
  alert_on_passkey_change BOOLEAN NOT NULL DEFAULT TRUE,
  alert_on_pin_change BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
