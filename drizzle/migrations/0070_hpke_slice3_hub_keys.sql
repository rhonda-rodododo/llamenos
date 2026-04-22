-- 0069_hpke_slice3_hub_keys.sql
--
-- HPKE Slice 3: Migrate hub_keys table from ECIES columns
--   (encrypted_key, ephemeral_pubkey)
-- to a single HPKE envelope JSON column.
--
-- Pre-production: TRUNCATE is acceptable. No data migration needed.

DO $$
DECLARE
  row_count bigint;
BEGIN
  -- Safety rail: refuse to run on populated databases
  SELECT count(*) INTO row_count FROM users;
  IF row_count > 1000 THEN
    RAISE EXCEPTION 'Safety rail: users table has % rows — this migration is pre-production only', row_count;
  END IF;
END
$$;

-- TRUNCATE hub_keys and dependent data so we can change the schema
TRUNCATE hub_keys CASCADE;

-- Drop old ECIES-specific columns
ALTER TABLE hub_keys DROP COLUMN IF EXISTS encrypted_key;
ALTER TABLE hub_keys DROP COLUMN IF EXISTS ephemeral_pubkey;

-- Add new envelope column (stores HPKE envelope JSON)
ALTER TABLE hub_keys ADD COLUMN envelope text NOT NULL DEFAULT '{}';

-- Remove the default after adding the column
ALTER TABLE hub_keys ALTER COLUMN envelope DROP DEFAULT;

-- Reset hub setup state so fresh hub key generation uses the new schema
UPDATE hubs SET setup_state = '{"setupCompleted":false,"completedSteps":[],"pendingChannels":[],"selectedChannels":[],"demoMode":false}'::jsonb;
