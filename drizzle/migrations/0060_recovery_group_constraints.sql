-- Tier 2 P0 — harden recovery-group schema.
--
-- Two related constraints, both missing from 0059_tier2_recovery_group.sql:
--
--   1. hub_recovery_groups.threshold <= total_shares
--      A group cannot require more shares to recover than it issued. Without
--      this, a mis-submitted enroll payload (or malicious admin) could brick
--      the Recovery Group by making the threshold unreachable.
--
--   2. hub_recovery_group_shares.hub_id → hub_recovery_groups(hub_id)
--      ON DELETE CASCADE
--      Shares must always point at a live group row, and deleting a group
--      must sweep its shares atomically (otherwise a rotation/teardown leaves
--      orphan ciphertext in the DB).
--
-- Both statements are guarded by pg_catalog lookups so re-running the
-- migration is a no-op. NEVER edit this file in place — add a new repair
-- migration if this one proves inadequate.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hub_recovery_groups_threshold_total_shares_check'
  ) THEN
    ALTER TABLE "hub_recovery_groups"
      ADD CONSTRAINT "hub_recovery_groups_threshold_total_shares_check"
      CHECK ("threshold" <= "total_shares");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hub_recovery_group_shares_hub_id_fk'
  ) THEN
    ALTER TABLE "hub_recovery_group_shares"
      ADD CONSTRAINT "hub_recovery_group_shares_hub_id_fk"
      FOREIGN KEY ("hub_id") REFERENCES "hub_recovery_groups"("hub_id")
      ON DELETE CASCADE;
  END IF;
END $$;
