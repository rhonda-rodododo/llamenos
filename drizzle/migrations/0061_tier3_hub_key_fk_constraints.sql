-- Tier 3 P1 — harden hub-key schema FKs.
--
-- Three related FK constraints missing from 0056_tier3_per_device_keys.sql:
--
--   1. hub_ptk_generations.hub_id → hubs.id ON DELETE CASCADE
--      PTK generation rows must always point at a live hub. Without this
--      constraint a hub tear-down leaves orphan key-rotation metadata in
--      the DB, which confuses downstream rotation/enumeration logic.
--
--   2. hub_key_envelopes.hub_id → hubs.id ON DELETE CASCADE
--      Every wrapped hub-key envelope must point at a live hub. Cascading
--      hub deletion sweeps the envelopes atomically so we never leave
--      wrapped key material associated with a non-existent hub.
--
--   3. hub_key_envelopes.device_id → user_devices.device_id ON DELETE CASCADE
--      Every envelope must point at a live device. When a device row is
--      hard-deleted (re-enrollment / debug wipe) its wrapped hub-key copies
--      must disappear with it. Device revocation (`user_devices.revoked_at`)
--      is a soft-delete and leaves the device row in place, so it is not
--      affected by this cascade.
--
-- All three statements are guarded by pg_catalog lookups so re-running the
-- migration is a no-op. NEVER edit this file in place — add a new repair
-- migration if this one proves inadequate.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hub_ptk_generations_hub_id_fk'
  ) THEN
    ALTER TABLE "hub_ptk_generations"
      ADD CONSTRAINT "hub_ptk_generations_hub_id_fk"
      FOREIGN KEY ("hub_id") REFERENCES "hubs"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hub_key_envelopes_hub_id_fk'
  ) THEN
    ALTER TABLE "hub_key_envelopes"
      ADD CONSTRAINT "hub_key_envelopes_hub_id_fk"
      FOREIGN KEY ("hub_id") REFERENCES "hubs"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hub_key_envelopes_device_id_fk'
  ) THEN
    ALTER TABLE "hub_key_envelopes"
      ADD CONSTRAINT "hub_key_envelopes_device_id_fk"
      FOREIGN KEY ("device_id") REFERENCES "user_devices"("device_id")
      ON DELETE CASCADE;
  END IF;
END $$;
