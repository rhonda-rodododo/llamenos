-- Migration: Add MLS columns to message_envelopes for Slice 6 messages cutover
-- Adds mls_ciphertext, mls_epoch, and server_encrypted_body to support
-- the server-encrypt-then-client-claim pattern for inbound messages.

ALTER TABLE "message_envelopes"
  ADD COLUMN IF NOT EXISTS "mls_ciphertext" text,
  ADD COLUMN IF NOT EXISTS "mls_epoch" integer,
  ADD COLUMN IF NOT EXISTS "server_encrypted_body" text;
