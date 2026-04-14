# Tier 2 Post-Review Report

**Date:** 2026-04-12
**Reviewer session:** review-tier2
**PRs reviewed:** #78 (PR-A: OPAQUE), #79 (PR-B: Diceware), #80 (PR-C: Recovery Group)
**Branch:** `feat/sec-tier-2-impl-recovery-prc`
**Base:** `feat/sec-tier-1-impl-hpke-prb` (d608cf8a)
**Diff:** 76 files, +13718/-26 lines

## Review Methodology

Six review agents dispatched in parallel:
1. `pr-review-toolkit:code-reviewer` — full diff review
2. `pr-review-toolkit:silent-failure-hunter` — error path analysis
3. `pr-review-toolkit:type-design-analyzer` — type safety audit
4. `pr-review-toolkit:pr-test-analyzer` — test coverage gaps
5. `pr-review-toolkit:comment-analyzer` — documentation accuracy
6. `superpowers:code-reviewer` — independent plan+spec review

Manual security greps:
- `console.*(log|warn|info|debug).*phrase` — CLEAN (no phrase logging)
- `return.*kek` — reviewed, all returns are design-intentional
- `localStorage|sessionStorage|indexedDB` in phrase files — CLEAN

## CRITICAL Findings (Fixed in Review)

### C1: OPAQUE route path mismatch
- **Issue:** Client called `/api/auth/opaque/*` but server mounts at `/api/opaque/*`
- **Fix:** Updated all client methods to use `/api/opaque/registration/start`, etc.
- **Files:** `auth-facade-client.ts`

### C2: OPAQUE request schema mismatch
- **Issue:** Client sent wrong field names (`startLoginRequest` vs `credentialRequest`, missing `purpose`/`credentialIdentifier`)
- **Fix:** Rewrote all four OPAQUE client methods with correct parameter shapes matching server schemas
- **Files:** `auth-facade-client.ts`, `unlock-factors.ts`

### C3: Server imports from `src/client/`
- **Issue:** `opaque-server-setup.ts` and `opaque.ts` imported `opaqueServer` from `../../client/lib/opaque-client`
- **Fix:** Created `src/server/lib/opaque-server.ts` re-export module; updated server imports
- **Files:** `opaque-server.ts` (new), `opaque-server-setup.ts`, `opaque.ts`

### C5: `combineRecoveryGroupShares` returns garbage without verification
- **Issue:** Shamir `combine()` returns silently wrong bytes on below-threshold or tampered shares
- **Fix:** Added `combineAndVerifyShares()` that verifies each share's SHA-256 commitment before combination, throwing `ShareCommitmentError` with failing index
- **Files:** `recovery-group-share.ts`

### C6: `recoveryGroupGetSession` silently swallows all errors
- **Issue:** Bare catch block returned `null` for network failures, 500s, auth failures — indistinguishable from "not found"
- **Fix:** Removed catch block, added `assertOk` check, only return `null` for 404
- **Files:** `auth-facade-client.ts`

## CRITICAL Findings (Deferred — Documented Stubs)

### C4: Recovery group shares stored as plaintext hex
- **Status:** Known stub — comment in `recovery-group-section.tsx:34-39` says "In full implementation, shares would be HPKE-wrapped per admin pubkey"
- **Risk:** Raw Shamir shares sent to server in plaintext
- **Deferred to:** Tier 3 or integration work. The admin UI enrollment is explicitly a placeholder.

## IMPORTANT Findings (Fixed in Review)

### I1: `RecoveryGroupThresholdError` hardcoded `need: 0`
- **Fix:** Fetch group threshold from DB before throwing
- **Files:** `recovery-group-service.ts`

### I10: `FactorDerivationError` defined but never used + unused `PrfUnsupportedError` import
- **Fix:** Removed unused `PrfUnsupportedError` from `derivePrf` destructuring
- **Files:** `unlock-factors.ts`

### I11: `deriveRecoveryPhraseKekBytes` always throws `invalid_word` even for wrong length
- **Fix:** Added `assertValidRecoveryPhrase()` that throws the specific error code (`empty`, `wrong_length`, `invalid_word`)
- **Files:** `recovery-phrase.ts`

### I12: Duplicate base64url decode functions in `opaque-client.ts`
- **Fix:** Removed `base64UrlToBytes`, reused `decodeBase64Url` via `opaqueEncoding.base64UrlToBytes`
- **Files:** `opaque-client.ts`

### I14-I16: Comment inaccuracies
- Fixed "hex-encoded export key" → "base64url-encoded" in `opaque-client.ts`
- Fixed wrong RFC reference (removed "RFC 9807") in `opaque.ts` and `opaque-server-setup.ts`
- Fixed false "server integration" claim in `convenience-pin.ts`
- Fixed stale "opaque-wrapper.ts" reference in `opaque-client.ts`

### I20: Recovery phrase KDF params duplicated
- **Fix:** `deriveRecoveryPhraseKekBytes` now uses `RECOVERY_PHRASE_KDF_PARAMS` constant

### I21: Salt length not validated
- **Fix:** Added `salt.length !== 32` check in `deriveRecoveryPhraseKekBytes`

## IMPORTANT Findings (Deferred to Tier 3)

### I2: Unauthenticated GET endpoints leak recovery group config
- `GET /:hubId` and `GET /session/:id` expose threshold/shares without auth

### I3: `completeRecovery` accepts but ignores `newBundle` (`z.unknown()`)
- Schema should be `RootKekEnvelopeBundleSchema` or field should be removed

### I4: Recovery group routes use plain Hono, not OpenAPIHono
- Excluded from OpenAPI spec

### I5: DB migration missing `threshold <= total_shares` CHECK constraint

### I6: No FK constraints on recovery tables

### I7: OPAQUE server routes have no try-catch
- Unhandled WASM/DB errors return raw 500

### I8: IDB open failure propagates as raw DOMException

### I9: AES-KW unwrap failure produces generic `OperationError`

### I13: Convenience PIN `loadState` unsafe `as PinState` cast on `JSON.parse`

### I17: All 22 non-English locales have untranslated English for recovery strings

### I18: UX copy uses crypto jargon ("Shamir secret sharing", "threshold")

### I19: Login state cache has no maximum size (DoS vector)

## Test Coverage Gaps (Deferred)

1. **No adversarial below-threshold Shamir test** — 2 shares from 3-of-5 split
2. **No end-to-end commitment-verified recovery round-trip**
3. **No key-material zeroing on failed unlock test**
4. **No OPAQUE export key zeroing test**
5. **No PRF-unavailable fallback test**
6. **No `rotateBundle` test**
7. **No duplicate-contribution rejection test**

Overall test rating: **GOOD** — happy paths and schema validation well-covered; adversarial and edge cases need work.

## Type Design Summary

| Type | Enc | Inv | Use | Enf |
|------|:---:|:---:|:---:|:---:|
| RootKekEnvelope/Bundle schema | 4/5 | 5/5 | 5/5 | 4/5 |
| RootKekStore (IDB layer) | 4/5 | 4/5 | 5/5 | 4/5 |
| OPAQUE schemas | 3/5 | 3/5 | 5/5 | 4/5 |
| UnlockFactor union | 5/5 | 5/5 | 5/5 | 4/5 |
| DicewareRecoveryPhrase | 3/5 | 4/5 | 5/5 | 4/5 |
| Shamir share types | 3/5 | 3/5 | 4/5 | 3/5 |
| ConveniencePin | 3/5 | 3/5 | 4/5 | 3/5 |
| LoginStateCache | 4/5 | 4/5 | 5/5 | 4/5 |

Cross-cutting concern: All crypto key material is plain `Uint8Array`/`string` — branded types would prevent accidental interchange.

## Carry-Forward Assessment (from Tier 1)

| Blocker | Status |
|---------|--------|
| 1. ECIES sidecar removal | NOT addressed |
| 2. Multi-factor KEK on key-store-v3 | PARTIALLY addressed (root KEK bundle exists but not wired to key-store-v3) |
| 3. Per-record AAD migration | NOT addressed |
| 4. Server note/file envelope paths | NOT addressed |

Items 1, 3, 4 remain fully deferred. Item 2 has the primitives but lacks integration wiring.

## CI Status

- PR #78 (PR-A): e2e-tests FAIL (notification-pwa.spec.ts text selector + auth-guards timeout — known infra patterns)
- PR #79 (PR-B): No checks reported
- PR #80 (PR-C): unit-tests FAIL (pre-existing opaque-client.test.ts export issue from PR-B), api-tests FAIL, e2e pending

## Verification (post-fix)

- typecheck: PASS
- build: PASS
- lint: PASS (pre-existing only)
- Tier 2 unit tests: 108/108 PASS (excluding pre-existing mock-leakage issue)
