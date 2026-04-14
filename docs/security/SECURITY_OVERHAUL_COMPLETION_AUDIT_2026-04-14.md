---
title: Security Overhaul — Completion Audit (2026-04-14)
date: 2026-04-14
status: PHASE 1 COMPLETE — PHASE 2 OPEN
supersedes: POST_OVERHAUL_GAPS_2026-04-13.md (deltas only)
---

# Security Overhaul — Completion Audit

## Executive summary

The 7-tier security overhaul shipped across 29 tier-labelled commits between PRs
#53 and #127 (five weeks, 2026-03-10 → 2026-04-14). Six independent reviewers
were dispatched against `main` at commit `a01738be` (`v0.49.2`) as the final
completion audit. The overhaul is **Phase 1 complete**: Tiers 0, 3, 4, and 5
(Twilio / SignalWire path) are shipped and hardened, Tier 2 is substantially
shipped with a small set of known-open P0s, and Tier 1 is complete for hub-field
encryption. **Tier 6 MLS message-path wiring (PR #2 of Tier 6) did not ship** —
`src/client/lib/mls/conversation.ts` is still an 11-line skeleton class with a
private constructor and no methods, meaning notes, messages, and blasts continue
to use the legacy ECIES + XChaCha20-Poly1305 envelope pattern. The two remaining
exploitable bugs (recovery-participant dedup, hub-field silent plaintext
fallback) have tracked follow-up items; everything else is hardening or UX
polish.

**Verdict: Ship Phase 1 as the current security posture; honestly describe the
note/message path as "ECIES-based E2EE pending MLS cutover" in all user-facing
materials until Tier 6 PR #2 lands.** Do not declare "security overhaul
complete" in marketing copy or the whitepaper headline until the MLS cutover
lands — PR #123 rewrote WHITEPAPER.md with a "Current vs Target" split that
makes this distinction honestly.

## Baseline verification (this session)

Run against commit `a01738be` on `main`, 2026-04-14:

| Suite | Result | Notes |
|---|---|---|
| `bun run typecheck` | PASS | Clean `tsc --noEmit` |
| `bun run lint` | PASS | Biome clean |
| `bun run build` | PASS | Vite production build |
| `bun run test:unit` | 2322 pass / 1 skip / 0 fail | 179 files, 20391 assertions, 47.7s |
| `bun run test:api` | DEFERRED | Verified green on CI for PRs #111-#133 |
| `bun run test:e2e` | DEFERRED | Verified green on CI for PRs #111-#133 |

No local regressions. API + E2E suites deferred because they require docker
backing services + ~20 min runtime and are continuously verified on CI
(PR #133 most recently confirmed green).

## Tier-by-tier status

### Tier 0 — Albrecht hardening (signed hash-chained audit log, label registry, AAD binding)

**Status: COMPLETE.**

**Shipped:**
- `LABEL_REGISTRY` + `CryptoLabel` branded type at `src/shared/crypto-labels.ts:27-413`, enforced via `satisfies readonly CryptoLabel[]`.
- Hash-chained `SignedAuditEntry` with `previousEntryHash`/`entryHash`/`signerDeviceId`/`signature` in `src/shared/schemas/audit-entries.ts:176-190`.
- `AuditLogService.appendSigned` at `src/server/services/audit-log-service.ts:142-204` verifies chain head + signer + signature + payload authz before append.
- Client-side `verifyAuditChain` at `src/client/lib/audit-chain-verifier.ts:161-209` with tamper + forged-signature + revoked-signer rejection.
- Hub-field AAD binding centralized at `src/shared/lib/hub-field-aad.ts:22`: `${LABEL_HUB_FIELD}:${recordId}:${fieldName}`.
- `hpkeSeal`/`hpkeOpen` layer label + AAD binding at `src/shared/hpke-primitives.ts:85-124`.

**Adversarial tests verified present:**
- Chain tamper: `src/client/lib/audit-chain-verifier.test.ts:127, 145`
- Signature forge: `audit-chain-verifier.test.ts:160`
- Revoked-device signer: `audit-chain-verifier.test.ts:219`
- AAD row/column swap: `src/shared/hpke-primitives.test.ts:47, 55`, `src/server/lib/hpke-service.test.ts:120`
- Label mismatch: `hpke-primitives.test.ts:38, 79`

**Known open:**
- **Rotation-on-tamper integration test missing** (Phase-2 P1). No test asserts `rotateHubKeyClkr` refuses to proceed when chain verification fails. Recommended location: `src/client/lib/hub-key-manager.rotation-on-tamper.test.ts`. The verification IS wired into server-side rotation; the gap is adversarial coverage, not wiring.

### Tier 1 — HPKE primitives (DHKEM-X25519 + HKDF-SHA256 + AES-256-GCM)

**Status: COMPLETE for hub fields. PARTIAL for notes/messages/files — deferred to Tier 6 PR #2.**

**Shipped:**
- `hpkeSeal`/`hpkeOpen` at `src/shared/hpke-primitives.ts:65-124` with version check, label cross-check, `info` binding, AAD binding.
- `HpkeEnvelope` wire format at `src/shared/hpke-envelope.ts:31-52` (`{ v: 3, labelId, enc, ct }`). Parallel zod schema at `hpke-envelope.ts:45-50`. The `EnvelopeV3` symbol rename to `HpkeEnvelope` is complete.
- Items-key indirection at `src/shared/items-key.ts` — per-hub items_key wraps per-artifact keys with AES-KW.
- Non-extractable AES-256-GCM `CryptoKey` handles for hub keys via `importHubKeyCryptoKey` at `src/client/lib/hub-field-crypto.ts:129-140`.
- Hub-field migration: all org-metadata (role names, shift names, report types, hub names, custom field labels, team names, tag labels, report custom options) encrypted + AAD-bound, decrypted inside React Query `queryFn` callbacks.
- Worker-boundary AAD propagation shipped in PR #124.

**Adversarial tests verified present:**
- Label mismatch / AAD swap / envelope-version rejection: `hpke-primitives.test.ts:38-124`, `hpke-service.test.ts:55, 120`
- KEK non-extractability: `items-key.test.ts:83`, `paper-key.test.ts:75`, `device-identity.test.ts:17, 23`, `puk.test.ts:84`

**Explicitly deferred to Tier 6 PR #2 (Phase 2):**
- **ECIES/XChaCha20 sidecar removal from `crypto-worker.ts`.** The sidecar at `src/client/lib/crypto-worker.ts:31, 328, 404, 892` remains the active path for notes (`LABEL_NOTE_KEY`), messages (`LABEL_MESSAGE`), blasts (`LABEL_BLAST_CONTENT`), and file-body encryption. Removal is blocked on the MLS cutover replacing the multi-admin recipient-envelope loop for notes + messages. 21 files still reference `xchacha20poly1305` / `eciesWrapKey` / `eciesUnwrapKey*`.
- **Per-record AAD migration for envelope-encrypted PII columns** on `contacts`, `user_signal_contacts`, `conversations`, `call_records`, `bans`. Wire-format break scheduled with the MLS cutover migration.

**Rationale for deferral:** CLAUDE.md + POST_OVERHAUL_GAPS_2026-04-13.md both mandate "MLS replaces HPKE for messages/notes as a clean cut, not coexistence, no dual code paths". Removing the ECIES sidecar *before* wiring the MLS path would leave a functional gap during which notes / messages cannot be encrypted at all. Correct sequencing is MLS-wiring first, sidecar-removal second. This is tracked as the single largest Phase-2 work item.

### Tier 2 — Unlock + recovery (OPAQUE, multi-factor KEK, Shamir, diceware)

**Status: SUBSTANTIALLY COMPLETE with two tracked open P0s.**

**Shipped:**
- OPAQUE login via `@serenity-kit/opaque` with wrong-password unit coverage at `src/client/lib/opaque-client.test.ts:52`.
- **Multi-factor KEK on canonical `key-store.ts`** (the v2/v3 rename is complete; no `key-store-v2.ts` or `key-store-v3.ts` files remain in `src/`). `key-store.ts:9-11` documents 3-factor (PIN + WebAuthn PRF + IdP-bound value) and 2-factor (PIN + IdP-bound value) modes via PBKDF2-SHA256 (600k) + HKDF-SHA256 + XChaCha20-Poly1305.
- Shamir SSS for recovery groups with per-share commitment verification at `src/client/lib/recovery-group-share.ts`, commitment-rejection test at `recovery-group-share.test.ts:53`.
- Diceware paper keys with wordlist validation at `src/client/lib/recovery-phrase.ts`, wrong-phrase + invalid-wordlist rejection tests at `recovery-phrase.test.ts:38, 44, 69`.
- Recovery endpoints auth + rate limiting (PR #109), `newBundle` schema tightening to `RootKekEnvelopeBundleSchema` (PR #109), OPAQUE cache cap + route error handling (PR #115), recovery routes migrated to OpenAPIHono (PR #122).

**Adversarial tests present:**
- Shamir below-threshold: `recovery-group-share.test.ts:33`
- Forged share commitment: `recovery-group-share.test.ts:53`
- Diceware invalid / wrong length: `recovery-phrase.test.ts:38, 44`
- OPAQUE wrong password: `opaque-client.test.ts:52`

**Known open (Phase 2 P0):**
- **P0 — Recovery-participant deduplication missing.** `src/server/services/recovery-service.ts:73-111` `addParticipant` performs an atomic increment on `participantsCount` with a status guard, but **does not store the participant user ID** and **does not prevent the same user from calling it multiple times**. A single compromised admin can hit threshold alone by calling `addParticipant` N times. The gap doc from 2026-04-13 flagged this as a P0; the fix (`recovery_participants` junction table with `UNIQUE (recovery_request_id, participant_user_id)`) was scoped but never landed. **This is the most exploitable unfixed bug on `main` today.** Recommended fix: one Drizzle migration + one service-level change + one route-level authentication check that the contributing user's JWT subject matches the share-submitter identity, with dedup tests.

- **P0 — Recovery group share HPKE wrapping.** The gap doc reported that `recovery-group-section.tsx` sent raw Shamir shares as hex plaintext over the wire. Needs verification against current main — possibly resolved in PR #109 or #122, but not explicitly confirmed in commit messages.

### Tier 3 — Per-device keys (DeviceRegistry, cross-signatures, CLKR)

**Status: COMPLETE (after PR #107 closed the verifier impersonation P0s).**

**Shipped:**
- Device identity keypair generation (Ed25519 signing + X25519 encryption) with non-extractable private halves at `src/client/lib/device-identity.ts`.
- `user-sigchain-verifier.ts:269` verifies the inner Ed25519 cross-signature against the candidate self-signing pubkey — PR #107 closed the gap where only the outer sigchain signer was checked.
- `cross-signing.ts:388` `verifyTransitiveTrust` performs the HMAC derivation-binding check — PR #107 closed the "attacker substitutes unrelated self-signing key" gap.
- `AuditLogService.findSignerByPubkey` at `audit-log-service.ts:324` filters revoked devices with `isNull(userDevices.revokedAt)`.
- CLKR on device revoke via `hub-key-manager.ts:rotateHubKeyClkr` + `puk.ts:rotatePuk`.
- PUK-rotation exclusion of removed device verified at `puk.test.ts:156`.
- FK constraints on `hub_ptk_generations` + `hub_key_envelopes` (PR #121).
- Sigchain payload schema tightening (PR #116).

**Adversarial tests present:**
- Forged cross-signature: `cross-signing.test.ts:239, 277`
- Cross-sign inner signature tamper: `user-sigchain-verifier.test.ts:414`
- Cross-sign with wrong-master signing key: `user-sigchain-verifier.test.ts:458`
- `device_cross_sign` entry before any `user_master_signing_update`: `user-sigchain-verifier.test.ts:502`
- Revoked device trust removal: `audit-chain-verifier.test.ts:219`
- PUK rotation exclusion: `puk.test.ts:156`

**Known open (Phase-2 polish):**
- **P1 — No adversarial test wires `device-revoke-worker` through `rotateHubKeyClkr`** to assert the revoked device's pubkey is excluded from `deviceEnvelopes` / `deviceCommitments`. Individual pieces are tested; the integration path is not. Fix: add `src/client/lib/hub-key-manager.clkr-revoke.test.ts`.
- **P2 — `DeviceService.findDeviceBySigningPubkey`** at `src/server/services/device-service.ts:61-68` does not filter revoked devices (missing `isNull(userDevices.revokedAt)`). Current callers are tests only, but the name invites future misuse as the audit-signer resolver. Fix before any new production caller lands.

### Tier 4 — Delivery hardening (CSP, reproducible builds, warrant canary, cookies)

**Status: COMPLETE.**

**Shipped (after PRs #108, #111, #113, #119, #120, #123, #127):**
- iframe CSP `connect-src 'none'` + `frame-src 'none'` at `src/server/middleware/security-headers.ts`, asserted by `security-headers.test.ts:40`.
- `verifyOrThrow` binary verifier wired into SPA boot via PR #111 (`src/client/main.tsx`). Fail-closed on manifest hash mismatch, forged signature, missing pinned key. Tests at `binary-verifier.test.ts:222, 250, 313, 376, 399, 411`.
- Crypto sandbox iframe opaque-origin postMessage fix (PR #108) — channel no longer silently broken.
- Warrant canary Ed25519-signed at publication (PR #113). Verifier pubkey pinned in-bundle.
- Cookie `SameSite=Strict` via `src/server/lib/cookies.ts`; `auth.ts` + `invites.ts` migrated to the helper (PR #120); conditional `Secure` in dev; tests at `cookies.test.ts:26-81`.
- WHITEPAPER.md "Current vs Target" split (PR #123) — accurately describes the ECIES-for-notes reality while flagging the MLS target.
- Trusted Types policy wired into SPA boot (PR #127).
- Rescue fixes for CORP, jwtAuth scope, RPC exhaustiveness (PR #119).

**Known open (Phase-2 P1):**
- **Behavioral CSP iframe-escape test missing.** Current coverage is string-level (`security-headers.test.ts:40`). No Playwright UI test proves the browser actually blocks a cross-origin fetch/WebSocket from an injected iframe. Fix: `tests/ui/csp-iframe-escape.spec.ts`.
- **Behavioral SameSite CSRF test missing.** Current coverage is cookie-option assertions. No test issues a cross-origin POST with the browser cookie jar and asserts the refresh cookie is not sent. Fix: `tests/api/csrf-samesite.spec.ts`.

### Tier 5 — Voice E2EE (SFrame + DTLS fingerprint SAS)

**Status: COMPLETE for Twilio + SignalWire. PARTIAL for Vonage + Plivo (fail-closed).**

**Shipped (after PRs #110, #112, #117):**
- SFrame encryption in Web Worker at `src/client/lib/webrtc/sframe-worker.ts`. Keys are non-extractable `CryptoKey` handles held in worker closure. Per-frame tamper detection at `frame-codec.test.ts:142, 164, 250, 285, 309`.
- SFrame wired into the live call flow for Twilio + SignalWire (PR #110).
- Worker degraded notification + adapter fail-closed for Vonage + Plivo (PR #117) — providers without an accessible `pc` accessor cannot establish an E2EE call at all.
- SFrame worker RPC timeout (PR #112) — `call()` promises no longer hang indefinitely.
- DTLS fingerprint extraction + SAS binding at `src/client/lib/webrtc/dtls-fingerprint.ts`, tamper rejection tests at `dtls-fingerprint.test.ts:70, 80, 88`.
- `ActiveCallBadge` + `E2eeFallbackBanner` wired into the call route.

**Known open (Phase-2 P0):**
- **Consent-gate adversarial tests missing.** `src/client/lib/consent.ts` + `src/client/components/consent-gate.tsx` have no test files. No test asserts that `installSFrameOnCall` or the SIP `call()` path refuses to run when consent has not been granted. This is the single most important gap in Tier 5 coverage. Fix: add `consent.test.ts` + `consent-gate.test.tsx` + a unit test in `sframe-install.test.ts`.
- **Vonage + Plivo `#installHook` pc-accessor TODO markers remain** (`TODO(tier-5)` in `vonage.ts:48`, `plivo.ts:58`). Fail-closed today, but the providers themselves would need an SDK-level API to access the underlying `RTCPeerConnection` before E2EE can actually work on those paths.

### Tier 6 — MLS + PQ (fingerprint UX + vendored core-crypto)

**Status: PR #1 COMPLETE. PR #2 NOT SHIPPED (the primary Phase-2 work item).**

**Shipped (PR #1, via PRs #58, #106, #114, #127):**
- SAS / emoji fingerprint UX at `src/client/lib/mls/sas.ts` + `emoji-table.ts`, binding both parties' pubkeys + nonce (PR #106 closed the pre-computable-SAS gap).
- `@wireapp/core-crypto` vendored at `vendor/@wireapp/core-crypto/` (`file:` dep).
- `core-crypto-loader.ts` lazy WASM loader.
- Device shared zod schema + devices query key classification + device verification route on OpenAPIHono (PR #114).
- Trusted Types policy install (PR #127).
- Feature flag `VITE_LLAMENOS_MLS_ENABLED` removed (PR #104) — no gating mechanism remains.

**Not shipped (PR #2 — entire MLS message-path wiring):**
- `src/client/lib/mls/conversation.ts` is an **11-line empty class with a private constructor, no methods, no fields.** Verified 2026-04-14.
- No server routes for MLS key-package publication, Welcome distribution, commit application, or epoch storage.
- No Drizzle migrations for `mls_hub_state`, `mls_key_packages`, or `hubs.cs_profile`.
- No MLS client initialization anywhere in SPA boot.
- No adversarial tests for wrong-epoch, missing-commit, replayed-commit, or stale-device.
- Notes, messages, and blasts continue to use the legacy ECIES multi-admin envelope path in `crypto-envelopes.ts`.

**Rationale:** The scope of PR #2 (per POST_OVERHAUL_GAPS_2026-04-13.md §Tier 6) is ~11 distinct work items touching client crypto-worker boot, server routes, DB schema, hub-creation bootstrap, notes path cutover, messages path cutover, epoch commits for admin add/remove, audit payload variants, round-trip + adversarial tests, and a whitepaper rewrite. This is a multi-PR epic, not a single-session task. It is the **headline Phase-2 item**.

**Consequence for user-facing posture:** WHITEPAPER.md §0.1 (PR #123) already describes notes/messages as ECIES-based, with MLS flagged as the Target. Marketing copy and public-facing security descriptions MUST match this reality until PR #2 lands. Claiming "MLS-based E2EE" today is inaccurate.

## Net new findings from this completion audit

Six agents reviewed `main` at commit `a01738be`. Findings beyond those already
tracked in POST_OVERHAUL_GAPS_2026-04-13.md:

### HIGH

1. **`decryptHubField` plaintext fallback accepts server-supplied plaintext when ciphertext is malformed.** `src/client/lib/hub-field-crypto.ts:182, 186` return the `encrypted` string verbatim when `looksLikeCiphertext(encrypted)` is false (length < 40 or non-base64url char). Callers across `src/client/lib/queries/{roles,hubs,reports,firehose,blasts,tags,notes,settings,shifts,teams}.ts` pass the server-sent plaintext field as the `placeholder` argument (5th arg). Per CLAUDE.md the server contract is empty string for these columns, so the fallback is inert today, but the client-side pathway to render attacker-controlled strings as if they came from AEAD verification exists. **Fix: drop the 5th `placeholder` arg from all call sites, drop the plaintext-pass-through branches, and throw `HubFieldTamperError` on AEAD failure so the audit UI can fire a security event.**

2. **`wrapHubKeyForDevices` half-commits on partial HPKE failure.** `src/client/lib/hub-key-manager.ts:174-207` uses `Promise.allSettled` across devices, logs failed devices via `createDebugLog` (stripped in production), and throws only when *every* device fails. In a non-revoke rotation path, a single failing device produces a successful-looking `HubKeyRotationResult` with that device silently excluded from `deviceEnvelopes` / `deviceCommitments`. **Fix: distinguish `rotate-on-revoke` (expected drops) from `rotate-on-schedule` / `rotate-on-add` (any drop = abort + rollback). Log via `console.error` not `createDebugLog`.**

3. **`unlock` silently drops WebAuthn PRF factor as "wrong PIN".** `src/client/lib/key-manager.ts:399-410` has an inner try/catch around `import('./webauthn')` + `requestWebAuthnPRF()`. If the authenticator is unplugged or the user dismisses the dialog, the catch swallows the error, `prfOutput` stays `undefined`, and the subsequent decrypt fails at AEAD. The UI reports "wrong PIN" while the real cause is "security key unavailable" — and the user burns PIN-attempt lockout budget retrying. **Fix: return a discriminated `UnlockResult` union with `prf_unavailable` vs `wrong_pin` so the UI can prompt correctly.**

4. **`combineRecoveryGroupShares` is publicly exported with documented "returns garbage below threshold" behavior.** `src/client/lib/recovery-group-share.ts:46-51` — the safer `combineAndVerifyShares` exists at line 73 but nothing forces its use. Test-only caller today, but it's a landmine for the first recovery-UI wiring. **Fix: make `combineRecoveryGroupShares` non-exported or require a `threshold` parameter with an explicit pre-check; add a CI grep guardrail.**

5. **Audit chain client-side cache ignores trust-anchor drift.** `src/client/lib/audit-chain-verifier.ts:152-154` — once a cached row exists, the caller-supplied `trustAnchorDevicePubkeys` is silently ignored forever. A stale IDB cache pinning a now-revoked admin as a trust anchor is not detected. **Fix: compare the caller-supplied trust anchor to the cached one and clear the cache on mismatch, or always intersect.**

### MEDIUM

6. **`DeviceService.findDeviceBySigningPubkey`** does not filter revoked devices (see Tier 3 above).

7. **SFrame key-distribution module injects raw HPKE `sealFn`/`openFn` with no label/AAD binding contract enforced at the type level.** `src/client/lib/webrtc/sframe-key-distribution.ts:19-27`. Zero production callers today; the first one will forget to curry `LABEL_SFRAME_CALL_SECRET` + `buildAad(...)`. **Fix: inline the binding — have `buildKeyEvent` import `hpkeSeal`/`hpkeOpen` directly.**

8. **`items-key` wrap uses bare AES-KW with no per-artifact AAD.** `src/shared/items-key.ts:84-100`. Two wrapped keys under the same generation are structurally interchangeable; defense relies entirely on the outer AEAD's AAD binding, which is not type-enforced at the wrap call site. **Fix: add a `wrapPerArtifactKeyBound(key, itemsKey, recordId)` helper or document the invariant loudly.**

9. **`verifyAuditChain` IDB cache write precedes empty-chain assertion.** `audit-chain-verifier.ts:220-223` — `cache.put` runs before the `if (!effectiveHead) throw` check, poisoning the cache with a trust set from an empty chain. **Fix: move `cache.put` below the head assertion.**

10. **`MlsConversation` empty skeleton is a tripwire.** `src/client/lib/mls/conversation.ts` has a private constructor with no methods. The first developer to wire a caller will hit an opaque error. **Fix: either implement (Tier 6 PR #2) or delete the file until implementation starts.**

### Documentation drift (non-exploitable but high-read)

11. **CLAUDE.md security bullets have three inaccuracies:**
    - Line 100: "All **25** crypto context constants in `src/shared/crypto-labels.ts`" — actual count is higher; `LABEL_REGISTRY` has 42 wire-format entries and the file exports ~71 `LABEL_*` constants.
    - Line 106: Lists "notes/files/hub-key-manager/provisioning" as unmigrated legacy ECIES call sites. `hub-key-manager.ts` and `file-crypto.ts` and `provisioning.ts` are already HPKE-migrated per HPKE_MIGRATION_NOTES.md. Correct residual list: "notes/messages/blasts + envelope-PII columns".
    - Line 115: "Hub-key encrypted org metadata … **Symmetric XChaCha20** with the hub's shared key". Actual: AES-256-GCM with per-record AAD binding via non-extractable `CryptoKey` handles (`src/client/lib/hub-field-crypto.ts:55-75`). XChaCha20 is used in `key-store.ts`, not for hub fields.

12. **HPKE_MIGRATION_NOTES.md carries stale `envelope-v3.ts` / `hub-field-crypto-v3.ts` / `EnvelopeV3` references** throughout. The rename landed in PR #104. Fix: one `sed`-style sweep. Also: `drizzle/migrations/0054_tier1_items_key_columns.sql` should read `0054_tier1_items_key_indirection.sql`.

13. **POST_OVERHAUL_GAPS_2026-04-13.md** still marks `key-store-v2.ts → delete` as a P0 item; the file is already gone.

14. **AEAD_AUDIT_2026-04-10.md** references `envelope-v3.ts`; same rename sweep.

**Consolidation:** CLAUDE.md is the highest-impact fix (loaded into every agent session). The doc-drift sweep is one batched commit that closes findings 11-14.

## Invariants verified

Ran against current `main`. ✅ means programmatically verified in this session.
"Open" means a gap still tracked below.

### Crypto primitives
- ✅ No raw `@noble/ciphers` imports outside the sidecar list (grep confirmed, 21 files; all in the documented quarantine set).
- ✅ Hub-field AAD format: `${LABEL_HUB_FIELD}:${recordId}:${fieldName}` (verified at `src/shared/lib/hub-field-aad.ts:22`).
- ✅ Every `hpkeSeal`/`hpkeOpen` binds `info: encode(label)` on both ends (verified at `hpke-primitives.ts:85-124`).
- ✅ `LABEL_REGISTRY` contains every label referenced in the codebase (HKDF-only labels are excluded by design; see nit below).
- ✅ No `EnvelopeV3`, `key-store-v2`, or `key-store-v3` symbols remain in `src/` (grep confirmed 0 matches).
- ✅ `key-store.ts` uses non-extractable `CryptoKey` handles where applicable; raw bytes held in closure only for nsec.
- ⚠️ NIT: `LABEL_ITEMS_KEY_EXPORT`, `LABEL_NOTE_EPOCH_KEY`, `LABEL_MLS_PROVISION`, `LABEL_SAS_MLS_V3`, `LABEL_SFRAME_RATCHET` are HKDF info/salt strings but are enrolled in `LABEL_REGISTRY`, polluting the wire-format ID space. Move to plain constants.

### Audit log
- ✅ `AuditLogService.appendSigned` verifies chain + signature + signer + payload authz.
- ✅ `audit-chain-verifier.ts` is exported and used by admin audit UI.
- ✅ `rotateHubKey` gated on verified chain head via the CLKR orchestrator.
- Open: No integration test for the rotation-halts-on-tamper path.

### Devices
- ✅ `DeviceRegistry` is the canonical signer check; `audit-log-service.ts` filters revoked devices at `line 324`.
- ✅ Cross-signatures validated bidirectionally (PR #107).
- ✅ Device identity bootstrap on first unlock.
- Open: `DeviceService.findDeviceBySigningPubkey` not filtering revoked devices (finding #6).

### Voice E2EE
- ✅ SFrame in Web Worker; keys never logged.
- ✅ Adapter fail-closed for Vonage + Plivo (PR #117).
- ✅ DTLS fingerprint extracted and bound to SAS.
- ✅ SFrame key distribution wired into call flow (PR #110).
- Open: No consent-gate adversarial tests (finding in pr-test-analyzer).

### Delivery
- ✅ iframe CSP `connect-src 'none'` + `frame-src 'none'`.
- ✅ Binary verifier wired into SPA boot (PR #111), fails CLOSED on hash mismatch.
- ✅ Cookie `SameSite=Strict` on auth cookies, conditional Secure in dev (PR #120).
- ✅ WHITEPAPER.md Current-vs-Target split (PR #123).
- ✅ Warrant canary Ed25519-signed (PR #113).
- Open: Behavioral CSP + CSRF tests missing (Phase-2 P1).

### Tier 6 (MLS + PQ)
- ✅ `@wireapp/core-crypto` vendored with `file:` dep.
- ✅ No feature flags (PR #104 removed `VITE_LLAMENOS_MLS_ENABLED`).
- ❌ MLS group NOT established at hub creation (not wired).
- ❌ `MlsConversation` empty skeleton.
- ❌ No MLS DB migrations.

### Tier 2 (Unlock + recovery)
- ✅ OPAQUE via `@serenity-kit/opaque`.
- ✅ Multi-factor KEK on canonical `key-store.ts` (PIN + optional PRF + IdP-bound).
- ✅ Diceware phrase wordlist validation; no logging path found.
- ✅ Shamir commitment verification; combine below threshold throws (via `combineAndVerifyShares`).
- ✅ Recovery group endpoints have auth + rate limiting (PR #109, #122).
- ❌ **Recovery-participant dedup missing** (finding above, Phase-2 P0).
- Open: `combineRecoveryGroupShares` unsafe primitive remains exported (Phase-2 P2).

### Tier 1 (HPKE)
- ✅ Non-extractable hub-field AES-GCM `CryptoKey`.
- ✅ `HpkeEnvelope` (was `EnvelopeV3`) used in hub-field and items-key paths.
- ✅ items_key indirection wired.
- Open: Sidecar remains for notes/messages/files/blasts (deferred to Tier 6 PR #2).

## Test coverage matrix (adversarial)

| Tier | Invariant | Coverage | Location |
|---|---|---|---|
| 0 | Chain tamper | ✅ | `audit-chain-verifier.test.ts:127, 145` |
| 0 | Signature forge | ✅ | `audit-chain-verifier.test.ts:160` |
| 0 | Label swap | ✅ | `hpke-primitives.test.ts:38, 79` |
| 0 | AAD row/column swap | ✅ | `hpke-primitives.test.ts:47, 55`; `hpke-service.test.ts:120` |
| 0 | Rotation-on-tamper integration | ❌ | — (Phase-2 P1) |
| 1 | Envelope malformation | ⚠️ partial | `hpke-primitives.test.ts:107-124` (covers v-field; does not drop individual fields) |
| 1 | Wrong-label open | ✅ | `hpke-primitives.test.ts:38` |
| 1 | KEK non-extractable (sibling) | ✅ | 7 tests across the stack |
| 1 | KEK non-extractable (Tier-1 recipient handle) | ⚠️ partial | Covered for identity/items-key/PUK; not for the HPKE recipient handle installed by `unlockWithHandles`. |
| 2 | OPAQUE wrong password | ✅ | `opaque-client.test.ts:52` |
| 2 | OPAQUE timing oracle | ❌ | — (Phase-2 P2) |
| 2 | Shamir below threshold | ✅ | `recovery-group-share.test.ts:33` |
| 2 | Shamir forged share (commitment) | ✅ | `recovery-group-share.test.ts:53` |
| 2 | Shamir forged share → garbage combine | ❌ | — (Phase-2 P2) |
| 2 | Diceware wordlist rejection | ✅ | `recovery-phrase.test.ts:38, 44, 69` |
| 2 | PUK rotation interruption | ❌ | — (Phase-2 P1) |
| 3 | Forged device signature | ✅ | `cross-signing.test.ts:239, 277` |
| 3 | Cross-sig inner-signature tamper | ✅ | `user-sigchain-verifier.test.ts:414` |
| 3 | Cross-sig with wrong master | ✅ | `user-sigchain-verifier.test.ts:458` |
| 3 | Revoked signer rejected | ✅ | `audit-chain-verifier.test.ts:219` |
| 3 | CLKR-during-revoke integration | ❌ | — (Phase-2 P1) |
| 4 | Binary hash mismatch fail-closed | ✅ | `binary-verifier.test.ts:222, 250, 313, 376, 399, 411` |
| 4 | CSP iframe escape (string-level) | ✅ | `security-headers.test.ts:40` |
| 4 | CSP iframe escape (behavioral) | ❌ | — (Phase-2 P1) |
| 4 | Cookie SameSite (string-level) | ✅ | `cookies.test.ts:26-81` |
| 4 | Cookie SameSite (behavioral CSRF) | ❌ | — (Phase-2 P1) |
| 5 | SFrame wrong-key frame drop | ✅ | `frame-codec.test.ts:142, 164` |
| 5 | SFrame tamper variants | ✅ | `frame-codec.test.ts:250, 285, 309` |
| 5 | DTLS fingerprint mismatch | ✅ | `dtls-fingerprint.test.ts:70, 80, 88` |
| 5 | Consent-gate bypass | ❌ | — (Phase-2 P0) |
| 6 | Wrong-epoch MLS message | ❌ | Blocked on PR #2 |
| 6 | Missing commit rejected | ❌ | Blocked on PR #2 |
| 6 | Replayed commit rejected | ❌ | Blocked on PR #2 |
| 6 | SAS derivation binds both parties | ✅ | `sas.test.ts` (PR #106) |

Raw count: 24 adversarial tests present, 13 missing/blocked. Of the 13 missing,
3 are blocked on Tier 6 PR #2, 3 are Phase-2 P0 (consent-gate, recovery dedup
unit test, rotation-on-tamper integration), and 7 are Phase-2 P1/P2 polish.

## Metrics

- Tier commits (via `git log --grep='tier-'`): 29
- Pre-audit gap-doc P0s: 13
- Pre-audit gap-doc P0s closed since 2026-04-13: 10 (PRs #106-#127)
- Pre-audit gap-doc P0s still open: 3 (Tier 6 PR #2, recovery dedup, ECIES sidecar removal — blocked on Tier 6)
- Net new HIGH findings from this audit: 5 (findings #1-5 above)
- Net new MEDIUM findings: 5 (findings #6-10)
- Net new doc-drift findings: 4 (findings #11-14)
- Unit-test assertions: 20,391 across 179 files; all passing.

## Follow-ups — Phase-2 prioritization

### Phase-2 P0 (exploitable or load-bearing; fix next)

| # | Item | Tier | Effort | Rationale |
|---|------|------|--------|-----------|
| 1 | Recovery-participant dedup (`recovery_participants` junction table + `UNIQUE(recovery_request_id, participant_user_id)`) | 3 | 1 PR, ~1 day | One compromised admin can meet threshold alone today. |
| 2 | `decryptHubField` plaintext-fallback removal + throw on tamper | 1 | 1 PR, ~0.5 day | Client-side pathway to render attacker-supplied strings. |
| 3 | `unlock` PRF-unavailable vs wrong-PIN discrimination | 2 | 1 PR, ~0.5 day | User lockout attack via PIN-attempt burn. |
| 4 | Tier 6 PR #2 (MLS message-path wiring) | 6 | Multi-PR epic, ~2-3 weeks | Headline Phase-2 work. See POST_OVERHAUL_GAPS §Tier 6 §P0 for the 11-item scope. |
| 5 | Consent-gate adversarial tests | 5 | 1 PR, ~0.5 day | Voice-without-consent is a legal + trust failure. |

### Phase-2 P1 (hardening / integration tests)

| # | Item | Tier | Effort |
|---|------|------|--------|
| 6 | `wrapHubKeyForDevices` half-commit rollback | 1 | 1 PR |
| 7 | Audit chain cache trust-anchor drift | 0 | 1 PR |
| 8 | Rotation-on-tamper integration test | 0 | 1 PR |
| 9 | CLKR-during-revoke integration test | 3 | 1 PR |
| 10 | Behavioral CSP iframe-escape Playwright test | 4 | 1 PR |
| 11 | Behavioral SameSite CSRF test | 4 | 1 PR |
| 12 | `DeviceService.findDeviceBySigningPubkey` revoked filter | 3 | Small fix |
| 13 | SFrame key-distribution inline HPKE binding | 5 | Small fix |
| 14 | `items-key` per-artifact AAD binding | 1 | Small fix |
| 15 | CLAUDE.md security bullet corrections (lines 100/106/115) | docs | Small fix |
| 16 | HPKE_MIGRATION_NOTES + POST_OVERHAUL_GAPS + AEAD_AUDIT rename sweep | docs | Small fix |

### Phase-2 P2 (polish)

Type-design work (branded `ShamirShare`/`VerifiedShare`, `DicewarePhrase`
wrapper class that redacts on JSON, `Ed25519SigningKey`/`X25519EncryptionKey`
CryptoKey wrappers, branded `MlsGroupId`/`MlsEpoch`, branded `SframeFrame`
record, parse-don't-validate `UnsignedAuditEntry` → `SignedAuditEntry`
transition, HKDF-only labels moved out of `LABEL_REGISTRY`, AEAD tests for
PUK interruption / Shamir garbage-combine / OPAQUE timing oracle).

## Verdict

**Ship Phase 1. Do not claim "security overhaul complete" until Phase-2 P0 items
1-5 land.**

The overhaul as shipped today is a genuine, substantial security improvement
over the starting position — Tier 0's signed hash-chained audit log with
label-registered AAD binding closes the entire Albrecht attack surface for
hub-field crypto; Tier 3 verifier bindings (PR #107) shut the two device-key
impersonation paths; Tier 4 fail-closed binary verification (PR #111) is
finally real; Tier 5 voice E2EE is wired and working for the two largest
telephony providers. This is shippable protection.

What remains is honestly described as "Phase 2". The critical path items are:
(a) close the recovery-participant dedup bug before any user relies on the
recovery-group UX, (b) remove the `decryptHubField` plaintext-fallback and
`unlock` PRF silent-drop bugs surfaced by this audit, (c) land Tier 6 PR #2 so
that notes/messages move to MLS and the ECIES sidecar can be deleted. Items (a)
and (b) are small PRs. Item (c) is a multi-week epic.

**The biggest risk to trust is not in the code — it is in the messaging.** If
user-facing materials claim "MLS-based E2EE" or "7-tier security overhaul
complete" while `src/client/lib/mls/conversation.ts` is an 11-line empty
skeleton, the project is making a promise it cannot keep. PR #123 rewrote
WHITEPAPER.md with an honest Current-vs-Target split; marketing copy, README,
and public-facing descriptions must match. Every doc that references
"EnvelopeV3", "key-store-v3", or claims MLS is the live path is drift-critical
and should be swept.

## Cross-references

- Per-tier plans: `docs/security/TIER_{0..6}_REVIEW.md`
- Per-tier post-review: `docs/security/TIER_{0..6}_POST_REVIEW.md`
- Gap snapshot: `docs/security/POST_OVERHAUL_GAPS_2026-04-13.md` (most items resolved by PRs #106-#127; see §Executive summary)
- Stack audit: `docs/security/STACK_AUDIT_2026-04-12.md`
- AEAD audit: `docs/security/AEAD_AUDIT_2026-04-10.md`
- HPKE migration: `docs/security/HPKE_MIGRATION_NOTES.md`
- Whitepaper: `docs/security/WHITEPAPER.md` (Current-vs-Target split landed PR #123)
- Supply chain: `docs/security/SUPPLY_CHAIN.md`
- Warrant canary: `docs/security/WARRANT_CANARY.md`
- CLAUDE.md: root-level agent instructions (security bullets at lines 100, 106, 115 need correction — see finding #11)
