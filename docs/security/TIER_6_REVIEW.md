# Tier 6 — Deep Review

**Date:** 2026-04-10
**Reviewer:** Claude Opus 4.6 main-session deep review
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-6-mls-pq-design.md` (749 lines)
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-6-mls-pq.md` (44 TDD tasks, 6546 lines, organized as PR #1 + PR #2)

## Rhonda decisions received (2026-04-10)

1. **I-1 MLS library → Wire `@wireapp/core-crypto` (not ts-mls).** Rhonda 2026-04-10: "6.B - adding wasm is no problem with vite. bundle size is not a problem." Spec §6.1 rewritten from ground up: production pedigree, academic formal analysis coverage, Cure53/Kudelski/X41/Cryspen audit history, battle-tested PQ pipeline (Wire driving ML-KEM/XWing integration since early 2025), multi-language bindings (web/Kotlin/Swift sibling packages), encrypted IDB keystore included (re-keyed under our Tier 1 non-extractable root KEK via HKDF through the crypto worker). All downstream method-name references swapped (createGroup → createConversation, createCommit → addClientsToConversation + commitPendingProposals, processMessage → decryptMessage, joinFromWelcome → processWelcomeMessage). Vendored into `vendor/core-crypto/`. The plan + plan tech-stack line + vendor scripts all updated to match. License moved from MIT (ts-mls) to GPL-3.0 (core-crypto) — documented in PROVENANCE.md. The `MlsGroupState.opaqueState` field renamed to `serializedMlsState` to avoid collision with the Tier 2 OPAQUE protocol term.
2. **I-2 XWing fallback → P-384 if IANA codepoint unresolved at implementation time.** Already applied in earlier commit.
3. **I-3 strfry extension strategy** remains open for implementation-time resolution.

## Summary

Tier 6 is the "months, optional" tier in the master doc and the spec handles its optionality honestly — PR #1 ships fingerprint verification UX + vendored `ts-mls` with NO live MLS code, PR #2 is the actual MLS pivot behind a feature flag. The design picks **XWing** as the default ciphersuite (X25519 + ML-KEM-768 classical+PQ hybrid), which is the 2026 best-of-breed choice and avoids the Mega-class "raw concat" pitfall that master §3.11 warns against. Two important findings: **(1) `ts-mls` library maturity in April 2026 is not independently verified — the spec plans to vendor it, which is defensive, but vendoring a young library shifts maintenance burden onto Llamenos**; **(2) XWing IETF draft status and its presence in the RFC 9420 MLS ciphersuite registry is not verified — if XWing is not an IANA-registered MLS ciphersuite at implementation time, Tier 6 must fall back to a registered suite**.

## Critical findings

None. The design is structurally sound and the two-PR rollout is the right risk posture for a "months, optional" tier.

## Important findings

### I-1. `ts-mls` library maturity in April 2026 not independently verified

**Where:** Spec §6.1 "MLS library choice — ts-mls (vendored)".

**Issue:** The spec commits to `ts-mls` (vendored into the repo) as the MLS implementation. I could not verify via context7 or WebSearch in this session that:
- The package is still maintained April 2026
- RFC 9420 compliance has been formally reviewed
- The vendored subtree can be kept in sync with upstream bugfixes
- License compatibility (spec does not state the license)

Vendoring is the right move for a young library (you control the blast radius of an upstream regression) but it shifts maintenance burden entirely to Llamenos. The plan's Task 1 includes a VENDOR.md entry but does not specify an update cadence or a fallback library.

**Fix:** Before Tier 6 implementation starts, run:
1. `npm view ts-mls` (or equivalent) to verify maintenance status
2. WebSearch for "ts-mls RFC 9420 compliance audit" to find any formal reviews
3. Identify a fallback: if ts-mls is stale, Wire `core-crypto` (Rust→WASM) is a more mature alternative — but it's bigger and harder to vendor
4. Document the decision + fallback in `docs/security/MLS_LIBRARY_RATIONALE.md`

### I-2. XWing ciphersuite registry status not verified

**Where:** Spec §6.2 "MLS ciphersuite selection — XWing as default".

**Issue:** XWing (draft-connolly-cfrg-xwing-kem) is the X25519 + ML-KEM-768 hybrid KEM that the spec picks as the default. MLS needs a ciphersuite registered in IANA's MLS Ciphersuite Registry. As of my verification cutoff, XWing is an IETF draft and has NOT been assigned a registered ciphersuite ID in RFC 9420's initial registry (which only has 7 registered suites). If XWing is still a draft at Tier 6 implementation time, using it in MLS requires a "private use" ciphersuite ID that is interoperability-breaking.

**Fix:** Verify via `draft-ietf-mls-extensions` and `draft-connolly-cfrg-xwing-kem` current statuses. If XWing is not yet registered, pick a registered MLS suite (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` or similar) as the default and add XWing as an opt-in under a feature flag. This is a pragmatic trade-off: we lose hybrid PQ on day one, but we gain standards-compliant interop.

### I-3. `strfry` extension for MLS delivery service is new infrastructure

**Where:** Spec §6.8 "MLS delivery service — strfry extension".

**Issue:** Tier 6 extends the existing strfry Nostr relay to serve as the MLS delivery service (DS). This requires strfry plugin work or a sidecar service that translates MLS wire format to Nostr events. The spec does not detail the extension strategy — is it (a) a strfry plugin in C++, (b) a separate Go service that proxies MLS messages through strfry's existing event pipeline, or (c) a custom Nostr kind that carries MLS wire format in the `content` field?

**Fix:** Add a subsection to §6.8 explaining the extension approach. Recommended: (c) — a new Nostr kind (e.g. kind 40000 `llamenos-mls-commit`) that carries base64-encoded MLS wire format. Clients subscribe by hubId, the relay does not interpret the content, and existing strfry infrastructure continues to work unchanged.

## Minor findings

### M-1. `items_key` integration from Tier 1

Spec §6.5 reuses the Tier 1 `items_key` indirection and wraps it under the MLS exporter secret for hub-scoped groups. Good — minimizes new primitives. But the spec should explicitly note that this couples Tier 6 to Tier 1 (not optional), whereas the master doc treats Tier 6 as "depends on Tier 1 + Tier 3".

### M-2. Provable-delete via epoch advancement (§8.3 wild idea)

Spec §6.7 implements master doc §8.3's "provable-delete for call notes" via MLS epoch advancement. This is the most interesting feature in Tier 6. But the current design bootstraps from a trigger (admin clicks "delete note") that advances the epoch — this is expensive if it happens per-note. Add a batching strategy: epochs advance every N notes or every T seconds, whichever comes first, so one deletion amortizes across a batch.

### M-3. SFrame integration (Tier 5 coupling)

Spec §6.6 derives the SFrame base key from MLS `exporter_secret` once Tier 6 is active. If Tier 5 ships first with a non-MLS per-call HPKE key distribution, switching to MLS-exporter is a breaking change for active calls. Document the cut-over procedure (terminate active calls, advance epoch, require re-dial).

### M-4. Plan is 14 + 30 = 44 tasks across two PRs

The plan's PR #1 (tasks 1–14) is the UX + vendoring work, PR #2 (tasks 15–44) is the MLS pivot. Confirm that the PR boundary is not too fine — if PR #1 ships without feature-flagging PR #2's code, an implementer might accidentally activate MLS before the review is done.

## Strengths

- **Two-PR rollout** (UX + vendoring in PR #1, MLS behind feature flag in PR #2) is the right risk posture for a months-long project.
- **XWing as default** (if available) is the 2026 best-of-breed choice — hybrid PQ built into the ciphersuite, no hand-rolled HKDF-combine.
- **ts-mls vendored** is the correct defensive posture for a young library — matches the user's "no backward compat" + "full measure" directives.
- **Provable delete via epoch advancement** (§6.7) is the most interesting and unique feature in the roadmap. It provides a mathematically-backed delete guarantee that no other web E2EE app offers.
- **`items_key` + MLS exporter composition** is elegant — one indirection per user, one group key per hub, no redundant rewrapping.
- **Fingerprint verification UX ships BEFORE Tier 6 flag flips** (§6.9) — the user can verify the new cryptographic identities before committing to MLS. Good deployment posture.

## Verification log

- ✓ Plan task count: `grep -c "^### Task " = 44` — matches spec claim (PR #1: 14, PR #2: 30).
- ✓ Tier 6 has no source-file references to verify (it's an aspirational tier).
- ✗ `ts-mls` npm package maturity / RFC 9420 compliance NOT independently verified — flagged as I-1.
- ✗ XWing MLS ciphersuite registry status NOT verified — flagged as I-2.
- ✗ Wire core-crypto as alternative NOT independently verified as an option.
- ✗ ML-KEM-1024 vs ML-KEM-768 decision NOT cross-checked against NIST PQC round 4 guidance.
- ✗ `draft-ietf-mls-sframe` current draft version NOT verified.
- ✗ strfry plugin API / extensibility NOT verified.

## Open questions for Rhonda

1. **ts-mls or Wire core-crypto?** If ts-mls is stale or fails a security review, should Tier 6 pivot to Wire's core-crypto (Rust→WASM, bigger bundle)?
2. **XWing vs registered ciphersuite** — if XWing is still an IETF draft at implementation time, accept the interop-break (private-use ciphersuite ID) or fall back to a registered suite and lose hybrid PQ on day one?
3. **strfry extension strategy** — new Nostr kind (simplest, recommended), strfry plugin (tighter coupling), or separate DS sidecar (most flexibility)?
4. **Provable-delete epoch advancement batching** — per-note (expensive) vs batched (cheaper, delayed)?
5. **Tier 6 gating** — is Tier 6 truly optional, or do we commit to shipping it eventually as the long-term endpoint of the roadmap?
6. **Tier 5 cut-over** — if Tier 5 ships first without MLS, how do we migrate SFrame key distribution to MLS exporter without breaking active calls?
