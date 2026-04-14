-- Tier 2 PR-A — OPAQUE server state + root-KEK envelope storage.
--
-- Three tables land together because they form a single Tier 2 unit:
--
--   opaque_server_setup
--     One row per OPAQUE purpose ('root-kek' | 'recovery-phrase' |
--     'recovery-group'). Each row holds the RFC 9807 ServerSetup blob the
--     vendored `llamenos-opaque-wrapper` WASM produces. Rotation is a
--     deliberate admin operation and invalidates all existing password
--     files for that purpose.
--
--   user_opaque_records
--     Per-(user, purpose) OPAQUE password file produced by a successful
--     registration flow. It is NOT a password hash — it is the wire
--     artifact the server hands back to `serverStartLogin` during a later
--     login. The server never sees the user's password or export key.
--     Composite primary key permits a user to hold one record per purpose
--     simultaneously (PRF primary, OPAQUE fallback, recovery phrase,
--     recovery group all coexist).
--
--   user_root_kek_envelopes
--     The server's mirror of the Tier 2 IndexedDB bundle. Each envelope is
--     an `{ factorType, factorId, hkdfSalt, wrappedKey, createdAt }` shape
--     and the server cannot unwrap any of them — HKDF salts and AES-KW
--     wrapped bytes are opaque. Persisting the bundle here means a device
--     that loses local IDB can restore its root-KEK factor set from the
--     authenticated API if the user still remembers at least one factor.
--
-- All three tables are read-only from the server's perspective modulo
-- explicit writes by the Tier 2 OPAQUE routes and the root-KEK envelope
-- endpoint — there are no triggers or derived columns.

CREATE TABLE "opaque_server_setup" (
  "purpose" text PRIMARY KEY NOT NULL,
  "setup" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "user_opaque_records" (
  "user_pubkey" text NOT NULL,
  "purpose" text NOT NULL,
  "credential_identifier" text NOT NULL,
  "password_file" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_opaque_records_user_pubkey_purpose_pk" PRIMARY KEY("user_pubkey","purpose")
);

CREATE INDEX "user_opaque_records_user_idx" ON "user_opaque_records" ("user_pubkey");

CREATE TABLE "user_root_kek_envelopes" (
  "user_pubkey" text PRIMARY KEY NOT NULL,
  "root_key_id" text NOT NULL,
  "version" integer DEFAULT 3 NOT NULL,
  "bundle" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "user_root_kek_envelopes_root_key_idx" ON "user_root_kek_envelopes" ("root_key_id");
