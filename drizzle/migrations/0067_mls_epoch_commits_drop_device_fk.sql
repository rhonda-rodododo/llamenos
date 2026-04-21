-- Drop the foreign key on mls_epoch_commits.committer_device_id → user_devices.device_id.
--
-- The FK is too strict for MLS epoch commits: if a device is revoked and
-- hard-deleted, we still need the commit history for epoch catch-up. The
-- column stays NOT NULL text — it records which device committed — but
-- referential integrity is not enforced so commits survive device lifecycle.
--
-- Idempotent: drops whichever constraint name exists (raw-SQL vs Drizzle naming).

DO $$
BEGIN
  -- Name from raw SQL migration 0063 (Postgres default naming)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mls_epoch_commits_committer_device_id_fkey'
      AND table_name = 'mls_epoch_commits'
  ) THEN
    ALTER TABLE "mls_epoch_commits"
      DROP CONSTRAINT "mls_epoch_commits_committer_device_id_fkey";
  END IF;

  -- Name if Drizzle auto-generated the constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mls_epoch_commits_committer_device_id_user_devices_device_id_fk'
      AND table_name = 'mls_epoch_commits'
  ) THEN
    ALTER TABLE "mls_epoch_commits"
      DROP CONSTRAINT "mls_epoch_commits_committer_device_id_user_devices_device_id_fk";
  END IF;
END
$$;
