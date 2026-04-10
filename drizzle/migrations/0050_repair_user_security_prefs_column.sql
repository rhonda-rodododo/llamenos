-- Repair schema drift introduced by PR #46 (b98fcfa9 "fix: decrypt recovery +
-- unified auto-lock timer"), which edited 0048_user_security_prefs.sql in-place
-- to rename lock_delay_ms -> auto_lock_ms (and change the default from 30000 to
-- 900000). Dev DBs that applied the original 0048 still carry the old column.
-- Fresh/CI DBs already have the post-rename shape from the edited 0048, so this
-- migration is a no-op for them.
--
-- Why a new migration instead of re-editing 0048? Fresh/CI DBs already migrated
-- past 0048 and drizzle's journal tracks the applied hash — re-editing 0048
-- would either be a silent no-op (hash already recorded) or cause a mismatch.
-- A new migration is the only way to heal drifted dev DBs without diverging
-- from CI.
--
-- Uses current_schema() rather than hardcoding 'public' so this migration is
-- exercisable in an isolated test schema (see the companion .integration.test.ts).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'user_security_prefs'
      AND column_name = 'lock_delay_ms'
  ) THEN
    ALTER TABLE user_security_prefs RENAME COLUMN lock_delay_ms TO auto_lock_ms;
    ALTER TABLE user_security_prefs ALTER COLUMN auto_lock_ms SET DEFAULT 900000;
  END IF;
END $$;
