# Next Backlog

## Incomplete Features Audit — 2026-04-18

Full report: [`docs/INCOMPLETE_FEATURES_AUDIT_2026-04-18.md`](INCOMPLETE_FEATURES_AUDIT_2026-04-18.md). Server infrastructure is complete for all items below; only client UI / wiring is missing.

### P1 (functional gaps — volunteers/admins expect these to work)

- [ ] **GDPR account erasure + data export UI** — API client exists (`src/client/lib/api/gdpr.ts`) but zero UI components import it. Missing: React Query hooks, "Download my data" button, "Request account deletion" flow, admin erasure dashboard.
- [ ] **Contacts bulk import + merge UI** — API + query hooks exist (`useBulkUpdateContacts`, `useBulkDeleteContacts`, `useMergeContacts`) but zero UI components import them. Missing: CSV/JSON import dialog, contact merge modal, batch select in contacts table.
- [ ] **Telephony provider setup wizard (OAuth, A2P, phone provisioning)** — API functions exist (`validateProviderCredentials`, `startProviderOAuth`, `provisionPhoneNumber`, etc.) but only basic telephony config UI exists. Missing: OAuth callback handler, A2P brand/campaign forms, phone number search + provision UI.

### P2 (feature completeness / UX polish)

- [ ] **Retention settings admin UI** — API client exists (`getRetentionSettings`, `updateRetentionSettings`) but no admin section component. Missing: React Query hooks + admin UI for data-retention policy configuration.
- [ ] **Settings fallback-group endpoint deduplication** — `/settings/fallback-group` and `/shifts/fallback` are redundant. Pick canonical endpoint, deprecate the other, update client.
- [ ] **Note replies** — Server routes `GET|POST /notes/:id/replies` exist. Missing: API functions, query hooks, reply thread UI.
- [ ] **Intake detail view** — Server route `GET /intakes/:id` exists. Missing: `getIntake` API function, `useIntake` hook, intake detail route/page.
- [ ] **Report detail + files** — Server routes `GET /reports/:id` and `GET /reports/:id/files` exist. API functions `getReport` and `getReportFiles` are defined but **not exported**. Missing: export + query hooks + report detail page with file viewer.
- [ ] **Conversation load balancing indicator** — Server route `GET /conversations/load` exists. API function `getUserLoads` is defined but **not exported**. Missing: export + query hook + load indicator in claim UI.
- [ ] **Team contact assignment UI** — API + query hooks exist (`useAssignTeamContacts`, `useUnassignTeamContact`) but zero UI components import them. Missing: contact-assignment UI in team detail and/or contacts page.

### Safeguarding

- [ ] **Knip safelist for intentionally-unused API/query symbols** — Add JSDoc `@knipignore` (or knip config) for the orphaned functions/hooks listed in the audit so a future sweep does not delete them like the Signal contact registration UI was deleted in the knip incident.

## Security overhaul — Phase 2 (from completion audit 2026-04-14)

Full report: [`docs/security/SECURITY_OVERHAUL_COMPLETION_AUDIT_2026-04-14.md`](security/SECURITY_OVERHAUL_COMPLETION_AUDIT_2026-04-14.md). Phase 1 (Tiers 0, 3, 4, 5-Twilio, Tier 1 hub-fields, Tier 2 OPAQUE/Shamir/multi-factor KEK) shipped and is hardened. Phase 2 remains.

### Phase-2 P0 (exploitable or load-bearing)

- [x] ~~**Recovery-participant dedup** (Tier 3).~~ Merged 2026-04-14 (`f5a99001`), PR #142. Added `recovery_participants` junction table with `UNIQUE (recovery_request_id, participant_user_id)` + route-level JWT-subject check.
- [x] ~~**`decryptHubField` plaintext-fallback removal** (Tier 1).~~ Merged 2026-04-14 (`50998aba`), PR #151. Removed server-plaintext fallback, always returns `''` on failure; `HubFieldTamperError` thrown for ciphertext-shaped AEAD failures; 13 caller sites fixed.
- [x] ~~**`unlock` PRF-unavailable vs wrong-PIN discrimination** (Tier 2).~~ Verified merged pre-audit (2026-04-14). Discriminated `UnlockResult` union already at `key-manager.ts:379-384,394`; 9 adversarial tests in `key-manager-unlock.test.ts`.
- [ ] **Tier 6 PR #2 — MLS message-path wiring** (Tier 6). Headline item. `src/client/lib/mls/conversation.ts` is still an 11-line skeleton. Scope per POST_OVERHAUL_GAPS §Tier 6: core-crypto bootstrap, real `MlsConversation` implementation, DB schema (`mls_hub_state` + `mls_key_packages`), server routes, hub-creation bootstrap, notes + messages path cutover, epoch commits on admin add/remove, audit payload variants, round-trip + adversarial tests, whitepaper rewrite. Multi-PR epic.
- [x] ~~**Consent-gate adversarial tests** (Tier 5).~~ Verified merged pre-audit (2026-04-14). `sframe-call-hook.test.ts` has `buildSFrameCallHook — consent gate` block with `consent_required` rejection tests.

### Phase-2 P1 (hardening + integration tests)

- [x] ~~`wrapHubKeyForDevices` half-commit rollback policy (Tier 1)~~ — merged 2026-04-14 (`8e719706`), PR #147.
- [x] ~~Audit chain cache trust-anchor drift (Tier 0)~~ — merged 2026-04-14 (`58cddfbe`), PR #148. Trust-anchor drift detection + empty-chain cache-poisoning guard + 4 adversarial tests.
- [ ] Rotation-on-tamper integration test (Tier 0)
- [ ] CLKR-during-revoke integration test (Tier 3)
- [ ] Behavioral CSP iframe-escape Playwright test (Tier 4)
- [ ] Behavioral SameSite CSRF test (Tier 4)
- [ ] `DeviceService.findDeviceBySigningPubkey` revoked-device filter (Tier 3)
- [ ] SFrame key-distribution inline HPKE binding (Tier 5)
- [x] ~~`items-key` per-artifact AAD binding (Tier 1)~~ — merged 2026-04-14 (`5e53f3bc`), PR #150.
- [x] ~~**Doc drift sweep:** CLAUDE.md security bullet corrections (lines 100/106/115), HPKE_MIGRATION_NOTES + POST_OVERHAUL_GAPS + AEAD_AUDIT `EnvelopeV3`/`envelope-v3` rename cleanup.~~ — this PR.

### Phase-2 P2 (polish — see completion audit §Follow-ups)

Type-design work (branded `ShamirShare`/`VerifiedShare`, `DicewarePhrase` redaction wrapper class, `Ed25519SigningKey`/`X25519EncryptionKey` CryptoKey wrappers, branded `MlsGroupId`/`MlsEpoch`, branded `SframeFrame` record, parse-don't-validate `UnsignedAuditEntry` → `SignedAuditEntry` transition, HKDF-only labels moved out of `LABEL_REGISTRY`, adversarial tests for PUK interruption / Shamir garbage-combine / OPAQUE timing oracle).

## Follow-up: Static-image GHCR publish + caddy from-registry override
- **What:** `deploy/docker/docker-compose.production.yml` overrides the base `caddy:2-alpine` image with a local build (`target: static`) that bakes `dist/client` + `dist/crypto-sandbox` onto a caddy:2-alpine base. The new `docker-compose.from-registry.yml` (added below) covers `app` and `sip-bridge` but cannot cover `caddy` because `.github/workflows/docker.yml` does not currently publish a static-target image to GHCR. Operators using `production.yml` therefore still need a build toolchain on the host.
- **Scope:** Add a third matrix entry to `.github/workflows/docker.yml` that builds the `static` Dockerfile target and publishes it as `ghcr.io/rhonda-rodododo/llamenos-hotline-static:${TAG}` with cosign + provenance + SBOM. Then add a `caddy:` block to `docker-compose.from-registry.yml` pointing at that image (`image: ghcr.io/rhonda-rodododo/llamenos-hotline-static:${LLAMENOS_VERSION:-latest}` + `build: !reset null`). Update `roles/llamenos/vars/main.yml` and `demo_vars.example.yml` defaults to point at the published tag (already done — image name string is in place but image is not yet published).
- **Files:** `.github/workflows/docker.yml`, `deploy/docker/docker-compose.from-registry.yml`, `roles/llamenos/templates/docker-compose.j2`.

## ~~Follow-up: Type-brand hardening for session-capsule types (PR #50 review item #9)~~ — DONE (PR #96)
- Shipped as PR #96 (branch `feat/session-capsule-type-brands`). Added length-tagged `HexString<N>` brands (`SessionToken`, `CapsuleNonceHex`, `EncryptedNsecHex`, `PubkeyHash16`), runtime `parseSessionCapsule` / `parseSyncMessage` / `parseLockMessage` validators at IDB + BroadcastChannel boundaries, symmetric `tokenHex` field in worker RPC, generic `CryptoWorkerClient.call<R>`, and new `@client/lib/cross-tab-messages` module consolidating both cross-tab protocols. 57 new passing tests; no regressions.

## High Priority (Pre-Launch)
- [x] Set up Cloudflare Tunnel for local dev with telephony webhooks (`scripts/dev-tunnel.sh`)
- [x] Configure production wrangler secrets (TWILIO_*, ADMIN_PUBKEY) — deployed and running
- [ ] Test full call flow end-to-end: incoming call -> CAPTCHA -> parallel ring -> answer -> notes -> hang up *(requires real phone + telephony account)*
- [x] **BUG: `[encrypted]` placeholders after crypto worker auto-lock** — Fixed in PR #48 (feat/pin-prompt-locked-key). App now redirects to /login when key is locked after reload/auto-lock.
- [x] **BUG: Transient decrypt failures on contact profile load** — Fixed in PR #48 final commit `55bf5ee4` ("fix(crypto): scope decrypt field scan to caller-supplied fields"). Root cause: `resolveEncryptedFields` scanned all `encrypted*` keys regardless of label, so a second decrypt pass (e.g. `LABEL_CONTACT_PII`) re-attempted fields already decrypted under `LABEL_CONTACT_SUMMARY`, causing XChaCha20-Poly1305 AEAD auth failures because ECIES derives the symmetric key as `sha256(label || sharedX)`. Fix exposes a `fieldNames?: readonly string[]` parameter on `decryptObjectFields`/`decryptArrayFields`; `src/client/lib/queries/contacts.ts` now defines `CONTACT_SUMMARY_FIELDS`, `CONTACT_PII_FIELDS`, `CONTACT_RELATIONSHIP_FIELDS` constants that `contactDetailOptions` passes through to scope each label pass. Rate limit restored to 100/sec. Regression tests in `src/client/lib/decrypt-fields.test.ts`.

## Security Audit Findings (2026-02-12, Round 4)

### Fixed (committed ddc95ec)
- [x] **CRITICAL**: Vonage webhook validation was `return true` — now HMAC-SHA256
- [x] **CRITICAL**: Caller phone hash leaked in spam report WS response
- [x] **HIGH**: Mass assignment — volunteer self-update now restricted to safe fields allowlist
- [x] **HIGH**: SSRF in provider test — ARI URL validation, internal IP blocking, fetch timeout
- [x] **HIGH**: ~~WebSocket flooding~~ — WebSocket removed; Nostr relay rate limiting replaces
- [x] **HIGH**: ~~WebSocket prototype pollution~~ — WebSocket removed; no longer applicable
- [x] **HIGH**: Weak KDF — upgraded SHA-256 concat to HKDF-SHA256 for note encryption
- [x] **HIGH**: Security headers — COOP, no-referrer, expanded CSP and Permissions-Policy

### Fixed (Round 4 medium, 6d3deac)
- [x] Session token revocation: logout API + server-side session delete
- [x] WebSocket call authorization: verify call state + volunteer ownership for answer/hangup/spam
- [x] Invite code rate limit: reduced from 10 to 5 per minute
- [x] Custom field label/option length validation: 200 char max
- [x] Presence broadcast: volunteers get `{ hasAvailable }` only, admins get full counts
- [ ] Encrypt/hash note metadata (callId, authorPubkey) to prevent correlation analysis — *trade-off: breaks server-side filtering/grouping; notes content is already E2EE*

## Security Audit Findings (2026-02-17, Round 5 — Epic 53)

### Fixed — CRITICAL
- [x] Login endpoint did not verify Schnorr signature — anyone knowing pubkey could enumerate roles
- [x] CAPTCHA expected digits stored in URL query params — attacker could see/modify; bypasses CAPTCHA
- [x] `Math.random()` used for CAPTCHA generation — predictable, not CSPRNG

### Fixed — HIGH
- [x] Invite redemption accepted arbitrary pubkey — no proof of private key ownership
- [x] Upload chunk/status endpoints had no ownership check
- [x] Sessions not revoked on volunteer deactivation/deletion
- [x] Plaintext nsec in onboarding backup — now encrypted with PBKDF2 + XChaCha20-Poly1305
- [x] HKDF called without salt for note encryption — added fixed application salt
- [x] Static PBKDF2 salt for recovery key derivation — now per-backup random salt
- [x] TwiML XML injection via HOTLINE_NAME — added `escapeXml()` function

### Fixed — MEDIUM
- [x] No rate limiting on WebAuthn login flow — added IP-based 10/min
- [x] CORS missing `Vary: Origin` header — cache poisoning risk
- [x] Reporter role could create/edit call notes — added role guard
- [x] WebAuthn userVerification "preferred" → "required"
- [x] IP hash truncated to 64 bits — increased to 96 bits
- [x] Asterisk webhook validation used `===` (non-constant-time) — now XOR comparison
- [x] Asterisk webhook had no timestamp replay protection — added 5-min window
- [x] Asterisk bridge bound to 0.0.0.0 — bound to 127.0.0.1

### Low / Future
- [x] Add auto-lock/panic-wipe mechanism for device seizure scenarios (triple-Escape trigger)
- [x] SRI hashes for PWA service worker cached assets (`sri-workbox-plugin.ts`)
- [x] Consider re-auth step-up for sensitive actions — PIN challenge dialog for phone unmask
- [ ] Auth token nonce-based replay protection *(accepted trade-off: mitigated by HTTPS + Schnorr + 5-min window + method/path binding)*

## Security Audit Findings (2026-02-23, Round 6)

Full report: [`docs/security/SECURITY_AUDIT_2026-02-R6.md`](security/SECURITY_AUDIT_2026-02-R6.md)
Threat model: [`docs/security/THREAT_MODEL.md`](security/THREAT_MODEL.md)
Deployment guide: [`docs/security/DEPLOYMENT_HARDENING.md`](security/DEPLOYMENT_HARDENING.md)

### Critical — Epic 64
- [x] ~~**C-1**: Caller phone number broadcast to ALL volunteers~~ — VERIFIED NOT VULNERABLE (already hashed + redacted server-side)
- [x] **C-2**: `codeql-action` uses mutable `@v3` tag — pinned to SHA
- [x] **C-3**: `git-cliff` binary downloaded without SHA256 verification — checksum added

### High — Epic 64
- [x] **H-1**: V1 legacy encryption still callable (no forward secrecy) — removed `encryptNote` export
- [x] **H-2**: Dev reset endpoints rely solely on `ENVIRONMENT` var — added `DEV_RESET_SECRET` secondary gate
- [x] **H-3**: Hub telephony provider config stored without validation — validation added
- [x] **H-4**: Demo nsec values compiled into all production bundles — dynamic import, code-split chunk
- [x] **H-5**: Docker Stage 3 resolves deps without lockfile — switched to bun with `--frozen-lockfile`
- [x] **H-6**: Asterisk `ARI_PASSWORD` has no required override in compose — added `:?` required syntax

### Medium — Epic 65
- [x] **M-1**: SSRF blocklist incomplete (IPv6, CGNAT, mapped addresses) — expanded blocklist with proper CIDR matching
- [x] **M-2**: `/calls/active` and `/calls/today-count` missing permission guards — added
- [x] **M-3**: `isAdmin` query param on internal DO API — replaced with dedicated `/admin/volunteers/:pubkey` DO route
- [x] **M-4**: Missing security headers in Worker — added CORP and X-Permitted-Cross-Domain-Policies
- [x] **M-5**: Phone hashing with bare SHA-256 — upgraded hashPhone/hashIP to HMAC-SHA256 with HMAC_SECRET env var, threaded through all adapters/routes/DOs
- [x] **M-6**: Backup filename leaks pubkey fragment — now uses random suffix
- [x] **M-7**: File metadata ECIES uses wrong context string — fixed to `llamenos:file-metadata`
- [x] **M-8**: No JS dependency vulnerability scanning in CI — added `bun audit --audit-level=high` job gating releases
- [x] **M-9**: Floating Docker base image tags — pinned all images to SHA256 digests (Dockerfile, compose, Helm)
- [x] **M-10**: Helm NetworkPolicy missing PostgreSQL egress rule — added conditional TCP egress for postgres.port

### Low — Epic 67
- [x] **L-1**: `adminPubkey` in public config — moved to authenticated `/api/auth/me` response
- [x] **L-2**: Phone numbers unmasked in invite list and delete dialogs — applied `maskedPhone()` pattern
- [x] **L-3**: `keyPair.secretKey` propagated through React state — removed from auth context, all consumers use `keyManager.getSecretKey()` at point of use
- [x] **L-4**: Schnorr tokens not bound to request path — tokens now include method+path in signed message
- [x] **L-5**: Rate limiter off-by-one (`>` vs `>=`) — fixed
- [x] **L-6**: Shift time format not validated — added HH:MM regex validation
- [x] **L-7**: Document CSP `style-src 'unsafe-inline'` trade-off — added explanatory comment
- [x] **L-8**: Reduce Playwright trace artifact retention to 1 day — done
- [x] **L-9**: Add panic-wipe mechanism for device seizure (triple-Escape trigger + full wipe)
- [x] **L-10**: SRI hashes for service worker cached assets (Vite closeBundle plugin)

## Deployment Hardening Tooling — Epic 66
- [x] Ansible playbook for VPS hardening (SSH, firewall, kernel, Docker, fail2ban)
- [x] Ansible playbook for application deployment (docker-compose, secrets, health check)
- [x] Ansible playbook for updates and rollbacks
- [x] Ansible playbook for encrypted backups
- [x] OpenTofu module for Hetzner VPS provisioning (optional)
- [x] Quick start guide for first-time operators (`docs/QUICKSTART.md`)
- [x] Operator runbook (secret rotation, incident response, backup recovery) (`docs/RUNBOOK.md`)
- [x] Updated DEPLOYMENT_HARDENING.md with Ansible tooling cross-references

### Follow-ups
- [ ] **FDE ISO: `--unlock=tang` mode with bundled Tang server deployment role.**
  Tang/Clevis network-bound disk encryption: unlocks the LUKS volume
  automatically when the host is on a trusted network. Eliminates the
  manual passphrase step on every boot for operators running multiple
  hotlines. Requires a separately deployed Tang server (its own VPS,
  hardening, backup story) and coordination with the existing
  `key-store-v2` multi-factor KEK story. See
  `docs/superpowers/specs/2026-04-09-fde-iso-builder-design.md` §12.

## Multi-Provider Telephony (Epics 32–36) — COMPLETE
- [x] Epic 32: Provider Configuration System (admin UI, API, DO storage, connection test)
- [x] Epic 33: Cloud Provider Adapters (SignalWire extends TwilioAdapter, Vonage, Plivo)
- [x] Epic 34: WebRTC Volunteer Calling (in-browser call answer, provider-specific SDKs)
- [x] Epic 35: Asterisk ARI Adapter (self-hosted SIP, ARI bridge service)
- [x] Epic 36: Telephony Documentation (provider comparison, setup guides, in-app help)

## Multi-Channel Messaging & Reporter Role (Epics 42–47) — COMPLETE
- [x] Epic 42: Messaging Architecture & Threaded Conversations
- [x] Epic 43: Admin Setup Wizard
- [x] Epic 44: SMS Channel
- [x] Epic 45: WhatsApp Business Channel
- [x] Epic 46: Signal Channel
- [x] Epic 47: Reporter Role & Encrypted File Uploads
- [x] In-App Guidance: Help page, FAQ, Getting Started checklist, command palette integration

## Multi-Platform Deployment (Epic 55) — COMPLETE
- [x] Platform abstraction layer (`src/platform/`) — interfaces for StorageApi, BlobStorage, TranscriptionService
- [x] Node.js DurableObject shim with PostgreSQL-backed storage (postgres.js, advisory locks)
- [x] WebSocketPair polyfill for Node.js (EventEmitter-based connected shim sockets)
- [x] Refactored Env interface with structural typing (DOStub, DONamespace, BlobStorage, TranscriptionService)
- [x] esbuild Node.js build with `cloudflare:workers` → `src/platform/index.ts` alias
- [x] Docker infrastructure (Dockerfile, docker-compose.yml with PostgreSQL, Caddyfile, .env.example)
- [x] Helm chart for Kubernetes (app, PostgreSQL, MinIO, Whisper, optional Asterisk/Signal)
- [x] CI/CD GitHub Actions workflow for Docker image builds (GHCR)
- [x] Health check endpoint (`/api/health`)
- [x] PostgreSQL replaces SQLite — enables multi-replica RollingUpdate in Kubernetes

## Demo Mode (Epic 58) — COMPLETE
- [x] Epic 58: Demo mode — setup wizard opt-in, client-side seeding, one-click demo login, demo banner

## Storage Migrations (Epic 59) — COMPLETE
- [x] Epic 59: Unified data migration framework — migrations written against StorageApi, run on both CF DOs and PostgreSQL, version tracking per namespace, automatic execution at startup/first access

## UI Polish (Epics 56–57) — COMPLETE
- [x] Epic 56: Page consistency & visual refinement (conversations heading, reports empty state, volunteer phone display, login file picker, dashboard stat cards)
- [x] Epic 57: Admin UX improvements (audit log filtering, admin settings status summaries)

## Permission-Based Access Control & Multi-Hub (Epics 60–63)
- [x] Epic 60: Permission-Based Access Control — dynamic roles, permission catalog, multi-role users, role manager UI
- [x] Epic 61: Multi-Hub Architecture — hub isolation, per-hub DOs, hub-scoped roles, hub switcher UI, hub management admin page, telephony/messaging/WebSocket hub routing
- [x] Epic 62: Message Blasts — subscriber management, broadcast messaging, scheduled sends, opt-in/opt-out compliance
- [x] Epic 63: RCS Channel — Google RBM API adapter, rich cards, suggested replies, SMS fallback

## Zero-Knowledge Architecture (Epics 74–79)

Full E2EE transformation to Signal-level privacy. Clean rewrite — no migration, no feature flags (pre-production).

Architecture overview: [`docs/architecture/E2EE_ARCHITECTURE.md`](architecture/E2EE_ARCHITECTURE.md)

**Dependency graph:** 76.0 → 76.1 / 76.2 → 76 → 74 / 75 / 77 → 78 / 79

### Pre-Implementation Foundations — COMPLETE
- [x] **[Epic 76.0: Security Foundations](epics/epic-76.0-security-foundations.md)** — Domain separation label audit, provisioning SAS verification fix, crypto-labels.ts
- [x] **[Epic 76.1: Worker-Relay Communication](epics/epic-76.1-worker-relay-communication.md)** — NostrPublisher interface, CF/Node implementations, server keypair, relay infrastructure
- [x] **[Epic 76.2: Key Architecture Redesign](epics/epic-76.2-key-architecture-redesign.md)** — Hub key = random 32 bytes ECIES-wrapped per member, multi-admin envelopes, hub key manager

### Foundation Layer — COMPLETE
- [x] **[Epic 76: Nostr Relay Real-Time Sync](epics/epic-76-nostr-relay-sync.md)** — Complete WS removal, Nostr-only real-time broadcasts, ephemeral kind 20001 events

### Data Encryption Layer — COMPLETE
- [x] **[Epic 74: E2EE Messaging Storage](epics/epic-74-e2ee-messaging-storage.md)** — Envelope encryption: per-message random key, ECIES envelopes for volunteer + admin
- [x] **[Epic 77: Metadata Encryption](epics/epic-77-metadata-encryption.md)** — Per-record DO storage keys, encrypted call history, hash-chained audit log

### Client Privacy Layer
- [ ] **[Epic 75: Native Call-Receiving Clients](epics/epic-75-native-call-clients.md)** — Tauri desktop (macOS/Windows), React Native mobile (iOS/Android). Separate repos. *Future work.*
- [x] **[Epic 78: Client-Side Transcription](epics/epic-78-client-side-transcription.md)** — @huggingface/transformers ONNX Whisper in browser, AudioWorklet ring buffer, Web Worker isolation, settings UI, auto-save encrypted transcript on hangup

### Trust Verification — COMPLETE
- [x] **[Epic 79: Reproducible Builds](epics/epic-79-reproducible-builds.md)** — Deterministic build config, Dockerfile.build, verify-build.sh, CHECKSUMS.txt in GitHub Releases, SLSA provenance

## Low Priority (Post-Launch)
- [x] Add call recording playback in notes view (on-demand fetch from telephony provider)
- [x] Marketing site + docs at llamenos-hotline.com (Astro + Cloudflare Pages)

## Platform Hardening Sprint (2026-03-22) — Specs + Plans Ready

All items below have a design spec and implementation plan in `docs/superpowers/`. Agents should pick up plans from `docs/superpowers/plans/` and follow the `superpowers:executing-plans` skill.

### Critical Security — Execute First

- [x] **Security Hardening v2 Audit Backport** (`2026-03-22-security-hardening-v2-backport-plan.md`) — CRIT-H1 hub key membership check (verify first), HIGH-W1 relay key scoping, HIGH-W3 raw phone in audit log, HIGH-W4 dev endpoint 403→404, HIGH-W5 Twilio SID validation, MED-W1 cross-hub global routes, MED-W2 ban-by-phone admin-only, code quality fixes (empty catch blocks, offline queue race, `as any`, hardcoded CORS), workflow permissions least-privilege
- [x] **Volunteer PII Enforcement** (`2026-03-22-volunteer-pii-enforcement-plan.md`) — TypeScript-enforced `projectVolunteer()` with discriminated union (`view: 'public'|'self'|'admin'`), correct E.164 `maskPhone()`, covers all volunteer-returning endpoints including `PATCH /:targetPubkey`

### Platform & CI/CD

- [x] **CI Pipeline Hardening** (`2026-03-22-ci-security-hardening-plan.md`) — GPG signing for releases (CHECKSUMS.txt.asc uploaded to GitHub Release), gitleaks secret scanning, Dependabot for bun/cargo/actions, SECURITY.md, workflow permissions per-job. **Operator action required**: generate CI GPG keypair and set RELEASE_GPG_PRIVATE_KEY + RELEASE_GPG_KEY_ID secrets.
- [x] **CI VPS Auto-Deploy** (`2026-03-22-ci-vps-auto-deploy-plan.md`) — `auto-deploy-demo.yml` triggers on `release:published`, polls for Docker image in GHCR, deploys via Ansible with `llamenos_image` override, health endpoint verification. Site auto-deploy added to `ci.yml` (CF Pages on `site/` changes). `rollback-demo` recipe added to justfile. **Operator action required**: set `CF_API_TOKEN` + `CF_ACCOUNT_ID` secrets for site deploy.
- [x] **Ops: PostgreSQL Backup & Recovery** (`2026-03-22-ops-backup-recovery-plan.md`) — Audited existing role (already complete); fixed test-restore table names (CF→Drizzle), added backup freshness to `/api/health`, restore.yml playbook, restore-postgres.sh script, docs/ops/restore-runbook.md, justfile recipes (backup-demo, test-restore-demo, restore-demo)
- [x] **Ops: MinIO Init + Systemd Service** (`2026-03-22-minio-init-systemd-plan.md`) — `init-minio.sh` (bucket, lifecycle rules, llamenos-app IAM user), app now uses MINIO_APP_USER/PASSWORD (least-privilege), health endpoint checks HeadBucket, systemd unit via Ansible (`llamenos.service.j2`)
- [x] **CF Removal / Drizzle Migration — Schema Corrections** (`2026-03-22-drizzle-schema-completeness-addendum.md`) — Subscribers privacy refactor (identifierHash, channels JSONB, status enum, preferenceToken), blasts (targetChannels/targetTags/targetLanguages arrays, stats JSONB), blast_settings, note_replies, GDPR tables (gdpr_consents, gdpr_erasure_requests, retention_settings), geocoding_config, hubs.allowSuperAdminAccess, hub_keys ephemeralPubkey+createdAt, customFieldDefinitions.context, file_records.hubId. Migration 0003 written manually (drizzle-kit TTY limitation). Updated BlastService, routes, messaging router, preferences endpoints.

### Application Quality

- [x] **Application Hardening Phase 3** (`2026-03-22-application-hardening-phase3-plan.md`) — Audited: auth middleware already clean (no `as any`), `profileCompleted` wiring verified correct, on-break filtering confirmed in `startParallelRinging`, active calls dashboard widget already present, call history pagination already implemented. Discovery phases (3.5/3.6/3.9) deferred pending new specs.
- [x] **GDPR Compliance** (`2026-03-22-gdpr-compliance-plan.md`) — Consent gate, data export, right to erasure (72h delay), retention purge job, admin UI
- [x] **Ansible Hardening** (`2026-03-22-ansible-hardening-plan.md`) — Preflight checks, ansible-lint config, digest-based rollback, CI validation job

### Test Coverage

> Implement shared helpers first (`tests/helpers/` migration from flat `tests/helpers.ts`) — prerequisite for all suites.

- [x] **Shared Test Helpers** — `tests/helpers/` directory: `auth.ts` (login helpers), `crypto.ts` (key preloading), `db.ts` (resetTestState, createTestHub, deleteTestHub), `call-simulator.ts` (simulateInboundCall, simulateCallAnswered, simulateCallHungUp, simulateVoicemail, waitForCallState); `index.ts` re-exports all; existing `from './helpers'` imports resolve transparently
- [x] **Call Flow Tests** (`2026-03-22-call-flow-tests-plan.md`) — ring → answer → note → hangup → voicemail fallback → parallel ringing. Inbound webhook is two-step: `POST /telephony/incoming` then `POST /telephony/language-selected`. Fixed telephony routing (top-level /telephony/* not /api/telephony/*), updated playwright.config.ts to use bun server, added data-testid to dashboard call elements.
- [x] **E2EE Verification Tests** (`2026-03-22-e2ee-verification-tests-plan.md`) — Server stores ciphertext only; `window.__llamenos_test_crypto` hook (VITE_TEST_MODE guard); multi-envelope decryption; forward secrecy
- [x] **Nostr Relay Tests** (`2026-03-22-nostr-relay-tests-plan.md`) — `call:ring` event published and encrypted; hub key extracted via `window.__llamenos_test_hub_key`; REST polling fallback
- [x] **Spam Mitigation Tests** (`2026-03-22-spam-mitigation-tests-plan.md`) — Ban enforcement, rate limiting, CAPTCHA toggle (correct/wrong digits), priority: ban > rate-limit > CAPTCHA
- [x] **PWA Offline Tests** (`2026-03-22-pwa-offline-tests-plan.md`) — SW registration, offline banner, API not cached, queue sends on reconnect
- [x] **WebAuthn Registration Tests** (`2026-03-22-webauthn-registration-tests-plan.md`) — Virtual authenticator via CDP, passkey register/login, multi-device, session revocation
- [x] **i18n Locale Tests** (`2026-03-22-i18n-locale-tests-plan.md`) — All 13 locales, RTL Arabic, dynamic locale file comparison (no hardcoded strings), `scripts/check-locales.ts` with nested key traversal
- [x] **Provider Simulation Suite** (`2026-03-22-provider-simulation-suite-plan.md`) — Payload factory + proxy simulation endpoints for all 5 telephony providers × 9 events and all 4 messaging channels. Asterisk-first build order. Dev bypass added to messaging router. E2E tests assert 200/404 (not 400/403/500) for all provider × event combinations.

### Features (Lower Priority — v1 Gap Filling)

- [x] **Missing Pages** (`2026-03-22-missing-pages-plan.md`) — `/calls/:callId` detail page, `/notes/:noteId` permalink, settings profile section verified, audit log deep links
- [x] **Message Delivery Status** (`2026-03-22-message-delivery-status-plan.md`) — DB migration, status callback webhook, `MessageStatusIcon` component, ConversationThread updated
- [x] **Report Types System** (`2026-03-22-report-types-system-plan.md`) — `report_types` table, `ReportTypeService`, CRUD API, admin settings section, report form type selector
- [x] **Invite Delivery** (`2026-03-22-invite-email-delivery-plan.md`) — `InviteDeliveryService`, Signal/WhatsApp/SMS send, phone HMAC hash, admin dialog with channel selector and SMS warning
- [x] **Dashboard Analytics** (`2026-03-22-dashboard-analytics-plan.md`) — recharts charts (call volume, peak hours, team stats), lazy-loaded admin section, analytics API
- [x] **File Field Type** (`2026-03-22-file-field-type-plan.md`) — E2EE file upload/download, `FileFieldInput`/`FileFieldDisplay` components, `PATCH /api/uploads/:id/context`, admin MIME/size config

### Telephony Automation

- [x] **SIP Bridge Auto-Config** (`2026-03-22-asterisk-bridge-auto-config.md`) — PjsipConfigurator writes auth/aor/endpoint/registration via ARI dynamic config API at startup, sorcery.conf for memory wizard, Docker compose + dev offsets, real-Asterisk E2E tests (now part of sip-bridge)
- [x] **Provider OAuth Auto-Config** (`2026-03-22-provider-oauth-auto-config.md`) — ProviderSetup module: Twilio/Telnyx OAuth, SignalWire/Vonage/Plivo credential validation, webhook auto-config, SIP trunk provisioning, A2P 10DLC registration
- [x] **Signal Automated Registration** (`2026-03-22-signal-automated-registration.md`) — SMS interception for Signal verification codes, SettingsDO pending state with TTL, voice fallback manual entry, registration wizard UI
- [x] **Setup Wizard Provider Module** (`2026-03-22-setup-wizard-provider-module.md`) — OAuthConnectButton, PhoneNumberSelector, WebhookConfirmation, ChannelSettings, setup routes, E2E tests.

### Unreviewed Plans — Pending Triage

> Plans below were created 2026-03-22 but not yet added to the backlog. Status determined by codebase audit.

- [x] **Foundation Tooling** (`2026-03-22-foundation-tooling-plan.md`) — Biome setup, build constants, esbuild removal, Docker SHA pinning, CI lint job, dev:docker scripts.
- [x] **E2E Test Improvements** (`2026-03-22-e2e-test-improvements-plan.md`) — Test isolation, `resetTestState()` in 34 specs, coverage gaps doc, parallel workers, test-local.sh, .dev.vars.local.example.
- [x] **CF → VPS Demo Migration** (`2026-03-22-cf-vps-demo-migration-plan.md`) — Ansible role templates (env.j2, docker-compose.j2, caddy.j2), demo cron reset, deploy workflow, justfile recipes.
- [x] **Application Hardening** (`2026-03-22-application-hardening-plan.md`) — Phase 1 (cross-hub subscriptions) was already complete. Phase 2 (hub deletion/archiving) already complete. Phase 3: fixed 3 critical hub isolation gaps (shift schedule, call record, Nostr event hub tagging). Phase 4: replaced all silent catch blocks with error logging. Config validation was already comprehensive.
- [x] **CF Removal + Drizzle Migration** (`2026-03-22-cf-removal-drizzle-migration-plan.md`) — Complete. 7 DOs → 10 service classes, src/worker/ → src/server/, wrangler.jsonc deleted, platform shim deleted, Drizzle ORM with proper schema tables.
- [x] **SLSA Provenance** (`2026-03-22-slsa-provenance-plan.md`) — Dockerfile.build, verify-build.sh, CHECKSUMS.txt, attest-build-provenance, GPG signing step, provenance.json metadata.
- [x] **Transcription Boundary** (`2026-03-22-transcription-boundary-plan.md`) — CF AI path removed, self-hosted Whisper opt-in, transcribeAudioBuffer(), recording transcribe button, i18n for 13 locales.
- [x] **Voice CAPTCHA** (`2026-03-22-voice-captcha-plan.md`) — captchaMaxAttempts tracking, retry/fail result flow, digit randomization fix (1-9), admin UI, captchaRetry prompt in 13 languages, E2E tests.
- [x] **Geocoding Location Fields** (`2026-03-22-geocoding-location-fields-plan.md`) — GeocodingAdapter interface, OpenCage + Geoapify implementations, LocationField component with autocomplete/GPS, admin settings, i18n, E2E tests.
- [x] **Hub Admin Zero-Trust Visibility** (`2026-03-22-hub-admin-zero-trust-visibility-plan.md`) — Complete. allowSuperAdminAccess field exposed in Hub type/schema, IdentityService getSuperAdminPubkeys/isSuperAdmin, PATCH /hubs/:hubId/settings with self-grant 403 protection, GET /hubs/:hubId/key-envelope, admin UI toggle with confirmation dialogs and access badges, i18n for 13 locales, 4 E2E tests.
- [ ] **E2E Test Coverage Expansion** (`2026-03-22-e2e-test-coverage-expansion.md`) — Contacts page, hub membership management, WebAuthn passkeys, blast sending, voicemail webhooks.
- [x] **Unit & Integration Tests** (`2026-03-22-unit-integration-tests.md`) — Complete: colocated `.test.ts` pattern adopted instead of `tests/unit/`. Coverage confirmed via `src/shared/crypto-labels.test.ts`, `src/server/services/records.integration.test.ts` (audit chain), `src/server/services/identity.integration.test.ts` (WebAuthn + counter monotonicity), `src/server/services/settings-rate-limiter.integration.test.ts`, `src/server/services/settings-hub-keys.integration.test.ts`, `src/client/lib/audit-chain-verifier.test.ts`. WebAuthn counter monotonicity is enforced via atomic conditional UPDATE in `identity.ts:560` — the security gap the plan called out has already been fixed.
- [x] **File Service & Blob Storage** (`2026-03-22-file-service-blob-storage.md`) — Complete: `FilesService` exists at `src/server/services/files.ts`, `file_records` table defined in `src/server/db/schema/conversations.ts`, storage abstraction via `StorageManager`, voicemail pipeline at `src/server/lib/voicemail-storage.ts` uses the service.
- [x] **Watchtower Auto-Updates** (`2026-03-22-watchtower-production-updates.md`) — Complete: Watchtower service + labels in `docker-compose.production.yml`, Ansible Jinja2 template, `demo_vars.example.yml`, `.env.example`, and `PRODUCTION_CHECKLIST.md` all wired up.

### Provider Auto-Registration Refactor (2026-03-23) — COMPLETE

- [x] **Provider Capabilities Interface** — `ProviderCapabilities<T>` generic interface + Zod discriminated union schemas for all 6 telephony providers (Twilio, SignalWire, Vonage, Plivo, Asterisk, Telnyx) + 4 messaging channels (SMS, WhatsApp, Signal, RCS). `testConnection()`, `getWebhookUrls()`, `listOwnedNumbers()`, `searchAvailableNumbers()`, `provisionNumber()`, `configureWebhooks()`. TELEPHONY_CAPABILITIES + MESSAGING_CAPABILITIES registries. 20 E2E tests.
- [x] **Credential Encryption** — Real XChaCha20-Poly1305 replacing fake hex-encoding. HKDF key derivation from SERVER_NOSTR_SECRET. Schema migration (jsonb→text). Auto-migration of plaintext data. 4 E2E tests.
- [x] **Route Fix + Setup Automation** — Mounted orphaned provider-setup routes (were 404). Rewrote to capabilities registry. Added SMS connection test endpoint. Deduplicated settings test handler.
- [x] **Health Monitoring** — ProviderHealthService with consecutive failure tracking (healthy→degraded→down). Background polling. GET /provider-health endpoint. ProviderHealthBadge React component. 5 E2E tests.
- [x] **Infrastructure** — Fixed Asterisk bridge 44GB memory leak (WebSocket GC + reconnect limit). Docker compose dev cleanup (asterisk in Docker, bridge local). Bun upgraded to latest.

### Contact Directory v2 — Specs (Draft, Needs Review)

> All specs below are drafts from 2026-03-28 brainstorming. They need review against the codebase and may need revision after Spec 0 (PBAC redesign) lands or other work changes assumptions. Review each spec before writing an implementation plan.

**Dependency order:** 0 → 1 → (2, 3 parallel) → 4 → 5 → 6

- [ ] **Spec 0: User Identity & PBAC Redesign** (`2026-03-28-user-identity-pbac-redesign.md`) — FOUNDATION. Rename volunteer→user, strongly-typed hierarchical permission scoping (`:own` ⊃ `:assigned` ⊃ `:all`), permission catalog with metadata for admin-friendly role editor, new Case Manager default role. ~109 files touched.
- [ ] **Spec 1: Tag Management** (`2026-03-28-tag-management.md`) — Admin-defined tag vocabulary with colors/categories, autocomplete, `tags:create` permission, strict mode toggle, GIN index for server-side filtering, default tag seeds.
- [ ] **Spec 2: Contact Profile Actions** (`2026-03-28-contact-profile-actions.md`) — Contact channels model (SMS/Signal username/WhatsApp/Telegram/email), notify support contacts via preferred channel, add report from contact view, relationship permission documentation.
- [ ] **Spec 3: Call-to-Contact Workflow** (`2026-03-28-call-to-contact-workflow.md`) — Add/link contacts from call detail page, client-side regex extraction of phone/name/email from transcripts, post-call contact creation flow, convenience API endpoints.
- [ ] **Spec 4: Bulk Operations** (`2026-03-28-bulk-operations.md`) — Multi-select in directory, bulk tag/untag, bulk risk level, bulk soft delete, bulk message blast to contacts via preferred channels. Depends on Spec 1 (tags) + Spec 2 (channels).
- [ ] **Spec 5: Post-Call Data Entry** (`2026-03-28-post-call-data-entry.md`) — Permission-scoped intake forms for volunteers, triage queue for case managers, encrypted intake submissions merged into contact records. New `contact_intakes` table + `contacts:triage` permission.
- [ ] **Spec 6: Contact Import/Export & Merging** (`2026-03-28-contact-import-export-merging.md`) — Client-side CSV import with dedup, encrypted JSON export, side-by-side merge UI, duplicate detection. Batch API + `mergedInto` column.

### Security Fixes — Pending

- [x] **Unknown API routes should return 404 instead of 401** — Fixed 2026-04-02: Added prefix-checking middleware in `app.ts` that returns 404 for unknown API path prefixes before the authenticated catch-all runs. Known prefixes (public + authenticated) are allowlisted; unknown paths get 404 without auth leaking route existence. E2E test: `tests/api/route-404.spec.ts`.

### Test Quality — Status (2026-03-23)

**Verified 100% passing suites (19 files, 200 tests):**
admin-flow (18), blast-sending (8), notes-crud (7), smoke (4), theme (7), health-config (5), auth-guards (7), audit-log (6), volunteer-flow (9), profile-settings (13), ban-management (13), form-validation (8), login-restore (10), blasts (7), call-spam (5) + unit tests (25) + provider-capabilities (20), credential-encryption (4), provider-health (5), asterisk-auto-config (8)

**Known remaining issues:**
- [ ] **roles.spec.ts** — 6/28 tests fail: serial chain cascade (role update fails after create; reporter/custom role hub context 400 vs 403)
- [ ] **Hub-scoped API calls from non-hub-member volunteers** return 400 (hub context required) instead of 403 (permission denied) — tests accept both
- [ ] **conversations.spec.ts** — setup wizard flow is fragile; mostly smoke tests; needs real message send/receive tests when providers are configured
- [x] **hub-access-control.spec.ts** — Verified 2026-04-12: all 3 tests pass. `data-testid="hub-access-toggle"` already on the `Switch` at `src/client/components/admin-sections/hubs-edit-dialog.tsx:246`. The branch that renders the toggle only fires for non-super-admins; super admins get a read-only `Badge`, so the test's `.not.toBeVisible()` assertion on the toggle is correct and passes.

## App Bugs Found During Test Restructuring (2026-03-24)

- [x] **CAPTCHA retry not implemented** — Investigated 2026-04-02: service layer correctly implements retry logic (attempt tracking, max enforcement, re-Gather). Test 5.4 in `voice-captcha.spec.ts` is active (no test.fixme) and validates the behavior. Bug was either already fixed or incorrectly reported.
- [x] **Dashboard incoming calls require Nostr relay** — Investigated 2026-04-02: REST polling fallback already implemented at 30s intervals (`src/client/lib/queries/calls.ts:87-112`). Nostr is primary for sub-second updates; REST is the safety net. No additional work needed.
- [x] **Drizzle migration journal out of sync** — Done in PR #99 (2026-04-13): resolved current drift at index 0056. Commit 31b62dc2 (Tier 1+2+3 merge) shipped two `0056_*.sql` files but journal only tracked `0056_tier3_per_device_keys`; `0056_tier2_recovery_group` was orphaned so the `hub_recovery_groups` / `hub_recovery_group_shares` / `user_recovery_envelopes` / `recovery_sessions` tables never got created despite being referenced by the recovery service. Renamed the orphan to `0059_tier2_recovery_group.sql` and added the journal entry; verified clean apply against a fresh DB (61 migrations, all recovery tables present). Also restored `shamir-secret-sharing` to package.json (same prereq as PR #96/#98). The older 0004/0005/0008/0009/0010 drift referenced in this entry appears to have been resolved by subsequent work — dev DB up through 51 applied migrations has no gaps.
- [x] **TwiML callback URLs use /api/telephony/ prefix** — Fixed 2026-04-02: global find-replace `/api/telephony/` → `/telephony/` across all 19 affected files (4 adapters, 6 capabilities, test adapter, test payload factory, 5 provider-setup, 1 UI component, 1 live test helper).

## SIP WebRTC Browser Calling
- [x] Asterisk WSS transport configuration (pjsip.conf, http.conf, extensions.conf)
- [x] ARI deleteDynamic method for endpoint deprovisioning
- [x] Bridge provision/deprovision/check-endpoint commands
- [x] BridgeClient extraction + AsteriskProvisioner + token generation
- [x] coturn TURN server in Docker Compose (dev + production)
- [x] Caddy WSS proxy route + CSP update
- [x] Ansible env vars + turnserver.conf template
- [x] Dev TLS cert generation script
- [x] Browser calling plan coordination updates
- [x] SipWebRTCAdapter (JsSIP) — 219 lines, fully implements WebRTCAdapter with dynamic JsSIP import, session management, DTLS-SRTP media
- [x] WebRTCManager factory integration — routes 'asterisk'/'freeswitch'/'kamailio'/'sip' providers to SipWebRTCAdapter
- [x] Bridge ring command extension for browser endpoints — bridge index.ts supports browserIdentity for PJSIP routing
- [ ] E2E tests against local Asterisk — needs mkcert TLS certs + mocked JsSIP integration tests

## Storage & Infrastructure — Future Work

- [x] **LUKS volume encryption for RustFS data** — dm-crypt/LUKS Ansible role (`luks.yml`), opt-in via `luks_enabled`. Defense-in-depth beneath SSE-S3 + E2EE.
- [x] **Per-hub IAM credentials** — Per-hub IAM users with bucket-scoped policies via RustFS admin API. Credentials encrypted at rest with HKDF + XChaCha20-Poly1305.
- [x] **Export-then-destroy on hub deletion** — Category checklist dialog + `GET /api/hubs/:hubId/export` JSON download. i18n for 13 locales.
- [ ] **External KMS for SSE-KMS** — Replace RustFS-managed keys (SSE-S3) with Hashicorp Vault or similar for key management. For deployments with higher compliance requirements.

## Data Layer — Future Work

- [x] **React Query for fetch + decrypt** — Completed in react-query refactor PR #28.
- [x] **Eliminate remaining decryptHubField calls** — Verified 2026-04-12: all `decryptHubField()` call sites now live in `src/client/lib/queries/*.ts` (teams, tags, settings, shifts, notes, blasts, roles, reports, hubs, firehose) — the target decrypt-in-queryFn pattern. Zero component-level callers remain. The 2 mentions in `tag-input.tsx` and `platform-roles-section.tsx` are comments referencing the function, not calls. `hub-field-crypto.ts` stays as the implementation the queries import.

## v2→v1 Feature Backport Series

A series of specs and plans to backport v2 (Llámenos Platform) architectural patterns into v1 (Llámenos Hotline). These are pre-production foundation work — no migration code needed.

- [ ] **Spec 1/6: Entity Templates Architecture** — `docs/superpowers/specs/2026-04-19-v2-entity-templates-architecture.md` (pending write)
- [ ] **Spec 2/6: Custom Field System** — `docs/superpowers/specs/2026-04-19-custom-field-system-spec.md` (pending write)
- [ ] **Spec 3/6: Case Management Records** — `docs/superpowers/specs/2026-04-19-case-management-records-spec.md` (pending write)
- [ ] **Spec 4/6: Contact Directory v2** — `docs/superpowers/specs/2026-04-19-contact-directory-v2-spec.md` (pending write)
- [ ] **Spec 5/6: Relationship Graph** — `docs/superpowers/specs/2026-04-19-relationship-graph-spec.md` (pending write)
- [x] **Spec 6/6: Blind Index Search** — `docs/superpowers/specs/2026-04-19-blind-index-search-spec.md` — DONE. Enables server-side filtering of encrypted entity field values via client-computed HMAC-SHA256 blind indexes. Hub-derived per-field keys, dedicated `bi_*` DB columns, crypto worker extension, hybrid server/client search UI.

## Comprehensive Audit (2026-04-02)

> Specs and plans created from full codebase audit. Organized by priority.

### Critical Bug Fixes
**Spec:** `docs/superpowers/specs/2026-04-02-critical-bug-fixes.md` | **Plan:** `docs/superpowers/plans/2026-04-02-critical-bug-fixes.md`

- [x] **TwiML callback URLs use wrong prefix** — Fixed 2026-04-02: global find-replace `/api/telephony/` → `/telephony/` across 19 files (adapters, capabilities, provider-setup, tests, UI). **Live Twilio testing available via `playwright.live.ts`.**
- [x] **Unknown API routes return 401 instead of 404** — Fixed 2026-04-02: prefix-checking middleware in app.ts. E2E test: `tests/api/route-404.spec.ts`.
- [x] ~~**Dashboard incoming calls require Nostr relay**~~ — Investigated: REST polling fallback already exists at 30s intervals (`src/client/lib/queries/calls.ts:87-112`). No additional work needed.
- [x] **CAPTCHA retry** — Verified 2026-04-02: service layer correctly implements retry. Test 5.4 is active (no test.fixme) and validates behavior.

### Schema Alignment & API Validation
**Spec:** `docs/superpowers/specs/2026-04-02-schema-alignment-api-validation.md` | **Plan:** `docs/superpowers/plans/2026-04-02-schema-alignment-api-validation.md`

- [x] **Auth facade Zod validation** — Fixed 2026-04-02: 4 endpoints now use Zod safeParse.
- [x] **Blast schema alignment** — Fixed 2026-04-02: schema rewritten to match DB structure.
- [x] **CallLeg field mismatch** — Fixed 2026-04-02: renamed to userPubkey, added type field.
- [x] **Other field mismatches** — Fixed 2026-04-02: conversations reportTypeId added.
- [ ] **Missing OpenAPI documentation** — 19 endpoints bypass `createRoute()` (low priority).

### Test Coverage Hardening
**Spec:** `docs/superpowers/specs/2026-04-02-test-coverage-hardening.md` | **Plan:** `docs/superpowers/plans/2026-04-02-test-coverage-hardening.md`

- [x] **Fix known failing tests** — Fixed 2026-04-02: roles.spec.ts (Authentik enrollment), hub-access-control (NSEC auth).
- [x] **Service unit tests** — API E2E tests for calls, shifts, GDPR services added 2026-04-03.
- [x] **Security module tests** — SSRF guard (36), auth middleware (7), retention purge (3) added 2026-04-02.
- [x] **Messaging adapter tests** — All 6 channels tested: SMS (Twilio/Vonage/Plivo/SignalWire/Telnyx), WhatsApp, Signal, RCS, Telegram. 245+ tests.
- [x] **Telephony adapter tests** — All 8 adapters tested: Twilio (10), Telnyx (54), Bandwidth (36), WebRTC tokens (30), test adapter, provider capabilities. 130+ tests.

### Infrastructure & DevOps Hardening
**Spec:** `docs/superpowers/specs/2026-04-02-infrastructure-devops-hardening.md` | **Plan:** `docs/superpowers/plans/2026-04-02-infrastructure-devops-hardening.md`

- [x] **RustFS blob storage not backed up** — Fixed 2026-04-02: backup pipeline includes RustFS via mc/rclone.
- [x] **No backup failure alerting** — Fixed 2026-04-02: backup age/size metrics in Prometheus endpoint.
- [x] **Image digest pinning** — Fixed 2026-04-02: Authentik, RustFS, strfry pinned.
- [x] **Prometheus alerting rules** — Fixed 2026-04-02: HTTP metrics middleware + backup gauges added.
- [x] **Watchtower safeguards** — Fixed 2026-04-02: scheduled 04:00 UTC, notification URL support.

### Code Organization & Refactoring
**Spec:** `docs/superpowers/specs/2026-04-02-code-organization-refactoring.md` | **Plan:** `docs/superpowers/plans/2026-04-02-code-organization-refactoring.md`

- [x] **Split api.ts** — 2,325 lines → 24 domain modules. Backwards-compatible re-export.
- [x] **Split settings.ts service** — 1,439 lines → 11 domain services.
- [x] **Split contacts.ts route** — 1,231 lines → 7 sub-route modules.
- [x] **Split server types.ts** — 988 lines → 11 domain type files.
- [x] **Migrate decryptHubField** — 34 calls migrated from components to React Query queryFn.
- [x] **Console.log cleanup** — 18 debug logs → dev-only createDebugLog() wrapper.

### Incomplete Adapter Completion
**Spec:** `docs/superpowers/specs/2026-04-02-adapter-completion.md` | **Plan:** `docs/superpowers/plans/2026-04-02-adapter-completion.md`

- [x] **Telnyx telephony adapter** — Complete: `src/server/telephony/telnyx.ts` implements all 23 TelephonyAdapter methods (TeXML IVR, Call Control API, webhook verification, recording API). Tests: `telnyx.test.ts`, `telnyx-api.test.ts`.
- [x] **Telnyx SMS adapter** — Complete: `src/server/messaging/sms/telnyx.ts` implements `MessagingAdapter` with Telnyx JSON webhook parsing, wired into factory at `src/server/messaging/sms/factory.ts:87-92`. Tests: `telnyx.test.ts`.
- [x] **SignalWire WebRTC tokens** — Complete: `generateSignalWireToken()` in `src/server/telephony/webrtc-tokens.ts` with HS256 JWT + Voice grant (Twilio-compatible), `isWebRtcConfigured()` guard on `webrtcEnabled` + `apiKeySid` + `apiKeySecret` + `twimlAppSid`.
- [x] **Vonage webhook verification** — Complete: `VonageAdapter.verifyWebhookConfig()` in `src/server/telephony/vonage.ts:631` queries `GET /v2/applications/{id}` with RS256 JWT minted via `signApplicationJwt()`, compares `capabilities.voice.webhooks.answer_url` against expected base URL.
- [x] **Telnyx WebRTC token generation** — Done in PR #98: `generateTelnyxToken()` in `src/server/telephony/webrtc-tokens.ts` uses Telnyx's two-step Telephony Credential flow (`POST /v2/telephony_credentials` with `connection_id`, then `POST /v2/telephony_credentials/{id}/token` for the login JWT). Optional `sipConnectionId` + `webrtcEnabled` fields added to `TelnyxConfigSchema`; `isWebRtcConfigured()` enforces both at runtime. 8 new tests via scoped fetch stub (`webrtc-tokens.test.ts`).
- [ ] **Bandwidth WebRTC token generation** — `src/server/telephony/webrtc-tokens.ts:36` still throws. Bandwidth schema already has `webrtcEnabled`; needs Bandwidth Voice SDK JWT mint.

## Deferred from User Security & Device Management (2026-04-04)
Spec: `docs/superpowers/specs/2026-04-04-user-security-device-management-design.md` (pending)

These items were identified during brainstorming but deferred as follow-up efforts — each adds meaningful architecture expansion beyond the core Security page v1:

- [ ] **WebAuthn-as-KEK-factor add/remove** — Add/remove WebAuthn as a KEK factor (distinct from passkey-as-login-credential). Requires re-wrapping KEK when factor set changes. key-store-v2 already supports 3-factor PRF mode so plumbing exists; needs UX + rotation flow.
- [ ] **Trusted browser / "remember this device"** — Per-session trust marking with different TTLs for trusted vs. untrusted sessions. Cuts across login flow + session UI. Depends on sessions table landing first.
- [ ] **Step-up re-auth for sensitive actions** — Re-tap passkey (or re-enter PIN) before admin operations. Requires tagging sensitive endpoints + freshness claim on tokens + UX interruption pattern. Cross-cutting.

## Dedupe section-layout primitives (2026-04-05)

- [x] **Dedupe user-shell + admin-shell `section-layout.tsx`** — Done: moved primitives to `src/client/components/section-layout/`, with a `surface: 'admin' | 'user'` prop on `SectionBody`/`SectionDescription`/`SectionActions` to preserve each surface's distinct visual rhythm and testid prefix. `saveButtonTestId` legacy override retained. 19 unit tests cover both surfaces. Old duplicates deleted.
