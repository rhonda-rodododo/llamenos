-- Tier 5 — voice call E2EE policy column on call_settings.
--
-- Hub-level policy governing WebRTC voice calls with SFrame E2EE:
--   'required'  — refuse calls that cannot establish SFrame
--   'preferred' — default; show active-consent modal if SFrame unavailable
--   'off'       — never attempt E2EE (legacy plaintext SRTP only)
--
-- The column is non-NULL with a default of 'preferred' so existing rows
-- inherit the safe middle-ground. Admins opt into 'required' explicitly
-- once their volunteer pool has been verified to run SFrame-capable
-- browsers (Chromium 103+, Safari 16+).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so a partial apply on a dev box
-- does not wedge subsequent `bun run migrate` runs.

ALTER TABLE call_settings
  ADD COLUMN IF NOT EXISTS voice_call_e2ee_policy TEXT NOT NULL DEFAULT 'preferred';
