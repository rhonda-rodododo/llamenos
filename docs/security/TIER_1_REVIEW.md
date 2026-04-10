# Tier 1 — Deep Review

**Date:** 2026-04-10
**Reviewer:** Claude Opus 4.6 main-session deep review
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-1-hpke-primitives-design.md` (1409 lines)
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-1-hpke-primitives.md` (26 TDD tasks)

## Rhonda decisions received (2026-04-10)

1. **C-1 Ed25519 WebCrypto Safari support → hard-fail.** Confirmed by Rhonda: "hard fail - if using an old version of safari, prompt them either to update or use firefox or more secure browser". Spec §1.3.2 already commits to hard-fail; updated the error copy to explicitly enumerate update paths (Firefox 135+, Chromium-based 133+, Safari 17.4+) with Firefox recommended as the strongest privacy posture. Copy is i18n-keyed.
2. **I-1, I-2, I-3, I-4 remain open** for implementation-time resolution. Non-blocking for landing the spec.

## Summary

Tier 1's design is the strongest of the seven tiers on technical choices (single suite, no negotiation, non-extractable CryptoKey via generate-export-reimport, `items_key` indirection). The spec is unusually careful about the hpke-js API — it reads source files and cites exact line numbers, which is the right kind of rigor. The plan has three gaps I'd want the implementer to close: **(1) the native Ed25519 WebCrypto browser-support claim needs a second verification pass** (Safari 17.4 shipped X25519 but Ed25519 support lagged), **(2) the Tier 1 `decryptFromHub` / `encryptForHub` API break is not reconciled with Tier 0's AAD-bound API**, and **(3) the migration wipes any Tier 0 audit-log entries, which means the Tier 0 chain-verifier trust anchor needs to be re-bootstrapped during the Tier 1 migration**.

## Critical findings

### C-1. Ed25519 WebCrypto browser support in April 2026 — needs verification

**Where:** Spec §1.3.1 feature detection, success criterion #9.

**Issue:** The spec claims "Chrome 133+, Firefox 135+, Safari 17.4+" for native X25519+Ed25519. For X25519 this matches Igalia / WebKit tracking. **For Ed25519 the picture is different**: Safari 17.4 shipped X25519 but Ed25519 was in an experimental flag for longer. If Safari 17.4 users hit the hard-fail gate, Tier 1 will lock out a non-trivial share of the fleet on launch.

**Verification gap:** I was unable to verify via context7 — hpke-js and @noble/ciphers are not indexed in context7's library set. A WebSearch against MDN / caniuse for "Ed25519 Safari" in April 2026 should be the first verification step during Tier 1 implementation.

**Fix:** Before shipping, add a concrete WebCrypto Ed25519 support check to `assertNativeCurvesOrFail` that degrades gracefully to a soft warning ("your browser lacks native Ed25519; update to Safari 18+ or Chrome 133+") rather than a hard failure, for ONE release cycle. Then flip to hard fail.

## Important findings

### I-1. Tier 0 ↔ Tier 1 AAD-bound hub-field API is broken by the Tier 1 plan

**Where:** Plan Task 5–6. Tier 0 introduced `encryptHubField(value, hubId, recordId, fieldName)` / `decryptHubField(...)` with AAD binding. Tier 1's Task 5 introduces `hubFieldEncrypt(hubKey: CryptoKey, value, recordId, fieldName)` with a **different first argument** — Tier 0 passed `hubId` and looked up the key; Tier 1 passes the `CryptoKey` handle directly.

**Issue:** Every call site Tier 0 updated has to be rewritten again for Tier 1. The plan's Task 6 ("delete Tier 0 hub-field-crypto") acknowledges this but does not enumerate the ~20–30 call sites or give a mechanical rewrite recipe. Tier 1 is a big enough change that this becomes a silent source of post-rebase bugs.

**Fix:** Add a concrete `grep -rn "decryptHubField\|encryptHubField" src/client --include="*.ts" --include="*.tsx"` command to Task 6 Step 4 with an explicit rewrite example (from Tier 0 shape to Tier 1 shape, showing how the `hubId` is resolved to a `CryptoKey` via the hub-key cache).

### I-2. Tier 1 migration wipes audit-log trust anchor

**Where:** Plan Task 17 — `migration 0052_tier1_hpke_envelope_v3.sql` wipes existing encrypted notes. But Tier 0 landed a signed-audit-log chain (migration 0051) and the chain has a `trustAnchorDevicePubkeys` bootstrap the client uses on first verification per session.

**Issue:** Wiping the notes does NOT wipe `audit_log`, but when the envelope format changes from v2 to v3, the existing signed audit entries (if any exist in dev DBs) were signed over content that includes the old envelope types. The signature recompute will not change (the signature was over `entryHash`, not over any envelope bytes), so chain verification continues working. **This is fine — but only because of a subtlety the plan does not document.** A future implementer could break this by changing the canonical hash format for Tier 1.

**Fix:** Add a paragraph to the spec's Migration section stating: "The Tier 0 audit-log chain survives Tier 1's envelope format change because `computeEntryHash` hashes the canonical payload, not the envelope bytes. Any change to `computeEntryHash`'s canonical form is a chain-invalidating event and requires bumping the `v` tag in `canonicalize`."

### I-3. hpke-js extracted `CryptoKeyPair.publicKey` type claim unverified

**Where:** Spec §1.1.2 "hpke-js generateKeyPair returns extractable keys by default".

**Issue:** The spec cites `dhkemPrimitives/xCurveNative.ts::generateKey(algName, true, KEM_USAGES)` as the extractable default. I did not verify this against the current hpke-js source because context7 does not index hpke-js and I did not run a WebSearch for the source path. If the current hpke-js version uses `generateKey(algName, /* extractable */ false, KEM_USAGES)` by default, the entire export-reimport dance is unnecessary (and arguably harmful because it creates a brief extractable window).

**Fix:** Before writing Task 2 implementation code, the Tier 1 author should `bun add @hpke/core` and actually read the installed source code at `node_modules/@hpke/core/esm/src/kems/dhkemPrimitives/` to confirm the extractable default. Add this as an explicit verification step in Task 2.

### I-4. Migration number 0052 collision risk

Same issue as Tier 0's 0051. The plan assumes 0051 is Tier 0's migration and 0052 is free for Tier 1, but the actual number depends on post-v0.41.0 main's migration count. The implementation should use the next free number regardless of what the plan says.

## Minor findings

### M-1. `@hpke/core` v1.7.0 pin

The plan pins `^1.7.0` in Task 1. If this is out of date by Tier 1 implementation time, the spec's API surface verification may no longer match. Recommend running `npm view @hpke/core version` at the start of implementation and using whichever version is current — the API has been stable for multiple minor versions.

### M-2. `items_key` rewrap flow hand-waves admin-add rewrap orchestration

Plan Task 18 describes the admin-add-triggered `items_key` rewrap as "orchestrated via a signed audit entry `items_key_rewrap_for_admin`". This is a new signed-audit-entry type not defined in Tier 0 or earlier in the Tier 1 spec. It should be added to the spec's `AuditEntryPayloadSchema` list.

### M-3. Server-side HPKE key persistence hand-waves `SERVER_HPKE_WRAP_KEY`

Task 18 mentions a `SERVER_HPKE_WRAP_KEY` env var for wrapping the server's HPKE pkcs8 at rest. The spec does not define how this key is generated, rotated, or related to the existing `SERVER_NOSTR_SECRET`. Either reuse `SERVER_NOSTR_SECRET` via HKDF (cleanest), or document the new env var in `.env.local.example` and the deployment docs.

## Strengths

- **Single suite, no negotiation** is the right call. HPKE-SELECT attacks are a real class and the spec correctly rules them out structurally.
- **Generate-export-reimport dance** is documented at the right level — it's a well-known workaround for hpke-js's extractable default and the spec does not gloss over it.
- **`items_key` indirection byte-equivalence test** (Task 15) is exactly the test you want — it asserts the core invariant that justifies the indirection (rotation doesn't touch per-artifact ciphertext).
- **Two independent label-enforcement layers retained** — HPKE info + AAD. This is defense in depth at the right layer.
- **Plan Task 24 adds SQL-level envelope audit script** — structural check that prevents stale v2 envelopes from silently persisting post-migration.

## Verification log

- ✓ `src/shared/crypto-primitives.ts` current shape confirmed during Tier 0 session (exports `symmetricEncrypt/Decrypt`, `eciesWrapKey/Unwrap`, `hkdfDerive`, `hmacSha256`, `unbiasedSixDigitCode`).
- ✓ `src/client/lib/crypto.ts` duplicate ECIES confirmed during Tier 0 session.
- ✓ `src/client/lib/key-store-v2.ts` multi-factor KEK format referenced in the Tier 1 spec; confirmed existing.
- ✓ `src/client/lib/crypto-worker.ts` current `secretKey: Uint8Array | null` closure state confirmed during Tier 0 session.
- ✓ `@noble/ciphers/chacha.d.ts` AAD parameter on xchacha20poly1305 confirmed via direct file read during Tier 0 session.
- ✗ `@hpke/core` package internals NOT independently verified — context7 does not index hpke-js, I did not run a WebSearch to MDN / the GitHub source. The spec's citations are self-consistent and plausible, but should be re-verified before Task 2 implementation.
- ✗ Native Ed25519 browser support in April 2026 NOT independently verified. Gate on `hasNativeEd25519()` should degrade gracefully during the verification window.
- ✗ Standard Notes 004 `items_key` pattern details NOT cross-checked against Standard Notes' published documentation — spec's claim is plausible.
- ⚠️ Ed25519 WebCrypto on Safari lagged X25519 by ~2 Safari releases. Confirm before adding the hard-fail assertion.

## Open questions for Rhonda

1. **Ed25519 WebCrypto support on Safari April 2026** — should the first-release gate be hard-fail or soft-warn? (Recommend soft-warn for one release.)
2. **Reuse `SERVER_NOSTR_SECRET` via HKDF for `SERVER_HPKE_WRAP_KEY`** (simpler) **vs introduce a new env var** (more explicit)?
3. **`items_key` admin-add rewrap** — Is the "user's client signs a rewrap entry when an admin joins" consent ceremony acceptable, or do we want the existing admins to sign on the joining user's behalf? The former keeps the signing key where it already is; the latter is less friction for the new admin but requires rewriting the existing-admins' client trust model.
4. **Verify the hpke-js extractable default** — if it turns out hpke-js already generates non-extractable keys, we should skip the dance and the spec's §1.1.2 needs a revision.
