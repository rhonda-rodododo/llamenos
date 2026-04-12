-- Tier 1 PR-B — items_key indirection columns.
--
-- The items_key pattern (Standard Notes 004) wraps every per-artifact
-- symmetric key (per-note, per-file, per-message) under a single per-user
-- items_key. When Tier 6 rotates primitives (classical → PQ) the only
-- per-user work is re-wrapping a 40-byte blob — no artifact ciphertext
-- is rewritten, because AES-KW wrap is byte-equivalent.
--
-- Both columns are NULL until a client materialises its items_key via
-- `generateItemsKey(master, 1)`. On first unlock after PR-B merge, the
-- key store persists the wrapped blob + version counter. PR-B itself
-- does NOT migrate notes to use items_key yet (see plan Task 16) — it
-- only reserves the schema surface so subsequent PRs have somewhere to
-- write without requiring another migration.
--
-- Contract:
--   items_key_version: monotonic integer, starts at 1. NULL = never materialised.
--   items_key_wrapped: base64 of the 40-byte AES-KW ciphertext. NULL = never materialised.
--
-- Server treats both columns as opaque: read-back and write-through only.
-- The wrap is done entirely client-side; the server cannot unwrap.

ALTER TABLE users
  ADD COLUMN items_key_version INTEGER,
  ADD COLUMN items_key_wrapped TEXT;
