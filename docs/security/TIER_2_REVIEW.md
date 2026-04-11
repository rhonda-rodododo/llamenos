# Tier 2 — Deep Review

**Date:** 2026-04-10
**Reviewer:** Claude Opus 4.6 main-session deep review
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-2-unlock-recovery-design.md` (1018 lines)
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-2-unlock-recovery.md` (35 TDD tasks, 6087 lines)

## Rhonda decisions received (2026-04-10)

1. **I-1 Multi-hub recovery → per-hub.** Confirmed. Spec §2.4.2 "Multi-hub recovery semantics" subsection added: each ceremony runs against exactly one hub; the same root KEK wrapped under multiple hubs means one successful recovery restores cross-hub access; cascading design explicitly rejected.
2. **I-2 Argon2id bump → OWASP standard floor.** Confirmed ("fine b/c a rare occurrence"). Spec updated: `m=47 MiB, t=1, p=1` across every unlock derivation path. Wall-clock: ~600–900 ms phone, ~200–300 ms desktop.
3. **I-3 OPAQUE library → deferred with fallback algorithm.** Confirmed "no easy answer". Spec §2.2.1 updated with an implementation-time decision algorithm: (a) `@serenity-kit/opaque` maturity check; (b) fallback to a thin Rust→WASM wrapper over `facebook/opaque-ke` directly; (c) second fallback drops OPAQUE entirely. The spec commits to the DECISION ALGORITHM, not the library.

## Summary

Tier 2 is the most ambitious non-architectural tier and the spec handles the threat surface well — dropping PIN as a KEK factor, making PRF primary, and ordering the recovery paths (PRF → OPAQUE → Diceware → 1Password Recovery Group) in descending strength is the right call. The spec's exploration of the current codebase is unusually accurate (line counts for `key-store-v2.ts`, `key-manager.ts`, `webauthn.ts`, `auth-facade.ts` all verified). Three important findings: **(1) the 1Password Recovery Group is scoped per-hub but the key material per-user — the spec should explain this discrepancy**; **(2) Argon2id parameter choice (m=19 MiB) is at the low end of 2026 OWASP recommendations**; **(3) OPAQUE library maturity in April 2026 is not independently verified and the spec commits to `@serenity-kit/opaque` without a fallback**.

## Critical findings

None. The core design is sound.

## Important findings

### I-1. Recovery Group granularity ambiguity

**Where:** Spec §2.4 "1Password-style Recovery Group". `hub_recovery_groups` is a per-hub table, but the wrapping envelope (`user_recovery_envelopes`) is per-user.

**Issue:** The spec says the hub Recovery Group wraps each member user's root KEK. But a volunteer is a member of potentially multiple hubs (multihub architecture per `project_multihub_architecture.md`), so each user has N envelopes — one per hub they belong to. What happens on cross-hub recovery? Does the volunteer initiate recovery in ONE hub and the remaining hubs' envelopes stay un-recovered? Or does recovery cascade across all the user's hubs?

**Fix:** Add a "Multi-hub recovery" subsection to §2.4 explaining the semantics. Recommended: recovery is per-hub, cascading must be requested explicitly by the volunteer, audit-log entries in each hub.

### I-2. Argon2id parameters at the low end of 2026 recommendations

**Where:** Spec §2.3.3 "Phrase-to-KEK derivation" — `Argon2id(m=19 MiB, t=2, p=1)`.

**Issue:** OWASP's 2024 password storage cheat sheet recommended Argon2id with `m=47 MiB, t=1, p=1` OR `m=19 MiB, t=2, p=1` OR `m=12 MiB, t=3, p=1`. The spec picks the weakest of the three. For a 15-word EFF-large phrase (≈194 bits of entropy), this is still fine because entropy dominates over KDF cost — but if a user only enters part of the phrase, or the entropy assumption is wrong, the lower cost hurts.

**Fix:** Bump to `m=47 MiB, t=1, p=1` (OWASP's first recommendation) unless there's a concrete browser-performance reason to stay at 19 MiB. Add a benchmark task in the plan to measure derivation time on a mid-range phone and document.

### I-3. `@serenity-kit/opaque` is not independently verified

**Where:** Spec §2.2.1 "Library choice".

**Issue:** The spec commits to `@serenity-kit/opaque` (WASM build of facebook/opaque-ke) as the OPAQUE library. I could not verify via context7 (not indexed) or WebSearch in this session that the package is actively maintained as of April 2026 — the last known Cure53 audit of facebook/opaque-ke was 2022. OPAQUE implementations are load-bearing for the attack surface, and an abandoned library is a risk.

**Fix:** Before shipping Tier 2, add an explicit "library maturity check" task to the plan: verify `@serenity-kit/opaque` has had a commit within the last 6 months, verify facebook/opaque-ke still compiles cleanly, and document the ciphersuite (`ristretto255-sha512` vs `p256-sha256`). If `@serenity-kit/opaque` is stale, consider `opaque-wasm` or rolling our own thin wrapper over the Rust crate.

## Minor findings

### M-1. Recovery phrase entropy math

The spec says "15-word phrase from the EFF large wordlist (≈194 bits of entropy)". The EFF large wordlist is 7776 words, so 15 words = log2(7776^15) ≈ 194.07 bits. This is correct. But the spec uses a 12-word BIP39-style phrase in some sections and a 15-word EFF phrase in others (plan Task 20 mentions "24-word BIP39" under Tier 3 for paper keys). Make sure the spec is internally consistent: 15-word EFF for recovery phrase, 24-word BIP39 for paper keys if Tier 3 adds them.

### M-2. `LABEL_*` constants to be removed

Spec §9 ("Current Llamenos state") says to remove `LABEL_NSEC_KEK_2F`, `LABEL_NSEC_KEK_3F`, `LABEL_KEK_PRF`, `LABEL_IDP_VALUE_WRAP`, `RECOVERY_SALT` after all callers are gone. Good — but the plan should explicitly include a task that `grep -rn "LABEL_NSEC_KEK_2F|LABEL_NSEC_KEK_3F|..." src` returns zero and flag it as part of the verification gate.

### M-3. 24-hour mandatory delay on recovery is not tied to a database column

Spec §2.4.4 "24-hour mandatory delay". The implementation needs a `recovery_sessions.initiated_at` column + a server-side check that `now() - initiated_at >= 24h` before completing the recovery. The plan Task 20 mentions the endpoint but does not detail the delay enforcement. Add an explicit assertion.

### M-4. Migration number 0052 or later

Same collision risk as Tier 1. The plan mentions migration numbering — confirm against post-v0.41.0 main and any migrations Tier 0 / Tier 1 introduced first.

## Strengths

- **Dropping PIN as KEK factor** is the most important security decision in Tier 2. The spec is explicit about why (leaked IDB blob + PIN brute force = minutes) and the replacement PRF is strictly stronger.
- **OPAQUE + export_key as a second KEK-unwrapping route** is the correct design — the password never leaves the client, and the server never sees key material, not even in transit.
- **Audit sigchain integration** — every recovery op gets a signed audit entry so silent abuse is detectable. This ties Tier 2 into Tier 0's sigchain the right way.
- **2-of-3 Shamir for Recovery Group** prevents any single admin from recovering a user's data. Matches 1Password Business' published design.
- **Spec accurately reads the current codebase** — line counts for `key-store-v2.ts` (302), `key-manager.ts` (582), `auth-facade.ts` (1372), `webauthn.ts` client (108), server (94) all verified in this review. The spec was written against reality, not imagination.

## Verification log

- ✓ `src/client/lib/key-store-v2.ts` is 302 lines (spec claims 303 — off by one, trivial)
- ✓ `src/client/lib/key-manager.ts` is 582 lines (spec claims 582)
- ✓ `src/client/lib/webauthn.ts` is 108 lines (spec claims 109 — off by one)
- ✓ `src/server/routes/auth-facade.ts` is 1372 lines (spec claims 1372)
- ✓ `src/server/lib/webauthn.ts` is 94 lines (spec claims 94)
- ✓ Plan task count: `grep -c "^### Task " = 35` — matches spec claim
- ✗ `@serenity-kit/opaque` maturity NOT independently verified — flagged as I-3
- ✗ WebAuthn PRF browser support matrix April 2026 NOT independently verified
- ✗ EFF large wordlist used by existing crypto libraries NOT cross-checked against @scure/bip39 (which uses BIP39 wordlist, not EFF)

## Open questions for Rhonda

1. **Multi-hub recovery semantics** — recovery per-hub (recommended) vs cascading across all hubs on one initiation?
2. **Argon2id parameter bump** — accept OWASP's stronger recommendation (m=47 MiB, t=1, p=1), or stay at the cheaper (m=19 MiB, t=2, p=1) for mid-range phone compatibility?
3. **OPAQUE library choice** — stay on `@serenity-kit/opaque`, or commission a thin wrapper over facebook/opaque-ke's Rust crate for direct control?
4. **24-hour recovery delay** — confirm the delay applies to the Recovery Group path only (not PRF / OPAQUE / recovery phrase paths, which are user-initiated and need to be fast).
5. **EFF large vs BIP39 wordlist** — the spec uses EFF for the recovery phrase but Tier 3 uses BIP39 for paper keys. Confirm this divergence is intentional (EFF is better UX for human entry; BIP39 is the standard for hardware wallet interop).
