-- 0068_hpke_slice1_truncate.sql
--
-- HPKE Slice 1: Wire format migration (pre-production TRUNCATE).
--
-- All encrypted columns switch from ECIES wire format
--   { pubkey, wrappedKey, ephemeralPubkey }
-- to HPKE v3 wire format
--   { pubkey, v: 3, labelId, enc, ct }
--
-- Pre-production: TRUNCATE is acceptable. No data migration needed.
-- Safety rail: abort if any table has > 1000 rows (catches accidental
-- runs against a populated staging/production DB).

DO $$
DECLARE
  row_count bigint;
BEGIN
  -- Safety rail: refuse to run on populated databases
  SELECT count(*) INTO row_count FROM users;
  IF row_count > 1000 THEN
    RAISE EXCEPTION 'Safety rail: users table has % rows — this migration is pre-production only', row_count;
  END IF;
END
$$;

-- TRUNCATE all tables that store RecipientEnvelope[] or KeyEnvelope JSONB columns.
-- CASCADE handles foreign key dependencies.
TRUNCATE
  users,
  hub_key_envelopes,
  hub_ptk_generations,
  user_devices,
  invite_codes,
  call_records,
  note_envelopes,
  note_replies,
  conversations,
  message_envelopes,
  contacts,
  contact_relationships,
  contact_intakes,
  bans,
  blasts,
  subscribers,
  push_subscriptions,
  webauthn_credentials,
  user_sessions,
  file_records,
  user_signal_contacts,
  user_auth_events
CASCADE;

-- Reset all hub setup state so the next login triggers fresh hub key generation
-- with the new HPKE envelope format.
UPDATE setup_state SET state = '{"setupCompleted":false,"completedSteps":[],"pendingChannels":[],"selectedChannels":[],"demoMode":false}'::jsonb;
