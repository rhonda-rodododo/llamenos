# Security Spec Briefs

This directory contains **pre-spec briefing documents** for the security improvements workstream, one per tier of the [`SECURITY_IMPROVEMENTS_MASTER.md`](../SECURITY_IMPROVEMENTS_MASTER.md) roadmap.

## What these are

Each brief captures the context a fresh Claude session needs in order to author the actual spec for that tier. They exist because the research phase (2026-04-10) produced a large amount of context that would be lost if every spec-authoring session had to re-research from scratch.

**A brief contains:**
- The tier goal in one paragraph
- Why it matters (research findings + lessons + attack classes)
- Proposed approach at the synthesis level
- Current Llamenos state: relevant files, patterns, primitives
- Open design questions the spec author must decide
- Concrete scope boundaries (in / out)
- Trade-offs and anti-patterns to avoid
- Success criteria for the spec
- Pointers to primary sources and related repo work

**A brief is NOT:**
- The spec itself (which lives in `docs/superpowers/specs/`)
- The implementation plan (which lives in `docs/superpowers/plans/`)
- A committed decision — briefs are best-effort synthesis

## How to use a brief

1. **Start a fresh session** for a single tier.
2. **Load context:** have the session read `SECURITY_IMPROVEMENTS_MASTER.md` (sections relevant to the tier) + this brief.
3. **Invoke `superpowers:brainstorming`** — the brainstorming phase is largely pre-done, but the skill's process for presenting a design and getting approval still applies.
4. **Write the spec** to `docs/superpowers/specs/2026-04-10-security-tier-N-<topic>-design.md`.
5. **Invoke `superpowers:writing-plans`** to create the implementation plan at `docs/superpowers/plans/2026-04-10-security-tier-N-<topic>.md`.
6. **Implement** via `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

## Tier index

| Tier | Brief | Goal | Effort | Depends on |
|---|---|---|---|---|
| **0** | [`tier-0-albrecht-hardening.md`](./tier-0-albrecht-hardening.md) | Defensive hardening against published attacks (Albrecht, Mega); no architecture change | Days | — |
| **1** | [`tier-1-hpke-primitives.md`](./tier-1-hpke-primitives.md) | HPKE replaces ECIES; non-extractable CryptoKey; native X25519/Ed25519; items_key indirection | Weeks | Tier 0 |
| **2** | [`tier-2-unlock-recovery.md`](./tier-2-unlock-recovery.md) | WebAuthn PRF primary KEK; OPAQUE login; Diceware recovery; 1Password Recovery Group | Weeks | Tier 1 |
| **3** | [`tier-3-per-device-keys.md`](./tier-3-per-device-keys.md) | Keybase-style per-device keys; PUK; user sigchain; Cascading Lazy Key Rotation | ~1 month | Tier 1, 2 |
| **4** | [`tier-4-delivery-hardening.md`](./tier-4-delivery-hardening.md) | Split code/data origins; sandboxed crypto iframe; third-party verifier; whitepaper | Weeks (parallel to 3) | Tier 0 |
| **5** | [`tier-5-voice-e2ee.md`](./tier-5-voice-e2ee.md) | SFrame via RTCRtpScriptTransform; Asterisk media passthrough; DTLS fingerprint binding | Weeks | Tier 1; partial Tier 3 |
| **6** | [`tier-6-mls-pq.md`](./tier-6-mls-pq.md) | MLS via Wire core-crypto; ML-KEM-1024 hybrid via HKDF-combine | Months, optional | Tier 1, 3 |

## Convention

**Filename:** `tier-N-<kebab-topic>.md`
**Date:** All briefs are dated 2026-04-10 at creation. Update the frontmatter "last reviewed" if revisited.

Briefs are living documents until the corresponding spec is drafted. After the spec is approved, the brief should be updated with a pointer to the spec and marked as "absorbed into spec".

## Mandatory cross-cutting principles

Every spec in this workstream MUST honor the principles listed in §9 of the master doc:

1. Every ciphertext column AEAD — no exceptions.
2. Every KDF/HKDF consumes a label from `src/shared/crypto-labels.ts`.
3. Labels enforced at decrypt, not just encrypt.
4. Identity/device key only wraps other keys.
5. Shareable envelopes use different hierarchy than identity.
6. AEAD tag is the integrity mechanism — never client-side format checks.
7. IV + framing metadata covered by AEAD tag.
8. Membership changes signed into sigchain before rewrap.
9. Roles enforced by crypto, not server-asserted claims.
10. Publish audits and residual-risk statements.
