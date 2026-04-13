# Tier 0 — Post-Implementation Deep Review

**Date:** 2026-04-11
**Reviewer:** Claude Opus 4.6 main-session post-impl review
**Branch:** `feat/sec-tier-0-impl-albrecht` (PR #68)
**Parent review:** `docs/security/TIER_0_REVIEW.md` (spec/plan review)
**Companion:** `docs/security/AEAD_AUDIT_2026-04-10.md` (live findings log)

## Summary

Tier 0 implementation (WS 0.1 + WS 0.3 + WS 0.4 from `TIER_SESSION_PROMPTS.md`) landed on PR #68 across 91 commits. A six-agent pr-review-toolkit sweep (code-reviewer, silent-failure-hunter, type-design-analyzer, comment-analyzer, pr-test-analyzer, code-simplifier) against the full diff surfaced 5 **critical** and 3 **important** findings that the main session triaged, fixed inline, and re-verified through the standard gate (`bun run typecheck && bun run lint && bun run build && bun run test:unit`). All findings below are **resolved on the branch at the head** referenced in the PR.

## Critical findings

### C-1. Hub-field AEAD helper existed but some call sites still passed zero-length AAD

**Where:** `src/shared/lib/hub-field-aad.ts` (new), plus `src/client/lib/hub-field-crypto.ts`, `src/client/lib/file-crypto.ts`.

**Problem:** WS 0.1 Task 7 introduced `hubFieldAad(recordId, fieldName)` and wired it through the `encryptHubField`/`decryptHubField` helpers, but a few legacy call sites in `file-crypto.ts` (`decryptFileMetadata`, the `decryptEnvelope` callbacks inside `decryptFile` and `rewrapFileKey`) still handed the crypto worker a literal `new Uint8Array(0)` as the AAD argument. The net effect was that the **AEAD was called with empty AAD**, which silently defeated the whole transplantation-resistance story: a ciphertext produced for one fileId could have been consumed under any other fileId without an authentication failure.

The crypto worker RPC contract (`cryptoWorker.decrypt` / `cryptoWorker.encrypt`) accepts label-based ECIES unwrapping but does not forward a caller AAD into the inner AEAD today — hardening that end-to-end is a Tier 1 item (see AEAD_AUDIT §"Worker-boundary AAD propagation"). In Tier 0 the correct behavior is to **not pretend there is AAD** by passing an empty Uint8Array, because it is silently misleading to reviewers and to `git blame`.

**Fix:** Removed every remaining `new Uint8Array(0)` argument from `cryptoWorker.decrypt` call sites in `file-crypto.ts`. The RPC signature does not take an AAD, so the argument is now omitted. Added a clear docblock on `cryptoWorker.decrypt` / `cryptoWorker.encrypt` explaining that the inner AEAD is called with empty AAD today and that adding an AAD parameter here would be a silent no-op until the worker contract is upgraded — Tier 1 work.

**Verification:** Hub-field `(recordId, fieldName)` binding is now exercised by a real transplantation-resistance test in `tests/api/aead-binding.spec.ts` (see I-3 below).

### C-2. Missing authz gate on `POST /audit` — any authenticated caller could forge signer or hub

**Where:** `src/server/routes/audit.ts`.

**Problem:** The signed-audit-entry write endpoint validated the zod schema and passed the entry to `AuditLogService.appendSigned`, which checks role-authorization against `payloadIsAuthorizedFor(signer.role)`. But **the route itself did not assert that**:

1. `signerPubkey` in the body matches the authenticated caller's pubkey (`c.get('pubkey')`), or
2. `hubId` in the body matches the hub-scoped path (`c.get('hubId')`).

A volunteer could POST a body claiming `signerPubkey: <super-admin-pubkey>` and — assuming the signer lookup found that pubkey in the users table — bypass the payload-authorization check by impersonating a higher-privileged actor. The service-level check was load-bearing **but used the wrong source of truth** (the body, not the authenticated principal).

**Fix:** Added two 403 gates at the top of the POST handler, immediately after zod parse:
- `signer_mismatch` if `parsed.data.signerPubkey !== callerPubkey`
- `hub_mismatch` if `pathHubId && parsed.data.hubId !== pathHubId` (the non-hub-scoped route for super-admin cross-hub writes intentionally skips the second check)

`signer_unknown` is now unreachable from the route layer — a defense-in-depth branch in the service retains it for direct-to-service callers and remains covered by unit tests.

**Tests:** `tests/api/audit-log.spec.ts` was updated in two ways:
- All happy-path POSTs now go through `ctx.user('super-admin').api` (matching the signer identity), since the previous test file used `ctx.adminApi` which points at a different bootstrap identity — the new route-level guard would 403 every existing test otherwise. This was **not a test weakening**: the previous tests were silently passing because the server did not check signer/caller alignment.
- A new `rejects hub_mismatch when body hubId differs from path` test was added to lock in the second gate.
- The renamed `rejects signer_mismatch when body signerPubkey differs from caller` test locks in the first gate.

### C-3. Signed audit chain had no unique constraint — concurrent appends could fork the chain

**Where:** `drizzle/migrations/0052_signed_audit_unique_constraints.sql` (new), `src/server/db/schema/records.ts`, `src/server/services/audit-log-service.ts`.

**Problem:** `AuditLogService.appendSigned` reads the current chain head, verifies the incoming entry's `prevEntryHash` matches, then INSERTs. Under concurrent writes the read-then-write is **not atomic at the DB level** — two concurrent appends can both read the same head, both verify, and both insert sibling rows with the same `prevEntryHash`, forking the chain. Post-hoc verification can still detect the fork, but before that runs, a subsequent append on top of the "wrong" branch can be sneaked in, and the whole point of a hash chain as a tamper-evident log is defeated.

Additionally, there was nothing to prevent two entries with the same `entry_hash` from coexisting in different hubs (low probability but not enforced).

**Fix:** Migration `0052_signed_audit_unique_constraints.sql` adds three constraints to `signed_audit_entries`:

1. `UNIQUE (hub_id, prev_entry_hash)` — at most one child per parent per hub. This is the load-bearing fork-prevention constraint. A second concurrent insert with the same `prevEntryHash` will fail with SQLSTATE 23505 instead of succeeding.
2. `UNIQUE (entry_hash)` — global uniqueness of `entry_hash`. Defense in depth against cross-hub collisions and an extra integrity rail.
3. `UNIQUE INDEX ... WHERE prev_entry_hash IS NULL` — partial index enforcing a single genesis entry per hub.

Drizzle declarative schema in `src/server/db/schema/records.ts` was updated to declare all three (`unique(...)` + `uniqueIndex(...).where(sql\`... IS NULL\`)`) so future schema diffs stay in sync.

`AuditLogService.appendSigned` now wraps `this.port.insert(entry)` in a try/catch that translates SQLSTATE `23505` into `AuditChainError('chain_conflict', { constraint })`. The translation is at the **service layer** (not at the Drizzle port) so `FakeStore`-backed unit tests can exercise it by throwing a synthetic `{ code: '23505' }` error.

**Tests:** `src/server/services/audit-log-service.test.ts` gained a unit test `translates postgres unique-violation from insert into chain_conflict` that builds an inline fake store whose `insert` throws `{ code: '23505', constraint_name: 'signed_audit_entries_hub_prev_hash_unique' }` and asserts the service raises `chain_conflict`.

### C-4. `createHTML` in the Trusted Types policy was a passthrough

**Where:** `src/client/lib/trusted-types-policy.ts`.

**Problem:** The Tier 0 L3 policy installed via CSP `trusted-types llamenos default` had a `createHTML` that returned its input unchanged. Because `require-trusted-types-for 'script'` steers every HTML sink through *some* policy, a passthrough `createHTML` would have turned any future XSS sink that routed through this policy into a silent conduit — the opposite of what Trusted Types is for.

React's built-in HTML sinks do not route through the named `llamenos` policy; they use React's own `default` policy at runtime. The llamenos policy has **zero legitimate callers** for `createHTML` in the current codebase.

**Fix:** `createHTML` now throws unconditionally with a message that explains what to do if a legitimate HTML sink is ever added ("add a named policy with an explicit sanitizer — do not relax this default"). A policy-design docblock above `installTrustedTypesPolicy` spells out the rationale so a future reader doesn't "helpfully" turn it into a passthrough.

`createScriptURL` still allows same-origin URLs only; `createScript` still throws unconditionally.

**Tests:** `src/client/lib/trusted-types-policy.test.ts` replaced the old `createHTML passes through input` test with `createHTML throws unconditionally (strict default)`, asserting both a well-formed HTML string and an empty string throw the expected error.

### C-5. (Consolidated with C-1) Zero-length AAD leakage across crypto boundary

See C-1 above — this was reported by two different agents (code-reviewer and silent-failure-hunter) as two findings but resolved by a single set of edits.

## Important findings

### I-1. `csp-report` in-memory rate-limit table was unbounded

**Where:** `src/server/routes/csp-report.ts`.

**Problem:** The IP→`{count,resetAt}` map had no upper bound. An attacker spraying one request per source IP (via spoofed X-Forwarded-For — the endpoint trusts XFF) could grow the map unboundedly and DoS the server's RSS.

**Fix:** Introduced `MAX_IP_ENTRIES = 10_000` and a `pruneExpired(now)` helper. When the map reaches capacity, expired entries are pruned first; if still at capacity, the oldest live entry (`ipCounts.keys().next().value`, leveraging Map insertion order) is evicted FIFO. At 60 reports/min, 10 k distinct IPs bound memory to roughly half a megabyte of RSS. Inline comments explain why FIFO eviction is acceptable here (CSP reporting is best-effort diagnostic data, not an auth/audit path).

### I-2. `eciesUnwrapKeyWithSecret` took `label: string` instead of `CryptoLabel`

**Where:** `src/shared/crypto-primitives.ts`.

**Problem:** The test/server-only mirror of `eciesUnwrapKey` (`eciesUnwrapKeyWithSecret`) was the only remaining ECIES function whose `label` parameter was typed as `string` rather than the branded `CryptoLabel`. That broke the "triple-redundant label defense" (brand + HKDF + wire-format label) at a single point — a caller could pass any free-form string and the type system would not catch the mismatch.

**Fix:** Retyped the parameter as `CryptoLabel`. The branded type was already imported at the top of the file, so the fix was a one-word change.

### I-3. `tests/api/aead-binding.spec.ts` only asserted role create/list round-trip — no real transplantation test

**Where:** `tests/api/aead-binding.spec.ts`.

**Problem:** The original spec tested that the role create+fetch ciphertext path did not corrupt bytes — a useful smoke test but a **weak security assertion**. If the `hubFieldAad` formula ever drifted, the smoke test would still pass.

**Fix:** Added two new tests that exercise the real helper:

1. `hub-field ciphertext does not decrypt under a different record or field` — builds a ciphertext with `hubFieldAad(recordA, fieldX)` and asserts decrypt **succeeds** with the correct AAD and **fails** under `(recordB, fieldX)`, `(recordA, fieldY)`, and `(recordB, fieldY)`. Also asserts that a wrong hub key still fails (sanity / defense in depth).
2. `hubFieldAad is deterministic and includes both record and field` — asserts two calls with the same inputs produce byte-identical output, and that changing either `recordId` or `fieldName` produces a different AAD.

These tests call the same `hubFieldAad` helper the production code uses, so any future drift in the formula trips the test.

## Verification gate

Final state after all fixes:

```
$ bun run typecheck    → clean
$ bun run lint         → 0 errors (266 warnings, all pre-existing on main)
$ bun run build        → clean
$ bun run test:unit    → 1461 pass / 0 fail / 1 skip
```

Full details:

- **typecheck:** Initial run surfaced pre-existing `tsc` errors in `src/client/components/FilePreview.tsx` and `src/client/components/admin-sections/hub-roles-section.tsx` that were left behind when the tier-0 implementation updated the `decryptFile` / `encryptHubField` signatures. Fixed inline — FilePreview.tsx now imports `FileKeyEnvelopeV2` and passes `fileId` to `decryptFile`; hub-roles-section.tsx passes the 4-arg `(value, hubId, recordId, fieldName)` form at both create and update sites.
- **lint:** Initial run surfaced 4 biome format errors (post-edit files in `src/client/lib/crypto-worker-helpers.ts`, `src/client/lib/file-crypto.ts`, `src/server/lib/crypto-service.ts`, `src/server/services/settings/role-management.ts`) and one stale `biome-ignore lint/correctness/useExhaustiveDependencies` suppression in `FilePreview.tsx` that no longer matched any warning. Both cleaned up.
- **test:unit:** Initial run failed with a misleading `SyntaxError: Export named 'isWorkerLockedError' not found in module '...crypto-worker-client.ts'`. Root cause: `src/client/lib/audit-log-client.test.ts` used `mock.module('./crypto-worker-client', ...)` with an **incomplete** export list (only `cryptoWorker`), and because bun test mocks are process-wide, later sibling test files (`crypto-worker-client.test.ts`, `decrypt-fields.test.ts`) that import named exports like `CryptoWorkerLockedError` and `isWorkerLockedError` resolved against the incomplete mock and failed to load. The fix was to eagerly `import * as realCryptoWorkerClient from './crypto-worker-client'` at the top of `audit-log-client.test.ts` and spread it into the mock, so only `cryptoWorker` is overridden and every other named export passes through the real module. Inline comment explains the cross-file leakage for future mock authors.

## What was not changed

A few review comments were deliberately **not** acted on in Tier 0 because they were either out of scope or already tracked elsewhere:

- **Worker-boundary AAD propagation.** The crypto worker RPC (`cryptoWorker.decrypt` / `cryptoWorker.encrypt`) does not forward a caller-supplied AAD into the inner AEAD. Wrapping this end-to-end is a Tier 1 item tracked in `AEAD_AUDIT_2026-04-10.md` under the "Worker-boundary AAD propagation" heading. In the meantime `file-crypto.ts` uses `decryptEnvelope` (which enforces the wire-format label) as defense in depth.
- **CSP-report XFF trust.** The endpoint trusts `X-Forwarded-For` with no allowlist. In the current Caddy-fronted deployment this is safe, but when the app is deployed behind an untrusted reverse proxy, the rate-limit table becomes sprayable again. Tracked as a Tier 2 hardening item.
- **Non-error lint warnings.** 266 pre-existing biome warnings (a11y, `useExhaustiveDependencies`, `noArrayIndexKey` in enumerations of constant arrays, etc.) are unchanged on this branch. None are in Tier 0 crypto code.

## Branch status

All Tier 0 work plus the post-review fixes are on `feat/sec-tier-0-impl-albrecht` in the sibling worktree `~/projects/llamenos-hotline-impl-tier-0-albrecht`. PR #68 is updated with a post-implementation review section referencing this doc.
