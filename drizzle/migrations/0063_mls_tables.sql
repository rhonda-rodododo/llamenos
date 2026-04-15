-- Tier 6 MLS PR #2 Slice 1 — MLS group state, key packages, epoch commits.
-- Three new tables for server-side MLS protocol state management.
-- Brainstorm: docs/security/H4_MLS_PR2_BRAINSTORM.md §9

-- mls_hub_state: one row per hub, tracks current MLS epoch + group metadata.
CREATE TABLE IF NOT EXISTS "mls_hub_state" (
  "hub_id" text PRIMARY KEY NOT NULL REFERENCES "hubs"("id") ON DELETE CASCADE,
  "group_id" bytea NOT NULL,
  "ciphersuite" smallint NOT NULL DEFAULT 1,
  "current_epoch" bigint NOT NULL DEFAULT 0,
  "last_commit_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- mls_key_packages: outstanding MLS KeyPackages per device, consumed when adding members.
CREATE TABLE IF NOT EXISTS "mls_key_packages" (
  "id" text PRIMARY KEY NOT NULL,
  "device_id" text NOT NULL REFERENCES "user_devices"("device_id") ON DELETE CASCADE,
  "hub_id" text NOT NULL REFERENCES "hubs"("id") ON DELETE CASCADE,
  "key_package_ref" bytea NOT NULL,
  "key_package_data" bytea NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "consumed_at" timestamp with time zone,
  CONSTRAINT "mls_key_packages_device_hub_ref_uniq" UNIQUE("device_id", "hub_id", "key_package_ref")
);

CREATE INDEX IF NOT EXISTS "mls_key_packages_hub_consumed_idx"
  ON "mls_key_packages" ("hub_id", "consumed_at");

-- mls_epoch_commits: each MLS Commit persisted per epoch for client catch-up.
-- UNIQUE(hub_id, epoch) is the optimistic-locking mechanism for concurrent commits.
CREATE TABLE IF NOT EXISTS "mls_epoch_commits" (
  "id" text PRIMARY KEY NOT NULL,
  "hub_id" text NOT NULL REFERENCES "hubs"("id") ON DELETE CASCADE,
  "epoch" bigint NOT NULL,
  "committer_device_id" text NOT NULL REFERENCES "user_devices"("device_id"),
  "commit_data" bytea NOT NULL,
  "welcome_data" bytea,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "mls_epoch_commits_hub_epoch_uniq" UNIQUE("hub_id", "epoch")
);

CREATE INDEX IF NOT EXISTS "mls_epoch_commits_hub_epoch_idx"
  ON "mls_epoch_commits" ("hub_id", "epoch");
