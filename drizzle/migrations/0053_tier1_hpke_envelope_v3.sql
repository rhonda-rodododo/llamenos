-- Tier 1 PR-A — HPKE envelope v3 wire-format break.
--
-- Tier 1 replaces the ECIES + XChaCha20-Poly1305 wire format (envelope v2)
-- with HPKE/AES-GCM (RFC 9180, envelope v3). The on-disk ciphertexts from
-- the old format cannot be decrypted by the new primitives: KEM, KDF and
-- AEAD are all different, AAD binding format is different, and the envelope
-- JSON shape is different (`{ v:3, labelId, enc, ct }` vs. `{ v:2, ... }`).
--
-- Llámenos is pre-production. There is no "data migration" path — we wipe.
-- The safe blast radius is every row that holds any ciphertext column, plus
-- anything that FK-depends on those rows. Instead of enumerating the 17
-- schema files and ~35 encrypted columns, we TRUNCATE the two apex tables
-- of the data model (`hubs` and `users`) with CASCADE. Every piece of
-- hub-scoped or user-scoped data then goes with them:
--
--   * hubs CASCADE → roles, custom_field_definitions, telephony_config,
--     messaging_config, spam_settings, call_settings, transcription_settings,
--     ivr_languages, fallback_group, report_categories, retention_settings,
--     geocoding_config, provider_config, signal_registration_pending,
--     setup_state, captcha_state, ring_groups, shift_overrides, blasts,
--     blast_settings, file_records, note_replies, hub_storage_credentials,
--     signed_audit_entries (Tier 0), oauth_state, rate_limit_counters,
--     user_sessions (hub-scoped), and anything else FK'd to hubs.
--
--   * users CASCADE → webauthn_credentials, webauthn_challenges, invite_codes,
--     provision_rooms, webauthn_settings, user_security_prefs, user_sessions,
--     auth_events, signal_contacts, push_subscriptions, gdpr_consents,
--     gdpr_erasure_requests, and anything else FK'd to users.
--
-- This is a one-way knife — after this runs, the only way back is a fresh
-- bootstrap (create admin, create hub, re-enroll volunteers). Acceptable
-- because we ship HPKE BEFORE any production data exists, not after.
--
-- Operational safety rail:
--   We refuse to run if either `hubs` or `users` contains more than 1000
--   rows. That catches the "somebody pointed this at a real environment"
--   failure mode. Pre-prod demo DBs are always far under this limit. If
--   an operator genuinely needs to wipe a larger dev DB, they can bump the
--   literal by hand — the decision shouldn't be implicit.

DO $$
DECLARE
  hub_count INTEGER;
  user_count INTEGER;
BEGIN
  SELECT count(*) INTO hub_count FROM hubs;
  SELECT count(*) INTO user_count FROM users;
  IF hub_count > 1000 OR user_count > 1000 THEN
    RAISE EXCEPTION
      'migration 0053 refuses to wipe: hubs=% users=% — both must be <= 1000. '
      'This migration is a pre-production HPKE wire-format break and is not '
      'safe to run against a populated database.',
      hub_count, user_count;
  END IF;
END $$;

TRUNCATE TABLE hubs RESTART IDENTITY CASCADE;
TRUNCATE TABLE users RESTART IDENTITY CASCADE;
