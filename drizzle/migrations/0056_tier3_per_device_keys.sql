-- Tier 3: Per-device keys, PUK envelopes, hub PTK generations, enrollment sessions
-- Pre-production safety interlock: block if any user has a legacy encrypted_secret_key
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE encrypted_secret_key <> '') THEN
    RAISE EXCEPTION 'Tier 3 migration blocked: users with encrypted_secret_key exist.';
  END IF;
END $$;

-- 1. user_devices
CREATE TABLE IF NOT EXISTS "user_devices" (
  "device_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "signing_pubkey" text NOT NULL,
  "encryption_pubkey" text NOT NULL,
  "encrypted_display_name" text NOT NULL,
  "added_by_device_id" text,
  "added_sigchain_entry_id" text NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by_sigchain_entry_id" text,
  "revoked_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_devices_signing_pubkey_unique"
  ON "user_devices" ("signing_pubkey");

CREATE UNIQUE INDEX IF NOT EXISTS "user_devices_encryption_pubkey_unique"
  ON "user_devices" ("encryption_pubkey");

CREATE INDEX IF NOT EXISTS "user_devices_user_id_revoked_at_idx"
  ON "user_devices" ("user_id", "revoked_at");

-- 2. user_puk_envelopes
CREATE TABLE IF NOT EXISTS "user_puk_envelopes" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "device_id" text NOT NULL,
  "generation" integer NOT NULL,
  "envelope" text NOT NULL,
  "sigchain_entry_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_puk_envelopes_user_device_gen_unique"
  ON "user_puk_envelopes" ("user_id", "device_id", "generation");

CREATE INDEX IF NOT EXISTS "user_puk_envelopes_user_gen_idx"
  ON "user_puk_envelopes" ("user_id", "generation");

-- 3. hub_ptk_generations
CREATE TABLE IF NOT EXISTS "hub_ptk_generations" (
  "id" text PRIMARY KEY NOT NULL,
  "hub_id" text NOT NULL,
  "generation" integer NOT NULL,
  "old_gen_wrapped_under_new" text,
  "rotated_by_sigchain_entry_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "hub_ptk_generations_hub_gen_unique"
  ON "hub_ptk_generations" ("hub_id", "generation");

-- 4. hub_key_envelopes
CREATE TABLE IF NOT EXISTS "hub_key_envelopes" (
  "id" text PRIMARY KEY NOT NULL,
  "hub_id" text NOT NULL,
  "generation" integer NOT NULL,
  "device_id" text NOT NULL,
  "user_id" text NOT NULL,
  "envelope" text NOT NULL,
  "sigchain_entry_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "hub_key_envelopes_hub_gen_device_unique"
  ON "hub_key_envelopes" ("hub_id", "generation", "device_id");

CREATE INDEX IF NOT EXISTS "hub_key_envelopes_device_hub_gen_idx"
  ON "hub_key_envelopes" ("device_id", "hub_id", "generation" DESC);

-- 5. device_enrollment_sessions
CREATE TABLE IF NOT EXISTS "device_enrollment_sessions" (
  "session_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "primary_device_id" text NOT NULL,
  "candidate_signing_pubkey" text NOT NULL,
  "candidate_encryption_pubkey" text NOT NULL,
  "enrollment_nonce" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "device_enrollment_sessions_user_id_idx"
  ON "device_enrollment_sessions" ("user_id");

-- 6. user_master_wraps
CREATE TABLE IF NOT EXISTS "user_master_wraps" (
  "user_id" text PRIMARY KEY NOT NULL,
  "master_seed_under_puk_secretbox" text NOT NULL,
  "master_seed_under_recovery_group" text,
  "puk_seed_under_recovery_group" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
