-- Upgrade MLS ciphersuite default from 1 (AES-128-GCM) to 7 (AES-256-GCM)
-- to match the AES-256 security level used by all other crypto in this system.
-- Pre-production: no existing data to migrate.
ALTER TABLE "mls_hub_state" ALTER COLUMN "ciphersuite" SET DEFAULT 7;
