-- Tier 2 PR-C — Recovery Group tables for Shamir-based admin-assisted recovery.
--
-- hub_recovery_groups
--   Per-hub Recovery Group configuration: secp256k1 group public key,
--   Shamir threshold (2..5) and total shares (3..5), plus SHA-256
--   commitments for each share (tamper detection during recovery).
--
-- hub_recovery_group_shares
--   Per-admin HPKE-wrapped Shamir share envelopes. The server stores
--   ciphertext only — it cannot reconstruct the group private key.
--
-- user_recovery_envelopes
--   Per-(user, hub) envelope wrapping the user's root KEK under the
--   hub's Recovery Group public key. Enables admin-assisted recovery.
--
-- recovery_sessions
--   Transient recovery ceremony state: contributions, threshold readiness,
--   24h delay enforcement, optional emergency override.

CREATE TABLE "hub_recovery_groups" (
  "hub_id" uuid PRIMARY KEY NOT NULL,
  "group_public_key" text NOT NULL,
  "threshold" integer NOT NULL CHECK ("threshold" >= 2 AND "threshold" <= 5),
  "total_shares" integer NOT NULL CHECK ("total_shares" >= 3 AND "total_shares" <= 5),
  "share_commitments" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rotated_at" timestamp with time zone
);

CREATE TABLE "hub_recovery_group_shares" (
  "hub_id" uuid NOT NULL,
  "admin_pubkey" text NOT NULL,
  "share_envelope" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "hub_recovery_group_shares_hub_id_admin_pubkey_pk" PRIMARY KEY("hub_id", "admin_pubkey")
);

CREATE INDEX "hub_recovery_group_shares_hub_idx" ON "hub_recovery_group_shares" ("hub_id");

CREATE TABLE "user_recovery_envelopes" (
  "user_pubkey" text NOT NULL,
  "hub_id" uuid NOT NULL,
  "envelope" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_recovery_envelopes_user_pubkey_hub_id_pk" PRIMARY KEY("user_pubkey", "hub_id")
);

CREATE INDEX "user_recovery_envelopes_hub_idx" ON "user_recovery_envelopes" ("hub_id");

CREATE TABLE "recovery_sessions" (
  "session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "hub_id" uuid NOT NULL,
  "user_pubkey" text NOT NULL,
  "coordinator_pubkey" text NOT NULL,
  "new_device_pubkey" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'ready', 'completed', 'expired', 'cancelled')),
  "contributions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "emergency_override" jsonb
);

CREATE INDEX "recovery_sessions_hub_idx" ON "recovery_sessions" ("hub_id");
CREATE INDEX "recovery_sessions_user_idx" ON "recovery_sessions" ("user_pubkey");
CREATE INDEX "recovery_sessions_status_idx" ON "recovery_sessions" ("status");
