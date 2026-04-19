-- Slice 5: Notes path cutover to MLS group encryption.
-- Replaces per-note ECIES envelope columns with MLS ciphertext columns.
-- Old envelope columns become nullable; pre-upgrade notes show as unreadable.

ALTER TABLE "note_envelopes"
  ADD COLUMN IF NOT EXISTS "mls_ciphertext" bytea,
  ADD COLUMN IF NOT EXISTS "mls_epoch" integer;

-- Make old ECIES envelope columns nullable so existing rows don't fail.
-- We do NOT drop them yet — Slice 10 will clean up dead columns.
ALTER TABLE "note_envelopes"
  ALTER COLUMN "encrypted_content" DROP NOT NULL,
  ALTER COLUMN "author_envelope" DROP NOT NULL,
  ALTER COLUMN "admin_envelopes" DROP NOT NULL;

-- Same pattern for note_replies (Epic 123 placeholder).
ALTER TABLE "note_replies"
  ADD COLUMN IF NOT EXISTS "mls_ciphertext" bytea,
  ADD COLUMN IF NOT EXISTS "mls_epoch" integer;

ALTER TABLE "note_replies"
  ALTER COLUMN "encrypted_content" DROP NOT NULL,
  ALTER COLUMN "author_envelope" DROP NOT NULL,
  ALTER COLUMN "admin_envelopes" DROP NOT NULL;
