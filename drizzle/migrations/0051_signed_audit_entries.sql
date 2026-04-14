-- Tier 0 WS 0.2 Task 20 — create the signed audit chain table.
--
-- This is a NEW table alongside the legacy `audit_log` (activity log).
-- Scope compromise #8 in PR #68: the Tier 0 plan originally called for
-- replacing `audit_log` in-place, but ~80 call sites across routes, jobs,
-- and services write to the legacy table via RecordsService.addAuditEntry.
-- Migrating all call sites was out of scope for Tier 0, so signed entries
-- live in their own table and Tier 3+ can consolidate if desired.
--
-- The entries are cryptographically signed by the signer's identity key
-- (schnorr) and chained via SHA-256 of the canonicalized entry fields.
-- See src/shared/schemas/audit-entries.ts for the payload discriminated
-- union and src/server/services/audit-log-service.ts for verification.

CREATE TABLE signed_audit_entries (
  id TEXT PRIMARY KEY,
  hub_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  prev_entry_hash TEXT,
  entry_hash TEXT NOT NULL,
  signer_device_id TEXT NOT NULL,
  signer_pubkey TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX signed_audit_entries_hub_type_created_idx
  ON signed_audit_entries (hub_id, type, created_at);
CREATE INDEX signed_audit_entries_hub_signer_idx
  ON signed_audit_entries (hub_id, signer_pubkey);
