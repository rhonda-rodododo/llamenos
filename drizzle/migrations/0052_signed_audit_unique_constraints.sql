-- Tier 0 post-review hardening — UNIQUE constraints on signed_audit_entries.
--
-- Two bugs the chain verifier cannot catch by itself:
--
--   1. Two entries can race to claim the same prev_entry_hash (fork).
--      Without a UNIQUE(hub_id, prev_entry_hash) the service's
--      `getHead()`-then-insert pattern is a lost-update: two concurrent
--      appenders read the same head, compute valid entries, and both
--      succeed — producing two "current" heads in the same hub.
--
--   2. entry_hash collisions (accidental OR adversarial) silently overwrite
--      chain links. A global UNIQUE(entry_hash) is cheap at our scale and
--      turns any duplicate into a clean DB-level insert failure that the
--      route layer translates into an AuditChainError.
--
-- The NULL prev_entry_hash (chain genesis) still participates: PostgreSQL
-- treats NULL values in UNIQUE constraints as distinct, but we want AT
-- MOST ONE genesis entry per hub. We handle that with a partial unique
-- index on (hub_id) WHERE prev_entry_hash IS NULL.

ALTER TABLE signed_audit_entries
  ADD CONSTRAINT signed_audit_entries_hub_prev_hash_unique
  UNIQUE (hub_id, prev_entry_hash);

ALTER TABLE signed_audit_entries
  ADD CONSTRAINT signed_audit_entries_entry_hash_unique
  UNIQUE (entry_hash);

CREATE UNIQUE INDEX signed_audit_entries_hub_genesis_unique
  ON signed_audit_entries (hub_id)
  WHERE prev_entry_hash IS NULL;
