# Post-Overhaul Gaps — 2026-04-13

Audit of outstanding work after the 7-tier security overhaul landed on `main`
(through PR #104, `v0.48.2`). Every tier shipped a PR that landed its core
skeleton, but several tiers deferred follow-up items to later sessions. This
document catalogs those deferrals, groups them by tier, and prioritizes them
against the current top-level directives (no feature flags, MLS replaces HPKE
for messages/notes as a clean cut, no dual code paths).

Sources:

- `~/tier-carry-forward/tier-{1..7}-notes.md` — per-tier carry-forward notes
- `docs/security/TIER_{0..6}_POST_REVIEW.md` — in-tree post-review summaries
- `~/tier-overnight-status/review-tier{0..6}.status` — overnight review status
- Direct grep for `TODO(tier-...)` markers in `src/`

## Top-level directive recap

These override anything in the original tier plans:

1. **No feature flags.** `VITE_LLAMENOS_MLS_ENABLED` was removed in PR #104.
   No new gating mechanism may be introduced for MLS or anything else.
2. **MLS replaces HPKE for the message/note application layer.** Clean cut,
   not coexistence. The HPKE primitives (`hpkeSeal`/`hpkeOpen`, `EnvelopeV3`)
   remain for other surfaces (hub-field encryption, session capsule wrapping,
   device enrollment, file encryption, provisioning), but note/message
   encryption moves fully to MLS group state.
3. **No dual code paths.** `if (mlsReady) else (hpke)` patterns are forbidden.
   Group readiness becomes a hard precondition, not a fallback.
4. **Group bootstrap is part of hub creation**, not lazy. A hub without an MLS
   group is unusable. Devices without a Welcome cannot read or write.
5. **Pre-production policy.** No data-migration paths for existing encrypted
   data. Wipe-if-unreadable is acceptable.

## State of the MLS skeleton on `main`

- `src/client/lib/mls/core-crypto-loader.ts` — lazy WASM loader. Throws on
  module load failure. Previously had an `if (MLS_ENABLED)` gate; flag removed
  in PR #104. Always usable.
- `src/client/lib/mls/conversation.ts` — **empty class with a private
  constructor**. No methods. No fields. This is the primary gap.
- `src/client/lib/mls/sas.ts`, `sas.test.ts`, `emoji-table.ts`,
  `emoji-table.test.ts` — SAS derivation (used by fingerprint UX from Tier 6
  PR #1). Functional, deterministic, unit-tested.
- `vendor/@wireapp/core-crypto/` — vendored `@wireapp/core-crypto@9.3.3`,
  `file:` dep in `package.json`.
- No server routes for MLS key-package publication, Welcome distribution,
  commit application, or epoch storage.
- No Drizzle migrations for `mls_hub_state`, `mls_key_packages`, or
  `hubs.tier6_enabled`/`cs_profile` columns.
- No MLS client initialization anywhere in SPA boot.

## Current encryption paths for messages/notes

The narrative "MLS replaces HPKE" is slightly off w.r.t. the note/message
layer specifically:

- **Hub fields** (role names, shift names, report type names, etc.) —
  migrated to HPKE v3 (`hpkeSeal`/`hpkeOpen`) in Tier 1.
- **Notes** (`encryptNote` in `src/shared/crypto-envelopes.ts`) — **still
  ECIES + XChaCha20-Poly1305**. Per-note random key, wrapped via
  `eciesWrapKey(noteKey, adminPubkey, LABEL_NOTE_KEY)` for the author + every
  admin (multi-admin envelopes).
- **Messages** (`encryptMessage` in `src/shared/crypto-envelopes.ts`) — same
  pattern, `LABEL_MESSAGE`. Used for SMS/WhatsApp/Signal/web report message
  bodies.
- **Blasts** (`encryptBlastContent`) — same pattern, `LABEL_BLAST_CONTENT`.

So the Tier 6 PR #2 directive effectively asks to replace the legacy ECIES
envelope pattern for notes + messages with MLS groupwise encryption, and
delete the multi-admin recipient-envelope loop. Blasts are NOT in scope (they
target external recipients who are not hub members).

## Tier 1

Status: HPKE primitives + hub-field call sites migrated. Deferred items
persist. Source: `tier-carry-forward/tier-2-notes.md`.

### P0

- **ECIES/XChaCha20 sidecar removal from `crypto-worker.ts`.** The worker
  still exposes the legacy surface (`encrypt`, `decrypt`, `reEncrypt`,
  `provisionNsec`, `decryptEnvelopeField`, `envelopeEncryptField`, old
  `importSession`/`exportSession`). Each callers-list below must migrate before
  the sidecar can be deleted:
  - `file-crypto.ts` — HPKE single-shot per-file keys + AES-GCM bodies.
  - `hub-key-manager.ts` — hub key distribution via HPKE per-recipient, with
    the server `HpkeService` as a recipient for re-wrap-on-membership-change.
  - `provisioning.ts` — device linking → non-extractable `CryptoKey` handles.
  - `signal-contact` + envelope-encrypted PII.
  - `key-store-v2.ts` → delete.

### P1

- **Per-record AAD migration for envelope-encrypted PII.** Columns on
  `contacts`, `user_signal_contacts`, `conversations`, `call_records`, `bans`
  still use label-only AAD. Wire-format break scheduled. Plumb `recordId +
  fieldName` through `decryptObjectFields` / `decryptArrayFields` /
  `resolveEncryptedFields`. Bundled with next wipe migration.
- **Server note/file envelope paths.** Notes and files are still
  server-encrypted via the legacy `CryptoService` XChaCha20-Poly1305 primitive.
  Convert to `EnvelopeV3` bodies with `buildAad(label, recordId, fieldName)`.
  *Superseded for notes by Tier 6 PR #2 below (notes move to MLS, not
  envelope-v3).* Files keep the envelope-v3 path.
- **Worker-boundary AAD propagation.** `cryptoWorker.encrypt` /
  `cryptoWorker.decrypt` do not forward caller-supplied AAD into the inner
  AEAD. Add an `aad: Uint8Array` parameter, marshal across postMessage, thread
  into XChaCha20-Poly1305, update every call site.
- **CSP-report XFF trust.** Conditional on Caddy. Add `TRUSTED_PROXY_CIDRS`
  allowlist with `x-real-ip` fallback. Deployment note in
  `docs/security/DEPLOYMENT_HARDENING.md`.
- **Signed audit chain alerting.** Emit `security.audit_chain_conflict`
  structured log event (hub_id, caller pubkey, conflicting constraint).

### P2

- `eciesUnwrapKeyWithSecret` test-only exposure — move to `test-only` entry.
- `createHTML` Trusted Types policy pushback — document named-sanitizer
  pattern in `docs/security/THREAT_MODEL.md`.
- `audit-log-client.test.ts` mock leakage lint/helper.

## Tier 2

Status: `key-store-v3` with PBKDF2 + PIN landed. Multi-factor deferred.
Source: `tier-carry-forward/tier-3-notes.md`.

### P0

- **Multi-factor KEK on `key-store-v3`.** Tier 2 shipped PBKDF2-SHA256 (600k)
  over a PIN only. Recovery key + WebAuthn deferred. Match
  `key-store-v2`'s multi-factor semantics before deleting v2.
- **Recovery group share HPKE wrapping.**
  `recovery-group-section.tsx:34-39` sends raw Shamir shares as hex
  plaintext. Must be HPKE-wrapped per admin pubkey via `HpkeService`.
- **`newBundle` schema in `RecoveryCompleteSchema`.**
  `src/shared/schemas/recovery-group.ts:84` is `z.unknown()`. Replace with
  `RootKekEnvelopeBundleSchema`. This is a security-critical validation gap.
- **Unauthenticated recovery endpoints.**
  - `GET /recovery-group/:hubId` leaks group config.
  - `GET /recovery-group/session/:id` leaks session status.
  - `POST /recovery-group/initiate` has no rate limiting.
  Add jwtAuth or session-specific bearer tokens + rate limiting on initiate.

### P1

- **Recovery group routes → OpenAPIHono.** 7 endpoints in
  `src/server/routes/recovery-group.ts` use plain `Hono` with
  manual `c.req.json()` + `safeParse`. Migrate to `createRoute` +
  `.openapi` + `c.req.valid(...)`.
- **DB schema hardening.** Missing
  `CHECK (threshold <= total_shares)` on `hub_recovery_groups`. Missing FKs
  on `hub_recovery_group_shares.hub_id → hub_recovery_groups.hub_id ON DELETE
  CASCADE`.
- **OPAQUE route error handling.** Four handlers in
  `src/server/routes/opaque.ts` lack try/catch; WASM/DB/input failures
  propagate as raw 500s with no structured error codes.
- **Login state cache size limit.** `login-state-cache.ts` — no max size;
  sustained flood of `*_start` without matching `*_finish` can exhaust server
  memory. Add a cap (e.g., 10k entries) with 429 rejection.
- **AES-KW unwrap error specificity.** `crypto-worker.ts:740-764` collapses
  wrong-password / corrupted-envelope / salt-mismatch into generic
  `OperationError`. Wrap and rethrow with context.
- **IDB unavailability handling.** `root-kek-store.ts:51-59` raw
  `DOMException` on `openDB`. Wrap in a descriptive error.

### P2

- Branded types for crypto key material (`OpaqueExportKey`, `ShamirShare`,
  `RecoveryPhraseKekBytes`).
- `convenience-pin.ts` `loadState` zod validation of `PinState`.
- `RecoveryGroupEnrollSchema.refine(...)` cross-validation of share lengths.
- Adversarial Shamir tests (2-of-3 fails, tampered-share detection,
  end-to-end split/combine).
- Key-material zeroing tests.
- `PrfUnsupportedError` fallback test.
- Recovery group i18n translation for 33 keys across 22 locales.

## Tier 3

Status: Per-device keys + sigchain landed. Verifier bindings deferred.
Source: `tier-carry-forward/tier-4-notes.md`.

### P0

- **`device_cross_sign` verifier does not verify inner signature.**
  `user-sigchain-verifier.ts:269-273` — only checks outer sigchain signer is
  in the verified set. Does NOT verify inner Ed25519 cross-sig against the
  self-signing pubkey. Attacker with valid device key can record a
  cross-sign claim without performing the operation.
- **`verifyTransitiveTrust` missing derivation binding.**
  `cross-signing.ts:317-348` verifies cross-sign of master pubkey + self-sign
  of device pubkey, but never checks that `candidateSelfSigningPub` is HMAC-
  derived from `candidateMasterPub`. Attacker can substitute an unrelated
  self-signing key.
- **Recovery service participant deduplication + share storage.**
  `recovery-service.ts` `addParticipant` has no dedup — same admin can call
  repeatedly to meet threshold alone. `sharePayload` accepted but never
  stored. Needs a `recovery_participants` junction table with
  `UNIQUE(recovery_request_id, participant_user_id)`.

### P1

- **Key-store-v3 ↔ root KEK integration.** Root KEK bundle wraps a standalone
  AES-KW key but does not yet wrap identity bytes or hub `CryptoKey`.
  Prerequisite for deleting `key-store-v2`.
- **Missing FK constraints.** `hub_ptk_generations`, `hub_key_envelopes` —
  no FK to `hubs` or `user_devices`. New migration with `ON DELETE CASCADE`.
- **Sigchain API payload schema tightening.** `FinalizeEnrollmentRequestSchema`
  + `RevokeDeviceRequestSchema` use `payload: z.record(z.string(), z.unknown())`.
  Tighten to discriminated unions.
- **Hub key cache silent error swallowing.** `hub-key-cache.ts:77-95` bare
  `catch {}` — add `console.error` with hubId + error type.
- **`decryptFromHub` null-return masks tampering.** `hub-key-manager.ts:71-81`
  returns `null` for wrong key AND tampered ciphertext AND AAD mismatch. Use
  a discriminated error return.

### P2

- Branded `SigningPubkey`, `EncryptionPubkey`, `PukSeed`, `MasterSeed`,
  `HubKey`.
- DRY crypto utility helpers into `webcrypto-import.ts`.
- Discriminated-union state for `device-enrollment.ts`.
- `_testOnlySeed` production guard.
- Sigchain adversarial tests (duplicate, forked, out-of-order).
- Cross-signature derivation-binding test, PUK envelope AAD boundary test,
  paper key 12-word rejection, hub key rotation walk E2E test.

## Tier 4

Status: Binary verifier + gossip version + sandbox iframe shipped, but not
wired into SPA boot. Source: `tier-carry-forward/tier-5-notes.md`.

### P0

- **Wire PR-C into SPA boot.** `verifyOrThrow` in `binary-verifier.ts` has
  **no caller in `src/client/main.tsx`**. A user who ships a compromised
  bundle boots and unlocks normally — the fail-closed guarantee never runs.
  Three sub-items:
  1. Ship `/api/releases/latest/manifest` server route returning a
     `SignedReleaseManifest`. Public, no auth, blob-backed.
  2. Extend the manifest to include the `dist/crypto-sandbox/` bundle
     (currently cross-origin and not enumerated by `listLoadedResources`).
  3. Call `verifyOrThrow` before any decryption or unlock; route
     `VerifierFailure` to a bricked-screen error boundary.
- **Wire `GossipVersionClient`.** No caller today. Fleet divergence detection
  is observational only until this runs.
- **Fix sandbox iframe opaque-origin postMessage breakage.**
  `bootRealIframe()` sets `sandbox="allow-scripts"` with no `allow-same-
  origin`. Both sides see `ev.origin === "null"`; origin checks drop every
  message — the channel is silently broken in production today. Pick Option
  A (accept opaque origin + nonce HMAC) / B (drop sandbox attr) / C (add
  `allow-same-origin`). Document the choice + enforce via a Playwright
  round-trip test (`tests/ui/crypto-sandbox-real-boot.spec.ts`).

### P1

- **`bootCryptoSandbox()` unhandled-rejection path.** Throws on timeout and
  Trusted Types install failure, but nothing awaits the rejection. Surface
  to the error boundary path from `main.tsx`.
- **Sign the warrant canary.** Today `docs/security/WARRANT_CANARY.md` is
  plaintext markdown. Ed25519-sign at publication time, ship `.sig`
  alongside, pin the pubkey in-bundle. Unsigned canary is meaningless.
- **Migrate `auth.ts` / `invites.ts` to `cookies.ts` helpers.** Two cookies
  with the same name but different `Domain` / `Secure` attributes cause
  silent session confusion. Thread `ENVIRONMENT` through `baseOptions()` so
  `secure` becomes conditional in dev.
- **Whitepaper accuracy rewrite.** `WHITEPAPER.md` claims HPKE + Argon2id
  + all crypto in iframe sandbox. Reality: notes/messages still ECIES, KDF
  still PBKDF2, sandbox is non-load-bearing. Add a "Current vs Target"
  section that is unambiguous.

### P2

- Remove `iframe.setAttribute('allow', 'cross-origin-isolated')` (not a valid
  feature token).
- `gossip-version.ts` destroy path: `secretKey.fill(0)` before release.
- CORS middleware: stop reading `process.env` directly; cache allowed origins
  (rebuilds per-request today).
- `getNsecSecret` silent-catch — distinguish "user not enrolled" from
  "IdP unreachable" to avoid KEK derivation input drift during outages.
- Gossip `handleEvent` drop-with-zero-logging paths.
- `RpcResultMap` type linking op→result shape for crypto-rpc.
- Branded `Origin` type; `ValidOrigin` rejecting empty strings.
- Integration test for postMessage iframe round-trip.
- Binary verifier: enumerate `<link rel="modulepreload">` chunks.
- Gossip `as GossipNostrEvent` cast → `GossipNostrEventSchema.parse()`.
- Create stubs for 5 referenced-but-missing docs: `SECURITY_TEAM.md`,
  `WARRANT_CANARY_RUNBOOK.md`, `scripts/verify-canary.sh`, `VERIFIER_MOU.md`,
  `VOLUNTEER_BRIEFING.md`.
- Ansible legacy `register:` var renames + `no-changed-when` cleanup in
  `luks.yml`.

## Tier 5

Status: SFrame + voice-E2EE skeleton landed, but nothing wires the hooks into
the live adapters. Source: `tier-carry-forward/tier-6-notes.md`.

### P0

- **Wire SFrame into the live call flow.**
  - `src/client/lib/webrtc/manager.ts:46-55`: adapters constructed without
    `sframeHook`. Thread `getSFrameWorker()` + `SFramePeerConnectionHook`
    through.
  - `ActiveCallBadge` + `E2eeFallbackBanner` defined/tested but never
    imported by the call overlay. Wire into the call route.
  - Vonage + Plivo: `#installHook` defined but never called (SDK pc accessor
    TODOs at `TODO(tier-5)` in `vonage.ts:48` and `plivo.ts:58`). When a
    hook is provided but pc is inaccessible, emit error + refuse call.
- **Worker error notification mechanism.** `sframe-worker.ts:273-276,283`
  drops frame decrypt errors silently. Post a
  `{ type: 'sframe_degraded', callId, errorRate }` message when consecutive
  errors > 5 or rate > 10% over 5s. Surface to `ActiveCallBadge`.

### P1

- **SFrame worker client RPC timeout.**
  `sframe-worker-client.ts:91-97` — `call()` promises never resolve if worker
  hangs. Add configurable timeout (default 5s) rejecting with
  `SFrameWorkerError('worker_not_ready')`.
- **Twilio adapter pc access failure.** `twilio.ts:55-60,148-150` — emit
  error when pc is null at either check point.
- **Audit entry variants.** `call_e2ee_state_change` +
  `call_sframe_key_rotation` payloads in the hash-chained audit log service.
- **Fallback modal unmounting defense.** If the parent unmounts
  `E2eeFallbackBanner` without a decision, default to "cancel" (fail-closed).

### P2

- Type system improvements: brand `CallSecret` / `BaseKeyMaterial` /
  `CryptoKey`; accept `PlaintextBytes` in `sealFrame`; validate worker
  messages via `SFrameWorkerRequestSchema.parse`; remove `as CryptoLabel`
  casts on `LABEL_SFRAME_BASE_KEY`/`LABEL_SFRAME_RATCHET`.
- Docs: fallback is a modal not a banner; Chrome 100+ for
  `RTCRtpScriptTransform`; fix `buildAad` comment signature;
  expand workstream references.
- Test gaps: worker `TransformStream` pipeline, DTLS fingerprint mismatch
  integration, key-distribution end-to-end, fallback banner integration,
  5/6 UI E2E files are skip-gated stubs, worker rotation lifecycle.

## Tier 6

Status: PR #1 (fingerprint UX + vendored core-crypto skeleton + feature flag)
landed. PR #2 (MLS code path wiring) is the primary gap this session tackles
first. Source: `tier-carry-forward/tier-7-notes.md` + `tier-6-notes.md`.

### P0 — this session scope (Tier 6 PR #2, redefined)

Under the new directives (no flag, MLS replaces HPKE message/note paths, no
dual path, hub-creation bootstraps the group), PR #2 has this scope:

1. **Core-crypto client bootstrap.** Initialize `@wireapp/core-crypto` in a
   dedicated worker (or extend the existing crypto-worker). Produce + persist
   the MLS client identity keypair. Load the vendored WASM from
   `vendor/@wireapp/core-crypto`.
2. **`MlsConversation` real implementation.** Replace the empty class with
   createGroup / addMembers / removeMembers / encryptMessage / decryptMessage
   / processWelcome / currentEpoch. Thin wrapper over core-crypto.
3. **DB schema.** `mls_hub_state` + `mls_key_packages` tables. New column
   `hubs.cs_profile` (`standard`|`high`). No `tier6_enabled` column —
   everything is enabled. Drop the old note encryption columns in the same
   migration or the next migration.
4. **Server routes.** Key-package publication + consumption; Welcome message
   fan-out via provisioning / sigchain channels; commit storage + ordered
   fetch; epoch advancement.
5. **Hub creation bootstrap.** Establishing the MLS group is part of the hub
   create mutation. Blocking — if the group cannot be established, the hub
   is not created. Admins auto-join. Device enrollment via Welcome.
6. **Notes path cutover.** Replace `encryptNote` / `decryptNoteWithKey` +
   the `adminEnvelopes` multi-admin loop with MLS `encryptMessage` /
   `decryptMessage` against the hub's notes group. Delete the multi-admin
   envelope logic. Delete legacy call sites.
7. **Messages path cutover.** Replace `encryptMessage` /
   `EncryptedMessagePayload` in `crypto-envelopes.ts` with MLS equivalents.
   SMS / WhatsApp / Signal inbound webhooks land plaintext → MLS-encrypt →
   discard plaintext.
8. **Epoch commits for admin add/remove.** Replace hub-key rotation with MLS
   epoch advance on membership change.
9. **Audit payload variants.** `mls_group_init`, `mls_members_added`,
   `mls_members_removed`, `mls_path_update`, `mls_epoch_purge`,
   `mls_ciphersuite_upgrade_planned`, `mls_ciphersuite_upgrade_completed`.
10. **Tests.** Round-trip encrypt/decrypt; 3+ device sync via Welcome;
    adversarial (wrong epoch, missing commit, replay, stale device); admin
    rotation via epoch advance.
11. **Docs update.** `HPKE_MIGRATION_NOTES.md` (what stays HPKE, what moves
    to MLS), `WHITEPAPER.md` "Current vs Target" section, `AEAD_AUDIT_…`
    reflects the note/message AEAD changes.

### P1 — Tier 6 PR #1 follow-ups (`tier-carry-forward/tier-7-notes.md`)

- **SAS derivation should bind both parties.** `sas.ts` derives from target
  pubkey only. Attacker who knows the pubkey pre-computes the SAS. Follow
  `LABEL_DEVICE_ENROLLMENT_SAS` pattern (both pubkeys + nonce).
- **`Device` shared Zod schema.** `devices-section.tsx` duplicates a local
  type. Move to `src/shared/schemas/devices.ts` + `z.infer<>`.
- **Devices query key classification.** `['hub', currentHubId, 'devices']`
  bypasses `ENCRYPTED_QUERY_KEYS` / `PLAINTEXT_QUERY_KEYS` exhaustiveness.
- **Device verification route to `createRoute()` + OpenAPI.**
- **SAS known-answer test vector.**
- **Device fingerprint UI E2E tests** are 5/6 skip-gated on fixture data.
- **`loadCoreCrypto` success path untested.**
- **`deriveSasEmoji` / `deriveSasNamesEn` → 7-tuple return types.**
- **Permission refinement: `audit:write` permission for write operations.**
- **Audit chain error path untested.**

## Cross-tier

- **Test-infra CI failures.** `global-setup.ts → bootstrap admin
  locator.waitFor timeout` is a long-standing infra flake blocking CI
  verification across multiple recent PRs. Tracked at
  `~/tier-carry-forward/test-infra-ci-failures.md`. Diagnose + fix before
  large merges can be verified.
- **Pre-existing unit test failures.** `panic-wipe.test.ts`
  (`cryptoWorker.lock` undefined in suite), `recovery-phrase.test.ts` (mock
  leakage in suite), DB-dependent unit tests that need postgres.
- **Bun `mock.module` cross-file leakage.** `audit-log-client.test.ts` +
  `unlock-factors.test.ts` both hit this. Helper + lint rule.

## Prioritization

### P0 (must do — security-load-bearing or blocks a verified promise)

| Tier | Item | Reason |
|------|------|--------|
| 6 | PR #2 MLS code path wiring (notes + messages cutover) | Top-level directive, this session |
| 1 | ECIES sidecar removal from crypto-worker | Blocks key-store-v2 deletion, blocks sidecar cleanup |
| 2 | Multi-factor KEK on key-store-v3 | Recovery / WebAuthn unlock broken without it |
| 2 | Recovery group share HPKE wrapping | Raw plaintext shares on the wire today |
| 2 | `newBundle` schema validation in recovery-complete | Arbitrary data acceptance at a security-critical endpoint |
| 2 | Recovery endpoints unauthenticated + no rate limit | Config leak + flood risk |
| 3 | `device_cross_sign` inner signature verification | Verifier gap → impersonation |
| 3 | `verifyTransitiveTrust` derivation binding | Verifier gap → key substitution |
| 3 | Recovery-participant dedup + share storage | One admin can meet threshold alone |
| 4 | Wire binary verifier + gossip into SPA boot | Fail-closed promise never runs |
| 4 | Sandbox iframe opaque-origin postMessage | Channel silently broken in prod today |
| 5 | SFrame call-flow wiring (adapters + UI + Vonage/Plivo fail-loud) | "E2EE calls" promise not kept |
| 5 | Worker error notification | Silent audio dropout |

### P1 (important — should ship this session if P0 finishes)

| Tier | Item |
|------|------|
| 1 | Worker-boundary AAD propagation |
| 1 | Per-record AAD migration (contacts, conversations, bans, call_records) |
| 2 | Recovery routes → OpenAPIHono |
| 2 | OPAQUE route error handling |
| 2 | Login state cache size limit |
| 3 | Key-store-v3 ↔ root KEK integration |
| 3 | FK constraints on Tier 3 tables |
| 4 | `bootCryptoSandbox` error boundary |
| 4 | `auth.ts`/`invites.ts` → `cookies.ts` migration |
| 4 | Warrant canary signing |
| 4 | Whitepaper "Current vs Target" rewrite |
| 5 | SFrame worker RPC timeout |
| 5 | Audit entry variants for call E2EE |
| 6 | SAS binds both parties |

### P2 (nice-to-have — document for follow-up)

All branded-type work, comment corrections, test gaps, Ansible lint cleanups,
doc stubs, minor schema hardening. Full list per tier above.

## Session execution plan

1. **This doc** — commit on `docs/post-overhaul-gaps-audit`, open PR for
   visibility.
2. **Tier 6 PR #2** — fresh worktree
   `llamenos-hotline-tier-6-pr2`, branch `feat/sec-tier-6-pr2-mls-wiring`.
   Scope as above. Target 1 PR, multiple commits per scope item.
3. **P0 work-through** — cherry-pick from the P0 table, one PR per logical
   item.
4. **P1 work-through** — same.

Anything not finished this session is carried forward in a
`post-overhaul-gaps-2026-04-13.status` file with explicit hand-off notes.
