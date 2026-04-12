# Tier 6 PR #1 — Post-Review Findings & Fixes

**Date:** 2026-04-12
**Branch:** `feat/sec-tier-6-impl-mls-pr1`
**PR:** #88
**Reviewers:** 6 agents (code-reviewer, silent-failure-hunter, type-design-analyzer, pr-test-analyzer, comment-analyzer, superpowers:code-reviewer)

---

## Critical findings — FIXED

### C1: `data-testid` leaked correct SAS answer in production DOM

**File:** `src/client/components/verify-fingerprint-modal.tsx`

Picker buttons had `data-testid="sas-picker-correct-N"` for the correct emoji and `sas-picker-wrong-N` for wrong ones. Any DOM inspector could trivially identify which emoji to click, defeating the out-of-band verification ceremony.

**Fix:** Changed all picker buttons to neutral `data-testid="sas-picker-${idx}"`. Updated UI E2E tests to derive correct answers from displayed emoji content rather than from testid markers.

### C2: `handleVerify` sent empty `signedEntry` placeholder

**File:** `src/client/components/admin-sections/devices-section.tsx`

The verify handler sent `signedEntry: { /* Placeholder */ }` which always failed server validation (400), with no error handling — the user saw silent failure.

**Fix:** Replaced with `useMutation` that throws a clear "not yet implemented" error. Added error state to the component with visual feedback. Added pubkey hex validation before opening the modal. Added `verifyError` state rendered in an alert div.

### C3: `.env.local.example` had wrong env var name

**File:** `.env.local.example`

Had `LLAMENOS_MLS_ENABLED=false` but client code checks `VITE_LLAMENOS_MLS_ENABLED`. Vite only exposes `VITE_`-prefixed vars to client code, so the flag could never be enabled via the documented configuration.

**Fix:** Changed to `VITE_LLAMENOS_MLS_ENABLED=false`.

### C4: `hubId` validation was fail-open

**File:** `src/server/routes/device-verification.ts`

The check `if (hubId && entry.hubId !== hubId)` allowed bypass if hub-scoped middleware failed to set `hubId`. Additionally, only `entry.hubId` (top-level) was validated, not `entry.payload.hubId`.

**Fix:** Made fail-closed — returns 500 if `hubId` is falsy. Added separate validation of `entry.payload.hubId` against the hub context.

### C5: WASM loader had no error handling

**File:** `src/client/lib/mls/core-crypto-loader.ts`

When MLS flag is on, `loadCoreCrypto()` did `await import(...)` with no try-catch. WASM compilation failures, network errors, or CSP violations would propagate as unhandled rejections.

**Fix:** Wrapped dynamic import in try-catch. Logs failure via `console.error` and re-throws with a descriptive message.

---

## Important findings — FIXED

### I1: Route mounted at `/` instead of `/devices`

**File:** `src/server/app.ts`

Changed from `hubScoped.route('/', deviceVerificationRoutes)` to `hubScoped.route('/devices', deviceVerificationRoutes)`. Updated route's internal path from `/devices/:deviceId/verify` to `/:deviceId/verify`.

### I2: `deriveSasNamesEn` lacked 32-byte validation

**File:** `src/client/lib/mls/sas.ts`

Moved the 32-byte pubkey validation from `deriveSasEmoji` into the shared `deriveSasIndices` function so both `deriveSasEmoji` and `deriveSasNamesEn` benefit.

### I3: Stale PR #1/PR #2 references in comments

**Files:** `conversation.ts`, `core-crypto-loader.ts`

Replaced ephemeral "PR #1" / "PR #2" references with durable descriptions tied to the feature flag.

### I4: JSON parse errors silently swallowed

**File:** `src/server/routes/device-verification.ts`

Changed `c.req.json().catch(() => null)` to explicit try-catch that returns a descriptive "Request body must be valid JSON" 400 error.

---

## Deferred to tier-7-notes.md

See `~/tier-carry-forward/tier-7-notes.md` for items requiring design decisions or larger scope:

1. SAS should bind both verifier + target pubkeys (MITM resistance)
2. Device type should come from shared Zod schema
3. Devices query key not classified in ENCRYPTED/PLAINTEXT
4. Route should use `createRoute()` + OpenAPI pattern
5. Known-answer SAS test vector needed
6. UI E2E tests conditional on fixture data
7. `loadCoreCrypto` flag-on path untested
8. SAS return type should be 7-element tuple
9. `MlsConversation` skeleton needs field declarations for PR #2 guidance
10. `audit:read` vs potential `audit:write` permission refinement
11. Audit chain error path untested in API E2E

---

## Tier 6-specific checklist

| Check | Result |
|-------|--------|
| `VITE_LLAMENOS_MLS_ENABLED=false` by default | YES |
| No `if (MLS_ENABLED)` in existing encrypt paths | YES |
| WASM vendored (not downloaded at build time) | YES |
| WASM hash pinned in `vendor/VENDOR.md` | YES |
| `@wireapp/core-crypto` version pinned via `file:` | YES |
| Fingerprint UX uses audit chain (`appendSigned`) | YES |

## Verification

```
typecheck: PASS
lint: PASS (3 pre-existing errors, none in modified files)
build: PASS
unit tests: 1811 pass, 0 fail, 19367 expect() calls
```
