-- Phase-2 P0 (Tier 3) — recovery-participant deduplication.
--
-- `recovery_requests.participants_count` was an unbounded counter with no
-- per-user uniqueness, so one compromised admin could call addParticipant
-- N times and meet the Shamir threshold alone. A junction table with a
-- composite primary key on (recovery_request_id, participant_user_id)
-- makes duplicate contributions impossible at the DB level; the service
-- layer then derives `participants_count` from the junction's row count.
--
-- Guarded by pg_catalog lookups so re-running is a no-op. Never edit this
-- file in place — write a new repair migration if this one proves
-- inadequate.

CREATE TABLE IF NOT EXISTS "recovery_participants" (
  "recovery_request_id" uuid NOT NULL,
  "participant_user_id" text NOT NULL,
  "share_payload" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recovery_participants_pk"
    PRIMARY KEY ("recovery_request_id", "participant_user_id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recovery_participants_request_id_fk'
  ) THEN
    ALTER TABLE "recovery_participants"
      ADD CONSTRAINT "recovery_participants_request_id_fk"
      FOREIGN KEY ("recovery_request_id") REFERENCES "recovery_requests"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "recovery_participants_request_idx"
  ON "recovery_participants" ("recovery_request_id");
