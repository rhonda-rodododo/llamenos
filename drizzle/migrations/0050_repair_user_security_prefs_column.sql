-- Repair schema drift introduced by PR #46 (b98fcfa9 "fix: decrypt recovery +
-- unified auto-lock timer"), which edited 0048_user_security_prefs.sql in-place
-- to rename lock_delay_ms -> auto_lock_ms (and change the default from 30000 to
-- 900000). Dev DBs that applied the original 0048 still carry the old column.
-- Fresh/CI DBs already have the post-rename shape from the edited 0048, so this
-- migration is a no-op for them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_security_prefs'
      AND column_name = 'lock_delay_ms'
  ) THEN
    ALTER TABLE user_security_prefs RENAME COLUMN lock_delay_ms TO auto_lock_ms;
    ALTER TABLE user_security_prefs ALTER COLUMN auto_lock_ms SET DEFAULT 900000;
  END IF;
END $$;
