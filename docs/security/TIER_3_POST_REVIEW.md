# Tier 3 Post-Implementation Review

**Date:** 2026-04-12
**Branch:** `feat/sec-tier-3-impl-clkr-prc`
**PR:** #86
**Scope:** 19 commits, 94 files, 8617 insertions, 2871 deletions
**Review agents:** 6 dispatched in parallel (code-reviewer, silent-failure-hunter, type-design-analyzer, pr-test-analyzer, comment-analyzer, superpowers:code-reviewer)

## Summary

Tier 3 implements device identity, PUK lifecycle, sigchain verification, cross-signing, device enrollment, hub key per-device wrapping, device revocation with CLKR rotation, paper key recovery, and the RecoveryService framework. The implementation is architecturally sound with strong cryptographic design — domain separation is excellent, key zeroing is consistent, and the sigchain verifier faithfully extends the Tier 0 audit chain pattern.

## Critical Findings — Fixed

### C1: Paper key self-revocation broke sigchain verification

**File:** `src/client/lib/paper-key.ts:235`
**Issue:** `recoverFromPaperKey` built a `tier3_device_remove` entry where `signedByDeviceId === removedDeviceId` (the paper key signs its own removal). The sigchain verifier at `user-sigchain-verifier.ts:226` explicitly rejects `cannot_remove_self`. Paper key recovery was structurally broken.
**Fix:** Changed `removeEntry.signedByDeviceId` to `newDevice.deviceId` — the newly-added device signs the paper key's removal (valid because the new device is already in the verified set from the preceding `tier3_device_add` entry).

### C2: RecoveryService.completeRecovery did not enforce threshold

**File:** `src/server/services/recovery-service.ts:105-129`
**Issue:** `completeRecovery` transitioned pending→completed without checking `participantsCount >= threshold`. The threshold check in `addParticipant` was purely informational — nothing prevented calling `completeRecovery` before quorum was reached.
**Fix:** Added `if (request.participantsCount < request.threshold) throw` in `completeRecovery`. Added test for rejection when threshold not met.

### C3: recovery_requests uuid vs text type mismatch

**File:** `src/server/db/schema/recovery.ts:5-6`, `drizzle/migrations/0057_tier3_recovery_service.sql:3-4`
**Issue:** `recovery_requests.user_id` and `initiated_by_user_id` used `uuid` type, but `users.pubkey` (the user identifier) and all other Tier 3 tables use `text`. This type mismatch would cause runtime failures on any JOIN.
**Fix:** Changed both columns from `uuid` to `text` in both the Drizzle schema and migration SQL.

### C4: addParticipant TOCTOU race condition

**File:** `src/server/services/recovery-service.ts:73-99`
**Issue:** Non-atomic read-increment-write pattern: read `participantsCount`, increment in JS, write back. Two concurrent participants would both read the same count and lose one increment.
**Fix:** Replaced with atomic SQL `SET participants_count = participants_count + 1` with `RETURNING`, eliminating the race.

## Important Findings — Fixed

### I1: wrapHubKeyForDevices used Promise.all

**File:** `src/client/lib/hub-key-manager.ts:106-117`
**Issue:** A single device with a corrupted X25519 public key would cause `Promise.all` to reject, preventing HPKE wrapping for ALL devices during rotation. This could brick hub access for every member.
**Fix:** Changed to `Promise.allSettled` with per-device error logging. Failed devices are excluded from results. Throws only if ALL devices fail.

### I2-I4: Critical comment corrections

- `device-revoke-worker.ts:4`: Changed `device_revoke` → `tier3_device_remove` (correct sigchain type)
- `cross-signing.ts:217-219`: Fixed JSDoc claiming return was "minus signerDeviceId/targetDeviceId" — it actually returns a complete `DeviceCrossSignPayload`
- `crypto-labels.ts:318`: Changed "HKDF info" → "HKDF salt" for `LABEL_DEVICE_ENROLLMENT_SAS` (it's used as the HKDF salt parameter, not info)

## Important Findings — Deferred to Tier 4

### I5: No branded types for crypto key material

All crypto key material (`Uint8Array`) is interchangeable at the type level — signing pubkeys, encryption pubkeys, PUK seeds, master seeds, and hub keys can be swapped without compiler error. Branded types (`SigningPubkey`, `EncryptionPubkey`, etc.) would catch this class of bugs at compile time. See Tier 4 carry-forward.

### I6: Duplicated utility code across puk.ts, cross-signing.ts, paper-key.ts

`ED25519_PKCS8_HEADER`, `buildPkcs8`, `importEd25519FromSeed`, `importX25519FromSeed`, `hexToBytes`, `aesGcmEncrypt/Decrypt` are copy-pasted across three files. Should be extracted to a shared module.

### I7: RecoveryService.addParticipant lacks deduplication

No check that a participant hasn't already contributed. Same admin could call repeatedly to bypass K-of-N threshold. Needs a junction table with unique constraint on `(recoveryRequestId, participantUserId)`.

### I8: Share payload discarded in addParticipant

`sharePayload` parameter is accepted but never stored. The server needs to accumulate shares for Shamir reconstruction or delegate entirely to client-side.

### I9: device_cross_sign verifier case doesn't verify inner signature

The sigchain verifier checks the outer Schnorr chain signature but not the inner Ed25519 cross-signature payload. An attacker controlling a valid device could record a cross-sign claim without actually signing.

### I10: Hub key cache silently swallows all errors

`hub-key-cache.ts:77-95` has a bare `catch {}` that discards all error types including corruption, auth failures, and crypto mismatches. No logging.

### I11: decryptFromHub returns null on any error

`hub-key-manager.ts:71-81` returns `null` for wrong key, tampered ciphertext, AAD mismatch — tampered data is indistinguishable from missing data.

### I12: Missing FK constraints on new tables

`hub_ptk_generations` and `hub_key_envelopes` have no FK constraints to `hubs` or `user_devices`.

### I13: Sigchain API schemas use z.record() for payload

`FinalizeEnrollmentRequestSchema` and `RevokeDeviceRequestSchema` use `payload: z.record(z.string(), z.unknown())`, losing sigchain payload type safety at the API boundary.

### I14: Device enrollment state machine uses nullable fields

Should use discriminated union states instead of ~8 nullable fields with runtime consistency checks.

### I15: `_testOnlySeed` on InitialPukResult present in production

The field is always populated, not just in tests. Should be guarded with a test-mode check.

### I16: verifyTransitiveTrust doesn't verify master→self-signing derivation binding

An attacker could provide a legitimate cross-signature over a user's master pubkey, then substitute an unrelated self-signing key.

## Test Coverage Gaps — Deferred

1. **Sigchain adversarial**: duplicate entries, forked chains, out-of-order entries not tested
2. **Cross-signature**: missing test for self-signing key not derived from cross-signed master key
3. **PUK envelope AAD**: no test that wrong deviceId causes decryption failure
4. **Revocation idempotency**: mock replaces real processRevocation — doesn't test actual code path twice
5. **Paper key 12-word mnemonic**: valid BIP39 but wrong length — could cause silent key mismatch
6. **Recovery threshold-1**: no test that completing below threshold fails (now added)
7. **Hub key rotation + walk end-to-end**: wrap chain from rotateHubKeyClkr not tested with walkGenerationChain

## Verification

- **Typecheck:** PASS (clean)
- **Lint:** 3 pre-existing errors (none in changed files), 289 pre-existing warnings
- **Build:** PASS
- **Unit tests:** 239 Tier 3 tests pass (0 fail). 15 pre-existing failures in unrelated files (panic-wipe isolation, DB-dependent tests).

## Tier 0 Compromise #7

The `TODO(tier-3):` stub in `audit-log-service.ts` has been fully replaced. The service now queries `userDevices` for per-device signing pubkeys, falling back to `users.pubkey` for Tier 0 entries. Zero `TODO(tier-3):` markers remain in the codebase. Compromise #7 is resolved.

## Tier 2 Carry-Forward Assessment

| Item | Status |
|------|--------|
| 1. Recovery group HPKE wrapping | Addressed — old code deleted, replaced with proper HPKE |
| 2. `newBundle` schema z.unknown() | Addressed — old schema deleted |
| 3. Recovery group routes → OpenAPIHono | Partially addressed — old routes deleted, new RecoveryService is DB-only |
| 4. Unauthenticated recovery endpoints | Addressed — old endpoints deleted |
| 5. DB schema hardening (FK constraints) | Not addressed — new tables also lack FKs |
| 6-9. Carried from Tier 1 | Not addressed (expected) |
| 10-21. Improvements | Not addressed (expected) |
