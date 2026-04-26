-- HPKE Slice 7: XChaCha20-Poly1305 → AES-256-GCM wire format change
--
-- All ciphertext columns change from hex(nonce[24] || XChaCha20-Poly1305 ct)
-- to hex(nonce[12] || AES-256-GCM ct+tag). Pre-production — no data to
-- migrate, TRUNCATE all tables with ciphertext columns.
--
-- This is idempotent: running on an already-truncated database is a no-op.

BEGIN;

-- Safety rail: abort if users table has significant data (production guard).
DO $$
DECLARE
  row_count bigint;
BEGIN
  SELECT count(*) INTO row_count FROM users;
  IF row_count > 1000 THEN
    RAISE EXCEPTION 'Safety rail: users table has % rows — this migration is pre-production only', row_count;
  END IF;
END
$$;

-- Truncate all tables containing ciphertext columns.
-- CASCADE handles FK references between these tables.
TRUNCATE TABLE
  active_calls,
  audit_log,
  blast_settings,
  call_legs,
  call_notes,
  call_records,
  contacts,
  conversations,
  custom_field_definitions,
  custom_field_values,
  custom_roles,
  device_keys,
  geocoding_config,
  hub_key_generations,
  hub_members,
  hubs,
  invites,
  ivr_config,
  messages,
  messaging_config,
  provider_config,
  push_subscriptions,
  report_types,
  shifts,
  signal_registration_pending,
  subscribers,
  tags,
  teams,
  user_sessions,
  users,
  voicemails
CASCADE;

COMMIT;
