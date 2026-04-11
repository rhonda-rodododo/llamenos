# Security Overhaul — Implementation Queue

**Last updated:** 2026-04-11
**Target:** Weekend of 2026-04-11 / 2026-04-12, with Tier 6 PR #2 landing on its own months-long schedule per the spec.

## Purpose

The "pick up where we left off" breadcrumb for the seven-tier security overhaul workstream. Every implementation session's **first action** is to read this file, find the next unblocked tier / sub-PR, and proceed. Every session's **last action** is to update this file with what landed and what's next.

## Status at a glance

| Tier | Spec+Plan PR | Status | Implementation PR(s) | Blockers |
|---|---|---|---|---|
| **docs** | #60 PII hook | **Merged** | — | — |
| **docs** | #61 CLAUDE.md drift | **Merged** | — | — |
| **docs** | #62 implementation queue + kickoff template | **Merged** | — | — |
| **docs** | #63 tier session prompts | **Merged** | — | — |
| **0 Albrecht** | #52 | **Merged** | — | None; **ready to implement — queue head** |
| **1 HPKE** | #53 | **Merged** | — | Waits on Tier 0 implementation |
| **2 Unlock+Recovery** | #54 | **Merged** | — | Waits on Tier 1 implementation |
| **3 Per-device keys** | #55 | **Merged** | — | Waits on Tier 2 Diceware (2.B) |
| **4 Delivery hardening** | #56 | **Merged** | — | Waits on Tier 0 only; parallel with Tier 1/2/3 |
| **5 Voice E2EE** | #57 | **Merged** | — | Main waits on Tier 1; prereq sim-SIP-bridge PR has **no tier dependency** |
| **6 MLS + PQ** | #58 | **Merged** | — | PR #1 waits on Tier 3.A; PR #2 waits on Tier 3.C |

## Dependency graph

```
Tier 0 ────┬─→ Tier 1 ────┬─→ Tier 2 ────┬─→ Tier 3 ───→ Tier 6
           │              │              │
           ├─→ Tier 4     ├─→ Tier 5     │
           │              │              │
           └─────────┴──────────┴────────┘
                     (shared: Tier 0 is a hard prerequisite for all)
```

Arrows are hard dependencies. Tiers without an arrow between them can run in parallel.

## Implementation PR decomposition

Each tier's spec+plan lands as a single doc PR. Implementation is split into smaller PRs at natural task boundaries for reviewability.

| Tier | Impl PRs | Rough scope |
|---|---|---|
| **0 Albrecht** | 1 | Label brand + envelope v2 + AEAD audit + signed sigchain + CSP L3 + cosign + SBOM — cohesive defensive pass |
| **1 HPKE** | 2 | (a) HPKE + CryptoLabel + EnvelopeV3 + non-extractable `CryptoKey` + crypto-worker rewrite; (b) `items_key` indirection + hub-field call-site migration |
| **2 Unlock** | 3 | (a) Rust OPAQUE wrapper vendor + key-store-v3 + PRF primary; (b) Diceware recovery phrase + unlock orchestration; (c) Recovery Group + Shamir + admin UI |
| **3 Devices** | 3 | (a) device identity + PUK + sigchain base; (b) cross-signing + master key recovery; (c) CLKR + per-device hub key + device-revoke worker |
| **4 Delivery** | 3 | (a) origin split + Caddy + Ansible + cookies; (b) sandboxed crypto iframe + RPC + Trusted Types; (c) verifier + gossip + whitepaper + residual risk + warrant canary |
| **5 Voice** | 2 | (a) sim-SIP-bridge fixtures **(prerequisite, no tier dep)**; (b) Tier 5 main implementation |
| **6 MLS+PQ** | 2 | (a) fingerprint UX + vendored `@wireapp/core-crypto` skeleton (feature-flagged off); (b) MLS code path behind flag + staged rollout |

**Total implementation PRs: 16** + 2 translation sessions (Tier 5.A locales + Tier 5.B translation sweep).

## Weekend timeline — realistic

Assumes parallel implementers + aggressive `superpowers:subagent-driven-development` dispatch.

### Friday evening (2026-04-10)

- **Merge prep PRs (doc-side):** #60 → #61 in that order.
- **Merge Tier 0 spec+plan:** #52 first (master doc + briefs + Tier 0 spec/plan + Tier 0 review + PII-hook cherry-pick).
- **Rebase and merge Tiers 1–6 spec+plan PRs** (#53–#58) — trivial rebases once #52 lands because the master-doc commits auto-drop.
- **Open PR for Tier 5 prerequisite (sim-SIP-bridge fixtures).** Pure test infra, no tier dependency, can be started immediately by Session B.

### Saturday

- **Session A:** Tier 0 implementation (single PR, 36 tasks). Finish mid-afternoon if parallelized well.
- **Session B:** Tier 5 prerequisite (sim-SIP-bridge fixtures PR) → then Tier 4 PR-A (origin split + Caddy + Ansible) once Tier 0 lands.
- **Session A (evening):** Tier 1 PR-A (HPKE primitives + crypto-worker rewrite).

### Sunday

- **Session A:** Tier 1 PR-B (`items_key` + call-site migration) → Tier 2 PR-A (OPAQUE wrapper + key-store-v3 + PRF).
- **Session B:** Tier 4 PR-B (crypto iframe) → Tier 4 PR-C (verifier + gossip + whitepaper).
- **Session A (afternoon):** Tier 2 PR-B (Diceware) → Tier 2 PR-C (Recovery Group).
- **Session A (evening):** Tier 3 PR-A (device identity + PUK + sigchain base).
- **Session B (evening):** Tier 5 main PR.

### Post-weekend

- **Week of 2026-04-13:** Tier 3 PR-B + PR-C, Tier 6 PR #1 (fingerprint UX + vendored core-crypto skeleton).
- **Month of 2026-04:** Tier 6 PR #2 (MLS behind feature flag) — the spec's own rollout schedule gates this (internal month 1 → volunteer opt-in month 2 → default month 3).

### Honest caveats

- **Tier 3 is the biggest tier.** 48 tasks, master doc §7 says ~1 month effort. Getting all 3 Tier 3 PRs merged in a weekend is ambitious. Realistic target: PR-A on Sunday, PR-B and PR-C the following week.
- **Tier 6 PR #2 is not a weekend target.** The spec's staged rollout (internal → opt-in → default) is measured in months by design. The weekend target for Tier 6 is PR #1 only (fingerprint UX + vendored skeleton, feature flag off).
- **Tier 5 translation sweep (session B) is a separate multi-session follow-up** for the 22-locale translation quality work. Not weekend-scope.

## Parallelism rules

**When a second implementer is available:**

- **Session A** is the main-thread sequencer: 0 → 1 → 2 → 3.
- **Session B** runs tiers that depend only on Tier 0: 5-prereq (anytime), 4 (after Tier 0).
- **Session C (if available)** runs 5-main after Tier 1 lands, or 3 PR-B/C after 3 PR-A.

**Merge conflict avoidance:**

- Tier 1 PR-A and Tier 4 PR-A touch different files. Safe to parallelize.
- Tier 2 PR-A and Tier 4 PR-B both touch `src/client/lib/crypto-*` — **serialize** them or merge Tier 2 PR-A first.
- Tier 3 PR-A introduces `vendor/opaque-wrapper/` (Tier 2) and new device tables — orthogonal to Tier 4.
- Tier 5 prereq touches only `tests/fixtures/`, no collision risk with any other tier.

## Session hygiene (mandatory)

Every session MUST:

1. **Read this file first.** Pick the first unblocked item. Update the "Implementation PR(s)" column when work starts (mark as "in progress, worktree at ...").
2. **Create a fresh worktree** per sub-PR: `git worktree add ../llamenos-hotline-impl-tier-N-<slug> feat/sec-tier-N-impl-<slug> origin/main`.
3. **Run `bun install`** in the worktree so `prepare` fires `lefthook install` and the PII hook is active.
4. **Confirm `PII_CHECK_PATTERNS` is set in the shell.** `echo "$PII_CHECK_PATTERNS"` should print your patterns.
5. **Read the spec** (the contract) and the plan (the roadmap). Spec wins on any conflict.
6. **Dispatch via `superpowers:subagent-driven-development`.** Parallel non-dependent tasks within the PR.
7. **Close plan checkboxes** as tasks land. The plan file is the progress ledger.
8. **Run the plan's final verification task** before pushing. Typecheck + lint + build + unit + API E2E + UI E2E must be green.
9. **Update this file** at session end with the PR link, status, and any notes for the next session.
10. **Never use `--no-verify`.** The PII hook and lint are load-bearing.

## Current queue head: **Tier 0 implementation** (ready now)

All prep merged to main as of 2026-04-11:

- [x] PR #60 (PII hook) merged
- [x] PR #61 (CLAUDE.md drift) merged
- [x] PR #62 (implementation queue + kickoff template) merged
- [x] PR #52 (Tier 0 spec+plan+review) merged
- [x] PRs #53–#58 (Tiers 1–6 spec+plan+review) merged
- [x] PR #63 (tier session prompts) merged

**Session kickoff:** use the paste-ready prompts in `docs/superpowers/TIER_SESSION_PROMPTS.md` — one fully-fleshed prompt per implementation PR. For generic session mechanics see `docs/superpowers/SESSION_KICKOFF_TEMPLATE.md`.

**First task in the Tier 0 plan:** Task 1 — Branded `CryptoLabel` type + `LABEL_REGISTRY`. File: `src/shared/crypto-labels.ts`. See plan step 1 for the failing test to write first.

### Parallel session opportunities (as of 2026-04-11)

- **Session A:** Tier 0 implementation (queue head).
- **Session B:** Tier 5 prerequisite PR (sim-SIP-bridge fixtures). Zero tier dependency — safe to start in parallel with Session A immediately.

Once Tier 0 lands, the next parallel wave is Tier 1 PR-A (Session A) + Tier 4 PR-A (Session B).

## Open cross-tier considerations for implementers

Items flagged across the deep reviews that any implementation session should be aware of:

1. **Migration numbers are placeholders.** Every plan says `drizzle/migrations/NNNN_*.sql` in its task bodies with specific numbers (e.g. `0051_audit_log_signed_entries.sql`). At implementation time, run `ls drizzle/migrations/ | sort | tail -5` and use the next unused integer. The plan headers note this explicitly.
2. **`@noble/ciphers` AAD API** is `xchacha20poly1305(key, nonce, AAD?)` — third positional argument. Verified in Tier 0 spec authoring via `node_modules/@noble/ciphers/chacha.d.ts` line 48.
3. **Tier 1 ↔ Tier 0 API break on hub-field encryption.** Tier 0 introduces `encryptHubField(value, hubId, recordId, fieldName)`; Tier 1 rewrites it to `hubFieldEncrypt(cryptoKey, value, recordId, fieldName)`. Every React Query `queryFn` needs the migration. Tier 1 plan Task 6 has the mechanical rewrite recipe + the new `getHubKeyCryptoKeyForId` helper.
4. **Tier 1 ↔ Tier 0 envelope format break.** `EnvelopeV2` (from Tier 0) is wholesale replaced by `EnvelopeV3` (from Tier 1). Pre-production allows clean cuts; dev DBs are wiped on the Tier 1 migration.
5. **Tier 2 dependency on Tier 1.** Non-extractable `CryptoKey` + HPKE from Tier 1 are prerequisites for the Tier 2 key-store-v3 design.
6. **Tier 3 dependency on Tier 2 Diceware phrase only** (not the full Tier 2 Recovery Group). Tier 3 can merge once Tier 2 PR-B (Diceware) lands; Recovery Group wrap is added incrementally later.
7. **Tier 4 iframe CSP is `connect-src 'none'`.** The crypto iframe makes ZERO network requests. Ciphertext flows in via postMessage, plaintext flows out. Don't accidentally add a `connect-src 'self'` in the iframe's CSP — that would break the design invariant.
8. **Tier 5 fallback UX is a modal, not a passive banner.** Volunteers must actively consent to a non-E2EE call. Silent fallback is banned per master §3.11 Mega lesson.
9. **Tier 6 library is `@wireapp/core-crypto`, not `ts-mls`.** Earlier drafts of the Tier 6 spec said `ts-mls`; the final decision is `@wireapp/core-crypto` (WASM) with `createConversation`/`decryptMessage`/etc. method names.

## GitHub support ticket (operational debt)

Unreachable commits from the Rikki→Rhonda history rewrites are still accessible via direct SHA URL on GitHub until GC. To purge, open a support ticket at https://support.github.com/contact citing repo + SHAs + GDPR Article 17:

- `887ee646`
- `32bc0eda`, `08de126c`
- `d3a4a77d`, `d4effa3d`
- `80162f2e`, `f40291de`
- `577123ea`, `27761c75`
- `007892ed`, `56b7a3c7`
- `b0bec0bf`, `98253986`

Support typically responds in 24–48 h.

## Revision history

- **2026-04-10 (Rhonda + Claude Opus 4.6):** Initial queue created. All 7 tier specs + plans + reviews in PRs #52–#58. Doc hygiene PRs #60, #61 in flight. Tier 0 is queue head.
- **2026-04-11 (Rhonda + Claude Opus 4.6):** All prep PRs merged — #60, #61, #62, #52, #53, #54, #55, #56, #57, #58, #63. Main now contains every tier's spec+plan+review plus the 16 paste-ready implementation prompts in `TIER_SESSION_PROMPTS.md`. Ready for parallel implementation sessions (Session A on Tier 0, Session B on Tier 5 prereq).
