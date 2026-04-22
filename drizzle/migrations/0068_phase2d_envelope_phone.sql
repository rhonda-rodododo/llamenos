-- Phase 2D: Upgrade server-key phone fields to envelope E2EE
--
-- Pre-production: TRUNCATE to clear any server-key-only encrypted data.
-- After this migration, all phone fields on users and invite_codes are
-- envelope-encrypted (ECIES per-recipient). The server can no longer
-- decrypt volunteer phone or invite phone at rest.
--
-- Also clears related tables that depend on user/invite state:
-- webauthn_credentials, webauthn_challenges, provision_rooms, user_sessions,
-- mls_key_packages, mls_epoch_commits.

TRUNCATE
  webauthn_credentials,
  webauthn_challenges,
  provision_rooms,
  user_sessions,
  mls_key_packages,
  mls_epoch_commits,
  invite_codes,
  users
CASCADE;
