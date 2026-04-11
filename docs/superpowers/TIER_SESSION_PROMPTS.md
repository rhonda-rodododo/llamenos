# Tier Implementation Session Prompts

Paste-ready prompts for each implementation PR in the seven-tier security
overhaul. Copy the matching section into a fresh Claude Code session and hit
send. Each prompt is self-contained — guard rails and subagent-dispatch
discipline are inlined so the new session gets full context without chasing
links.

For session mechanics not specific to a tier (verification gate wording,
subagent dispatch template), see `SESSION_KICKOFF_TEMPLATE.md`. The
prompts below bake in the important bits and reference the template only
for the full subagent sub-prompt.

## Index

| # | PR | Depends on | Parallel-safe with | Rough scope |
|---|---|---|---|---|
| 1 | [**Tier 0 — Albrecht hardening**](#1-tier-0--albrecht-hardening-1-pr) | — | — | Label brand + envelope v2 + AEAD audit + signed sigchain + CSP L3 + cosign + SBOM |
| 2 | [**Tier 5.prereq — sim-SIP-bridge fixtures**](#2-tier-5prereq--sim-sip-bridge-fixtures) | — | everything | Pure test infra, no tier dep |
| 3 | [**Tier 1.A — HPKE + crypto-worker rewrite**](#3-tier-1a--hpke--crypto-worker-rewrite) | Tier 0 | Tier 4.A | HPKE + CryptoLabel + EnvelopeV3 + non-extractable `CryptoKey` |
| 4 | [**Tier 4.A — origin split + Caddy + Ansible**](#4-tier-4a--origin-split--caddy--ansible) | Tier 0 | Tier 1.A | Split origins, Caddy, Ansible, cookies |
| 5 | [**Tier 1.B — items_key + call-site migration**](#5-tier-1b--items_key--call-site-migration) | Tier 1.A | Tier 4.B | `items_key` indirection + hub-field call-site migration |
| 6 | [**Tier 2.A — OPAQUE + key-store-v3 + PRF**](#6-tier-2a--opaque--key-store-v3--prf) | Tier 1.A | — | Rust→WASM OPAQUE-ke wrapper + key-store-v3 + PRF primary |
| 7 | [**Tier 2.B — Diceware recovery phrase**](#7-tier-2b--diceware-recovery-phrase) | Tier 2.A | Tier 4.B, 4.C | EFF wordlist + unlock orchestration |
| 8 | [**Tier 2.C — Recovery Group + Shamir**](#8-tier-2c--recovery-group--shamir) | Tier 2.B | Tier 4.C | 2-of-3 Shamir + admin UI |
| 9 | [**Tier 3.A — device identity + PUK + sigchain**](#9-tier-3a--device-identity--puk--sigchain) | Tier 2.B | Tier 4.\* | Keybase-style base |
| 10 | [**Tier 3.B — cross-signing + master key recovery**](#10-tier-3b--cross-signing--master-key-recovery) | Tier 3.A | — | Master seed + CLKR |
| 11 | [**Tier 3.C — CLKR + per-device hub key**](#11-tier-3c--clkr--per-device-hub-key) | Tier 3.B | Tier 6.A | Bounded-time eventual consistency |
| 12 | [**Tier 4.B — sandboxed crypto iframe + RPC**](#12-tier-4b--sandboxed-crypto-iframe--rpc) | Tier 4.A, Tier 1.A | Tier 2.B | Iframe + Trusted Types |
| 13 | [**Tier 4.C — verifier + gossip + whitepaper**](#13-tier-4c--verifier--gossip--whitepaper) | Tier 4.B | Tier 2.C, Tier 3.\* | ≥2 verifiers + residual risk doc |
| 14 | [**Tier 5 — Voice E2EE main**](#14-tier-5--voice-e2ee-main) | Tier 1.A, Tier 5.prereq | Tier 3.\* | SFrame + RTCRtpScriptTransform + Asterisk passthrough |
| 15 | [**Tier 6.A — fingerprint UX + vendored core-crypto**](#15-tier-6a--fingerprint-ux--vendored-core-crypto) | Tier 3.A | Tier 5 | UX + vendored `@wireapp/core-crypto` skeleton, feature flag off |
| 16 | [**Tier 6.B — MLS code path behind flag**](#16-tier-6b--mls-code-path-behind-flag) | Tier 6.A, Tier 3.C | — | MLS live, staged rollout (months) |

**Session pairing (weekend of 2026-04-11/12):**

- **Session A** runs the critical path: 1 → 3 → 5 → 6 → 7 → 8 → 9
- **Session B** runs the parallel track: 2 → 4 → 12 → 13 → 14
- **Session C** (if available): 10, 11, 15 — week of 2026-04-13
- **Tier 6.B** is a months-long rollout — not weekend scope

**Before every session:** read `docs/superpowers/plans/IMPLEMENTATION_QUEUE.md`
on main to confirm the prompt below is still the next unblocked item.
Update the queue after the session with the PR link + next-up marker.

---

## Shared guard rails (every session)

Every session prompt below references this block. Do not skip:

- **No backward-compatibility shims.** Pre-production; clean cuts only.
- **Full measure, no shortcuts.** Robust implementation, strong tests + docs.
- **Every feature ships with tests.** Unit + API E2E + UI E2E + adversarial
  negative cases from the spec.
- **No silent failures.** No bare `catch {}` in crypto paths. Crypto errors
  propagate.
- **No PII in logs, commits, or fixtures.** The `scripts/pii-check.sh`
  pre-commit hook enforces this via `PII_CHECK_PATTERNS`. Do NOT bypass with
  `--no-verify`.
- **testid-only selectors** in E2E tests. No `getByText` /
  `getByRole({ name })` for interactive elements (CLAUDE.md is authoritative).
- **React Query mutations** must use mutation hooks with `onSuccess`
  invalidation. Never call API functions directly from components.
- **Never edit a committed Drizzle migration in place.** Write a new repair
  migration if you need to fix one. Migration numbers in the plans are
  **placeholders**: at impl time run `ls drizzle/migrations/ | sort | tail -5`
  and use the next unused integer.
- **Never use `--no-verify`** on commit.
- **Never use `git reset --hard`** without explicit user permission.
- **Use the `superpowers:subagent-driven-development` skill** to dispatch
  each plan task to a fresh subagent. Parallelize non-dependent tasks within
  the PR; serialize dependent tasks.

---

## Shared worktree setup (every session)

Every prompt references this block:

```bash
cd ~/recover2/projects/llamenos-hotline
git fetch origin main
git worktree add ../llamenos-hotline-impl-tier-<N>-<slug> \
  feat/sec-tier-<N>-impl-<slug> origin/main
cd ../llamenos-hotline-impl-tier-<N>-<slug>
bun install                 # runs prepare → lefthook install
echo "$PII_CHECK_PATTERNS"  # must print your patterns; blank = hook dormant
```

---

## 1. Tier 0 — Albrecht hardening (1 PR)

**Worktree slug:** `albrecht`
**Branch:** `feat/sec-tier-0-impl-albrecht`
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-0-albrecht-hardening.md` (36 tasks)
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-0-albrecht-hardening-design.md`
**Review:** `docs/security/TIER_0_REVIEW.md`

```
I'm implementing **Tier 0 — Albrecht hardening** from the Llamenos
security overhaul. This is the queue head — every other tier depends on
this landing first.

## Session prep (do these before touching code)

1. Read `docs/superpowers/plans/IMPLEMENTATION_QUEUE.md` on main.
   Confirm Tier 0 is still the next unblocked item.
2. Read the spec: `docs/superpowers/specs/2026-04-10-security-tier-0-albrecht-hardening-design.md`.
   Six workstreams: label enforcement, signed audit log, AEAD audit,
   export paths, CSP L3, cosign+SBOM.
3. Read the plan: `docs/superpowers/plans/2026-04-10-security-tier-0-albrecht-hardening.md`.
   36 TDD tasks.
4. Read the review: `docs/security/TIER_0_REVIEW.md` — note any open
   `I-*` findings.
5. Read `CLAUDE.md` — tech stack, conventions, testid-only rule,
   decrypt-on-fetch rule, migration placeholder rule.
6. Load auto-memory (MEMORY.md).

## Worktree setup

cd ~/recover2/projects/llamenos-hotline
git fetch origin main
git worktree add ../llamenos-hotline-impl-tier-0-albrecht \
  feat/sec-tier-0-impl-albrecht origin/main
cd ../llamenos-hotline-impl-tier-0-albrecht
bun install
echo "$PII_CHECK_PATTERNS"

## Prerequisites (confirm on main)

Tier 0 has no tier dependencies. Just confirm:

- `grep -c '^### Task ' docs/superpowers/plans/2026-04-10-security-tier-0-albrecht-hardening.md`
  → 36
- `ls drizzle/migrations/ | sort | tail -3` — note the next free number
  for Task 20's signed-audit-log migration (plan says `0051_*`, that is
  a placeholder).
- `grep -r 'createLogger\|createDebugLog' src/server/lib/logger.ts | head`
  → confirm PR #45's logger exists; CSP report endpoint uses it.

## Implementation protocol

Use `superpowers:subagent-driven-development`. Fresh subagent per task,
with:

- Clean context per task
- Structured review between tasks
- Commit per task

**Parallelize:**
- Tasks 11–15 (per-schema AEAD audits) — 5 parallel subagents.
- Tasks 34–35 (API + UI E2E suites) can run parallel after their
  respective implementations land.

**Serialize:**
- Task 4 (EnvelopeV2) before Tasks 6–9 (which use it).
- Task 17 (audit entry schemas) before Task 18/19/20.
- Task 27 (CSP header) after Tasks 23–26 (nonces + self-hosted fonts).

## First task

**Task 1: Branded `CryptoLabel` type + `LABEL_REGISTRY`**
Files: `src/shared/crypto-labels.ts`
Plan step 1 has the failing test.

## Verification gate

Before pushing:

bun run typecheck
bun run lint
bun run build
bun run test:unit
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api
bunx playwright test tests/ui
./scripts/verify-build.sh   # validates cosign + SBOM attestation paths

## Session end

1. Plan checkboxes all closed.
2. Push: `git push -u origin feat/sec-tier-0-impl-albrecht`
3. Open PR: `feat(sec): tier 0 impl — albrecht hardening` referencing #52.
4. Update `IMPLEMENTATION_QUEUE.md` — mark Tier 0 impl as in-progress/
   done, mark Tier 1 + Tier 4 + Tier 5-main + Tier 6 as newly unblocked.

## Guard rails

{paste shared guard rails from TIER_SESSION_PROMPTS.md §"Shared guard rails"}

## Session notes

- The review flagged that PR #45 already landed the structured logger —
  use it from day one in `/api/csp-report` (Task 24). Do not re-add
  legacy `console.log` calls.
- Task 20's migration number `0051` is a placeholder — compute the real
  one in your worktree and update the plan's task body inline before
  committing that task. Also update the plan's `--- File Map ---`
  section to match.
- Six workstreams is a lot for one PR, but it's one cohesive defensive
  pass. Don't split.
```

---

## 2. Tier 5.prereq — sim-SIP-bridge fixtures

**Worktree slug:** `sim-sip`
**Branch:** `feat/sec-tier-5-prereq-sim-sip-bridge`
**Spec section:** Tier 5 spec §5.12 ("Test fixtures")
**Plan reference:** Tier 5 plan prerequisite tasks

Pure test infrastructure, zero tier dependency — can run Session B
any time in parallel with Tier 0.

```
I'm implementing the **Tier 5 prerequisite PR: sim-SIP-bridge
fixtures**. This is pure test infra with no tier dependency —
Tier 5's main implementation PR blocks on this landing first.

## Session prep

1. Read `docs/superpowers/plans/IMPLEMENTATION_QUEUE.md` on main.
2. Read the spec: `docs/superpowers/specs/2026-04-10-security-tier-5-voice-e2ee-design.md`
   — sections §5.12.1 (sim-SIP-bridge) and §5.12.2 (sim-caller).
3. Read the plan's prerequisite tasks block.
4. Read `CLAUDE.md` and `src/server/telephony/` to understand the
   existing Asterisk adapter + JsSIP integration these fixtures will
   simulate.
5. Load auto-memory.

## Worktree setup

cd ~/recover2/projects/llamenos-hotline
git fetch origin main
git worktree add ../llamenos-hotline-impl-tier-5-prereq \
  feat/sec-tier-5-prereq-sim-sip-bridge origin/main
cd ../llamenos-hotline-impl-tier-5-prereq
bun install
echo "$PII_CHECK_PATTERNS"

## Scope

Four new files, all pure test infrastructure:

1. `tests/fixtures/sim-sip-bridge.ts` — fakes Asterisk ARI WebSocket
   + media-plane RTP. Accepts dialplan events, generates RTP packets,
   exposes state for assertions.
2. `tests/fixtures/sim-caller.ts` — simulated inbound caller. Holds
   a canned Opus-encoded audio clip (stub: 440 Hz tone, 2 s), drives
   it through a jitter buffer, emits DTMF digits on demand for IVR
   tests. **No SFrame methods** (those land in Tier 5 main as
   Task 19b per the plan's Workstream 5.8 header note).
3. `tests/helpers/sframe-test-utils.ts` — mock RTP packet layout +
   mock SFrame key-material helpers. **No `@shared/sframe/`
   imports** — those modules do not exist on main yet.
4. `docs/testing/TEST_FIXTURES_SFRAME.md` — reference for how to use
   the fixtures in call tests.

**Deliberately NOT in scope:** SFrame production code (that's Tier 5
main). No `RTCRtpScriptTransform`, no encryption, no crypto worker
changes, no imports from `src/shared/sframe/` (which does not exist
on main). Pure test harness that can be reused by Tier 3 and Tier 4
call-path tests.

## First task

Read Workstream 5.8 of the Tier 5 plan — its header note (added in
this PR) explains the scope split between prereq and Tier 5 main.
The prereq-scope tasks are 18 and 19. Start with `sim-sip-bridge`
(Task 18): the ARI WebSocket mock is the smallest testable unit,
and `sim-caller` plus `sframe-test-utils` build on its RTP helpers.

## Verification gate

bun run typecheck
bun run lint
bun run build
bun test tests/fixtures/sim-sip-bridge.test.ts
bun test tests/fixtures/sim-caller.test.ts

(No Playwright API spec lands in the prereq PR — `tests/api/sim-sip-bridge.spec.ts` in Tier 5 plan §5.11 Task 28 lands alongside the Tier 5 main PR because it exercises SFrame pipeline end-to-end.)

## Session end

1. Push branch, open PR: `feat(sec): tier 5 prereq — sim-SIP-bridge fixtures`.
2. Reference PR #57 (Tier 5 spec+plan) in the body.
3. Update `IMPLEMENTATION_QUEUE.md` — mark prereq as in-progress/done,
   note the fixtures are now usable by Tier 3 + Tier 4 call-path tests.

## Guard rails

{paste shared guard rails}

## Session notes

- These fixtures must work headlessly in CI. No real RTP sockets
  bound to the kernel network stack — simulate in-memory.
- Keep the fixtures framework-agnostic (no Playwright-specific
  imports). They should be callable from `bun:test` unit tests AND
  Playwright API/UI tests.
- The Opus encoder can be stubbed with a canned PCM→Opus payload if
  full encoding is too heavy for CI — just make the stub obviously
  fake (e.g. a single tone at 440 Hz for 2 s).
```

---

## 3. Tier 1.A — HPKE + crypto-worker rewrite

**Worktree slug:** `hpke`
**Branch:** `feat/sec-tier-1a-impl-hpke`
**Depends on:** Tier 0 merged to main
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-1-hpke-primitives.md` (Tasks 1–17 approximately)
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-1-hpke-primitives-design.md`

```
I'm implementing **Tier 1 PR-A: HPKE + crypto-worker rewrite**. This
is the first of two Tier 1 implementation PRs. PR-B ships the
`items_key` indirection and hub-field call-site migration as a
separate PR for reviewability.

## Prerequisites

- Tier 0 merged (confirm: `git log origin/main --oneline | head -20` shows
  the Tier 0 impl PR).
- Tier 0 files present: `ls src/shared/crypto-labels.ts && grep -q 'EnvelopeV2' src/shared/envelope.ts`.
- `@hpke/core` package added in the package.json diff on this branch.

## Scope for PR-A only

- HPKE primitives via `@hpke/core` (X25519 + HKDF-SHA256 + AES-256-GCM)
- Branded `CryptoLabel` → `@hpke/core` adapter
- `EnvelopeV3` format (replaces Tier 0's `EnvelopeV2` wholesale — pre-prod,
  clean cut)
- Non-extractable `CryptoKey` in IDB (generate-export-reimport dance)
- Crypto-worker rewrite to use `CryptoKey` throughout, never raw bytes
- Hub key wrap rewritten against `EnvelopeV3`

**NOT in PR-A (deferred to PR-B):**
- `items_key` indirection layer
- Hub-field call-site migration (Tasks 6 + 6a in the plan)
- React Query `queryFn` rewrites

## Worktree setup

cd ~/recover2/projects/llamenos-hotline
git fetch origin main
git worktree add ../llamenos-hotline-impl-tier-1a-hpke \
  feat/sec-tier-1a-impl-hpke origin/main
cd ../llamenos-hotline-impl-tier-1a-hpke
bun install
echo "$PII_CHECK_PATTERNS"

## First task

Plan Task 1: install `@hpke/core`, create `src/shared/hpke.ts`, write
the failing test that seals+opens an HPKE message with a labeled AAD.

## Verification gate

bun run typecheck
bun run lint
bun run build
bun run test:unit
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api/hpke.spec.ts
bunx playwright test tests/ui/unlock.spec.ts

## Session end

1. Open PR `feat(sec): tier 1a impl — HPKE + crypto worker`.
2. Reference #53 (Tier 1 spec+plan).
3. In queue, mark Tier 1.A done and unblock Tier 1.B + Tier 2.A.

## Guard rails

{paste shared guard rails}

## Session notes

- **Hub-field API break:** Tier 0 introduced
  `encryptHubField(value, hubId, recordId, fieldName)`. Tier 1 will
  rename this to `hubFieldEncrypt(cryptoKey, value, recordId, fieldName)`
  in PR-B. In PR-A, LEAVE the Tier 0 API alone — the call-site rewrite
  is PR-B's job. Only the primitive layer + envelope format change here.
- **`CryptoKey` extraction pattern** is `crypto.subtle.generateKey` →
  `exportKey('raw')` → `importKey('raw', ..., extractable: false)`.
  The intermediate export is unavoidable for HPKE setup but the
  stored key is non-extractable.
- **Hard-fail copy for missing native curves:** spec §1.3.2 has the
  final modal copy (recommend Firefox 135+, Chromium 133+, Safari 17.4+).
  All 22 locales need the new i18n key (placeholder English is fine for
  PR-A — translation sweep is a follow-up).
```

---

## 4. Tier 4.A — origin split + Caddy + Ansible

**Worktree slug:** `origin-split`
**Branch:** `feat/sec-tier-4a-impl-origin-split`
**Depends on:** Tier 0 merged (not Tier 1)
**Parallel-safe with:** Tier 1.A — touches different files
**Plan:** `docs/superpowers/plans/2026-04-10-security-tier-4-delivery-hardening.md` (first ~8 tasks)
**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-4-delivery-hardening-design.md` §4.1, §4.2.7

```
I'm implementing **Tier 4 PR-A: origin split + Caddy + Ansible**.
This is the deployment/infrastructure layer of Tier 4 — safe to run
in parallel with Tier 1.A because it touches `deploy/`, Caddyfile,
Ansible, and cookie config, not crypto code.

## Prerequisites

- Tier 0 merged (confirm on main).
- Tier 4 spec on main: `ls docs/superpowers/specs/2026-04-10-security-tier-4-delivery-hardening-design.md`.

## Scope for PR-A only

- Split origins: `app.llamenos.local`, `api.llamenos.local`,
  `crypto.llamenos.local` (compile-time via `VITE_APP_ORIGIN` /
  `VITE_API_ORIGIN` / `VITE_CRYPTO_ORIGIN` / `VITE_CSP_REPORT_URI` —
  see spec §4.2.7).
- Caddy config: three virtual hosts, mutual CORS allowlist, TLS.
- Ansible role updates: render Caddy config from the three env vars,
  write systemd units, wire cert reload.
- Cookie hardening: `SameSite=Strict`, `Secure`, `HttpOnly` where
  applicable; transparent first-party fallback for Safari ITP.

**NOT in PR-A (deferred to PR-B/PR-C):**
- Sandboxed crypto iframe + RPC (PR-B)
- Trusted Types enforcement (PR-B)
- ≥2 verifiers + gossip + whitepaper (PR-C)

## Worktree setup

cd ~/recover2/projects/llamenos-hotline
git fetch origin main
git worktree add ../llamenos-hotline-impl-tier-4a-origin-split \
  feat/sec-tier-4a-impl-origin-split origin/main
cd ../llamenos-hotline-impl-tier-4a-origin-split
bun install
echo "$PII_CHECK_PATTERNS"

## Verification gate

bun run typecheck
bun run lint
bun run build
bun run test:unit
cd deploy/ansible && just validate
# spin up a VM via just deploy-demo-dry-run if your setup supports it
bunx playwright test tests/ui/cookie-flow.spec.ts

## Session end

1. Push, open PR `feat(sec): tier 4a impl — origin split + Caddy + Ansible`.
2. Reference #56 in body.
3. Update queue — mark 4.A done, unblock 4.B.

## Guard rails

{paste shared guard rails}

## Session notes

- **Self-hosted deployments are primary.** Compile-time origin config
  via Vite env vars is the Rhonda-confirmed approach — do NOT hard-code
  any origin in client code.
- **Transparent cookie fallback** (spec §4.1.2): when Safari ITP
  blocks third-party cookies on `api.llamenos.local`, fall back to
  same-origin `/api/*` proxy transparently. Session UX is unchanged.
- Ansible changes MUST validate against both Debian 13 and Ubuntu
  24.04 (multi-distro abstraction from PR #49 is on main).
```

---

## 5. Tier 1.B — items_key + call-site migration

**Worktree slug:** `items-key`
**Branch:** `feat/sec-tier-1b-impl-items-key`
**Depends on:** Tier 1.A merged
**Parallel-safe with:** Tier 4.B (different files)
**Plan:** Tier 1 plan Tasks 6–26 (post-HPKE work)

```
I'm implementing **Tier 1 PR-B: items_key indirection + hub-field
call-site migration**. PR-A shipped HPKE primitives + crypto-worker
rewrite; PR-B is the application-layer adoption.

## Prerequisites

- Tier 1 PR-A merged.
- `grep -q 'EnvelopeV3' src/shared/envelope.ts` passes.
- `grep -q 'HpkeSuite' src/shared/hpke.ts` passes.
- `grep -q 'extractable: false' src/client/lib/key-store-v2.ts` passes.

## Scope

- Introduce `items_key` indirection layer (Standard Notes pattern):
  one random symmetric key per "items set", wrapped under the user's
  HPKE key. Rotation does not re-encrypt all items.
- Rewrite `encryptHubField` call sites (all React Query `queryFn`
  callbacks) to use `hubFieldEncrypt(cryptoKey, value, recordId,
  fieldName)` — see Tier 1 plan Task 6 + Task 6a for the mechanical
  recipe + `getHubKeyCryptoKeyForId` cache helper.
- Migrate every ciphertext column's reader path to the new signature.
- Add React Query cache invalidation for the new key helper.

## First task

Plan Task 6: write failing test for `getHubKeyCryptoKeyForId` cache
helper. The helper returns a cached non-extractable `CryptoKey` per
hub, lazy-loaded from IDB.

## Verification gate

bun run typecheck
bun run lint
bun run build
bun run test:unit
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api   # hub-field read/write smoke
bunx playwright test tests/ui    # decrypt-on-fetch smoke on every route

## Guard rails

{paste shared guard rails}

## Session notes

- **This is the big call-site migration PR.** 45+ `queryFn`
  callbacks across `src/client/` need updating. Dispatch per-route
  subagents in parallel — each touches 1–3 callbacks in one route
  file. Use the plan's mechanical recipe verbatim.
- **Dev DB wipe expected.** `EnvelopeV3` is wholesale replacing
  `EnvelopeV2`. Pre-production allows clean cuts; dev DBs reset on
  the Tier 1 migration.
- **Decrypt-on-fetch discipline** (CLAUDE.md): decrypt inside
  `queryFn`, never in components.
```

---

## 6. Tier 2.A — OPAQUE + key-store-v3 + PRF

**Worktree slug:** `opaque`
**Branch:** `feat/sec-tier-2a-impl-opaque`
**Depends on:** Tier 1.A merged (needs non-extractable `CryptoKey` + HPKE)
**Parallel-safe with:** —
**Plan:** Tier 2 plan Tasks 1–15 approximately
**Spec:** §2.2, §2.3

```
I'm implementing **Tier 2 PR-A: OPAQUE-ke wrapper + key-store-v3 + PRF
primary**.

## Prerequisites

- Tier 1.A merged.
- `grep -q 'extractable: false' src/client/lib/key-store-v2.ts` passes.
- `grep -q 'HpkeSuite' src/shared/hpke.ts` passes.

## Scope

- **Vendored Rust→WASM OPAQUE wrapper** at `vendor/opaque-wrapper/`
  over `facebook/opaque-ke`. Pinned ciphersuite: Ristretto255 + TripleDH
  + Argon2id `m=47 MiB, t=1, p=1`.
- Build via `wasm-pack`, loaded via Vite's `?init` WASM import.
- `key-store-v3` IDB schema replacing v2 wholesale (pre-prod; no
  migration).
- PRF (WebAuthn PRF extension) as primary unlock factor, PIN as
  fallback, Diceware phrase (Tier 2 PR-B) as recovery.
- **OPAQUE is a first-party wrapper, not a dependency pull** — the
  vendored Rust crate lives in the repo with `PROVENANCE.md`
  documenting upstream SHA + ciphersuite choices.

**NOT in PR-A:**
- Diceware recovery phrase (PR-B)
- Recovery Group + Shamir (PR-C)

## Worktree setup

cd ~/recover2/projects/llamenos-hotline
git fetch origin main
git worktree add ../llamenos-hotline-impl-tier-2a-opaque \
  feat/sec-tier-2a-impl-opaque origin/main
cd ../llamenos-hotline-impl-tier-2a-opaque
bun install
# Rust toolchain required for vendor/opaque-wrapper build
rustup show
cd vendor/opaque-wrapper && wasm-pack build --target web
cd ../..
echo "$PII_CHECK_PATTERNS"

## First task

Read plan Task 1 — create `vendor/opaque-wrapper/` skeleton with
`Cargo.toml`, `src/lib.rs`, and the pinned ciphersuite type aliases.
Write the first failing JS test that imports the WASM and calls
`opaque.clientRegistrationStart(password)`.

## Verification gate

bun run typecheck
bun run lint
(cd vendor/opaque-wrapper && cargo test)
(cd vendor/opaque-wrapper && wasm-pack build --target web)
bun run build
bun run test:unit
bun run dev:docker
bun run migrate
bunx playwright test tests/api/opaque.spec.ts
bunx playwright test tests/ui/unlock-prf.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **Argon2id `m=47 MiB`** is not a typo — Rhonda confirmed 47 MiB
  (review decision 2026-04-10). Do not round to 48 or 64.
- **Multi-hub recovery semantics** (spec §2.4.2): each hub has its
  own OPAQUE ceremony. Recovery on hub A does NOT cascade to hub B
  — by design. UX must make this explicit.
- **WASM loading path:** Vite's `?init` import produces a lazy
  initializer; wire it through `src/client/lib/opaque-loader.ts` so
  the main bundle does not block on WASM.
```

---

## 7. Tier 2.B — Diceware recovery phrase

**Worktree slug:** `diceware`
**Branch:** `feat/sec-tier-2b-impl-diceware`
**Depends on:** Tier 2.A merged
**Unlocks:** Tier 3.A (which needs Diceware as interim for master seed)

```
I'm implementing **Tier 2 PR-B: Diceware recovery phrase + unlock
orchestration**.

## Prerequisites

- Tier 2.A merged.
- `ls vendor/opaque-wrapper/pkg/` shows the built WASM.
- `grep -q 'keyStoreV3' src/client/lib/key-store-v3.ts` passes.

## Scope

- EFF long wordlist (7776 words) bundled as `src/client/lib/diceware/eff-long.json`.
- 15-word phrase = ~194 bits entropy (spec §2.5).
- Unlock orchestration: PRF → PIN → Diceware cascade.
- Recovery phrase display UI: show-once, copy-to-clipboard blocked,
  confirm-by-retype gate before proceeding.
- Factor rotation without re-encrypting items (leverages key-store-v3).

## First task

Plan Task for EFF wordlist integration — write the failing test that
generates a 15-word phrase and verifies entropy.

## Verification gate

bun run typecheck
bun run lint
bun run build
bun run test:unit
bun run dev:docker
bun run migrate
bunx playwright test tests/api/unlock-cascade.spec.ts
bunx playwright test tests/ui/recovery-phrase.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **Show-once UX is non-negotiable.** The phrase must never round-trip
  to the server, and the display must not be copyable via the
  clipboard API. Use a Trusted Types-safe rendering path.
- **Retype gate** must use a separate per-word input, not a single
  textarea — forces the user to actually read the phrase.
- Diceware unlocks Tier 3.A. Ship PR-B ASAP after PR-A.
```

---

## 8. Tier 2.C — Recovery Group + Shamir

**Worktree slug:** `recovery-group`
**Branch:** `feat/sec-tier-2c-impl-recovery-group`
**Depends on:** Tier 2.B merged

```
I'm implementing **Tier 2 PR-C: Recovery Group + 2-of-3 Shamir + admin UI**.

## Prerequisites

- Tier 2.B merged.

## Scope

- 1Password-style Recovery Group: user designates N trusted contacts,
  threshold 2-of-3 Shamir reconstruction of the master key.
- Shamir secret sharing over GF(256) (pure TypeScript, no WASM for
  this).
- Admin UI for nominating recovery group members + monitoring
  reconstruction attempts.
- Signed audit entries for every reconstruction request + approval.

## First task

Plan Task for Shamir GF(256) primitive — write the failing test that
splits + reconstructs a 32-byte secret at threshold 2/3.

## Verification gate

bun run typecheck
bun run lint
bun run build
bun run test:unit
bunx playwright test tests/api/recovery-group.spec.ts
bunx playwright test tests/ui/recovery-group.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **Per-hub ceremony only** (decision from §2.4.2) — no cascading
  across hubs. Each hub has its own recovery group + its own 2/3
  threshold.
- **Admin UI must testid everything.** No `getByText` for recovery
  group member names (they are encrypted PII).
```

---

## 9. Tier 3.A — device identity + PUK + sigchain

**Worktree slug:** `devices-base`
**Branch:** `feat/sec-tier-3a-impl-devices-base`
**Depends on:** Tier 2.B merged (Diceware interim for master seed — not full Tier 2.C)
**Parallel-safe with:** Tier 4.\* (different files)
**Plan:** Tier 3 plan PR-A tasks (approximately first 20 of 48)

```
I'm implementing **Tier 3 PR-A: device identity + PUK + sigchain base**.
This is Keybase-pattern per-device keys. 48-task plan split into 3 PRs;
PR-A lays the foundation.

## Prerequisites

- Tier 2.B merged (Diceware — used as interim master seed anchor).
- `grep -q 'dicewareGeneratePhrase' src/client/lib/diceware/*.ts` passes.

## Scope for PR-A

- Device identity DB tables: `devices`, `device_sigchain_entries`
  (linear storage, forward-only cross-references — NOT a DAG).
- Per-device keypair generation + secure enclave binding where
  available.
- Paper-unlock key (PUK) derivation from Diceware master seed.
- Sigchain linear storage model (master doc §3 + spec §3.3.3).
- Device enrollment flow (UI + API).

**NOT in PR-A:**
- Cross-signing + master key recovery (PR-B)
- CLKR + per-device hub key + device-revoke worker (PR-C)

## Verification gate

bun run typecheck
bun run lint
bun run build
bun run test:unit
bun run dev:docker
bun run migrate
bunx playwright test tests/api/devices.spec.ts
bunx playwright test tests/ui/device-enroll.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **Linear storage, forward-only cross-refs** — do NOT implement
  a DAG. Spec §3.3.3 rewrote this after review I-3. Sigchain entry N
  links to entry N-1 and cannot reference entries N+k.
- **Diceware is the interim master seed anchor.** Full Recovery
  Group integration for master seed is a PR-B concern. In PR-A,
  the master seed is derived deterministically from the Diceware
  phrase per spec §3.6.3.
- **48 tasks split across 3 PRs** — PR-A is the biggest single
  Tier 3 commit. Expect a long session; parallelize the per-table
  schema tasks.
```

---

## 10. Tier 3.B — cross-signing + master key recovery

**Worktree slug:** `devices-recovery`
**Branch:** `feat/sec-tier-3b-impl-devices-recovery`
**Depends on:** Tier 3.A merged

```
I'm implementing **Tier 3 PR-B: cross-signing + master key recovery**.

## Prerequisites

- Tier 3.A merged.
- `grep -q 'deviceSigchainEntries' src/server/db/schema/devices.ts` passes.

## Scope

- Cross-signing: each new device is signed by an existing trusted
  device. Master signing key held offline.
- Master key recovery flow bridging Diceware (PR-A interim) + Recovery
  Group (Tier 2.C) into a coherent restore path.
- Recovery attestation: cryptographic proof of recovery event signed
  into the sigchain.

## Verification gate

bun run typecheck && bun run lint && bun run build && bun run test:unit
bunx playwright test tests/api/device-cross-sign.spec.ts
bunx playwright test tests/ui/master-key-recovery.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- Post-weekend work per the queue; ambitious for a weekend slot.
```

---

## 11. Tier 3.C — CLKR + per-device hub key

**Worktree slug:** `devices-clkr`
**Branch:** `feat/sec-tier-3c-impl-devices-clkr`
**Depends on:** Tier 3.B merged
**Unblocks:** Tier 6.B

```
I'm implementing **Tier 3 PR-C: CLKR + per-device hub key + device-revoke
worker**. CLKR = Cross-Linked Key Rotation.

## Prerequisites

- Tier 3.B merged.

## Scope

- Per-device hub key: each device holds its own wrapped hub key,
  rotated independently.
- CLKR: when a device is revoked, all hubs the device could read
  must rotate their keys within 30 seconds (bounded-time eventual
  consistency per spec §3.7.3).
- Background device-revoke worker to propagate rotations across hubs.

## Verification gate

bun run typecheck && bun run lint && bun run build && bun run test:unit
bunx playwright test tests/api/device-revoke.spec.ts
bunx playwright test tests/ui/device-list.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **30-second bound** is the contract — do NOT make it eventual-only.
  Add a test that fails if rotation doesn't complete within the window.
- Unblocks Tier 6.B. Ship in the week of 2026-04-13.
```

---

## 12. Tier 4.B — sandboxed crypto iframe + RPC

**Worktree slug:** `crypto-iframe`
**Branch:** `feat/sec-tier-4b-impl-crypto-iframe`
**Depends on:** Tier 4.A merged + Tier 1.A merged (needs non-extractable `CryptoKey`)

```
I'm implementing **Tier 4 PR-B: sandboxed crypto iframe + RPC + Trusted
Types**.

## Prerequisites

- Tier 4.A merged (origin split on main).
- Tier 1.A merged (non-extractable `CryptoKey`).
- `grep -q 'VITE_CRYPTO_ORIGIN' vite.config.ts` passes.

## Scope

- Crypto iframe at `crypto.llamenos.local` with
  `sandbox="allow-scripts"` (opaque origin) and strict CSP including
  `connect-src 'none'` — iframe makes ZERO network requests.
- postMessage RPC: ciphertext flows in via message, plaintext flows
  out via message. All crypto operations move into the iframe.
- Trusted Types policy `llamenos` enforced throughout the app.
- Test: `tests/ui/crypto-iframe-no-network.spec.ts` asserts zero
  network requests from the iframe context.

## Verification gate

bun run typecheck && bun run lint && bun run build && bun run test:unit
bunx playwright test tests/ui/crypto-iframe-no-network.spec.ts
bunx playwright test tests/ui/trusted-types.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **`connect-src 'none'`** is the design invariant. Do NOT add
  `'self'` — that would break the isolation guarantee. Spec §4.2.6.
- **Iframe's opaque origin** means `postMessage` targetOrigin is `"*"`
  with explicit origin check inside the iframe handler. Document
  the handshake flow in a header comment on the RPC layer.
```

---

## 13. Tier 4.C — verifier + gossip + whitepaper

**Worktree slug:** `verifier`
**Branch:** `feat/sec-tier-4c-impl-verifier`
**Depends on:** Tier 4.B merged

```
I'm implementing **Tier 4 PR-C: verifier + gossip + whitepaper + residual
risk + warrant canary**.

## Prerequisites

- Tier 4.B merged.

## Scope

- ≥2 independent build verifiers (spec §4.3.1) — reproducible build
  pipeline signs checksums, each verifier signs independently,
  gossip protocol propagates signatures.
- Verifier CLI + CI workflow.
- Whitepaper: `docs/whitepaper/llamenos-threat-model-2026.md`
  documenting the full defense stack + residual risks.
- Warrant canary: periodically signed statement rotated by a human
  admin; staleness indicator in the UI.

## Verification gate

bun run typecheck && bun run lint && bun run build && bun run test:unit
./scripts/verify-build.sh --verifier alice
./scripts/verify-build.sh --verifier bob
bunx playwright test tests/ui/warrant-canary.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **Whitepaper is mandatory, not optional.** It's the public-facing
  document that explains what Llamenos does NOT protect against
  (nation-state endpoint compromise, etc.).
- **Warrant canary staleness** must be signed by a human key; the
  signing flow requires hardware auth.
```

---

## 14. Tier 5 — Voice E2EE main

**Worktree slug:** `voice`
**Branch:** `feat/sec-tier-5-impl-voice`
**Depends on:** Tier 1.A merged + Tier 5.prereq merged
**Parallel-safe with:** Tier 3.\*

```
I'm implementing **Tier 5: Voice E2EE via SFrame + RTCRtpScriptTransform**.
The 45-task main PR. Sim-SIP-bridge fixtures (prereq) must be on main
first.

## Prerequisites

- Tier 1.A merged.
- Tier 5.prereq merged (sim-SIP-bridge fixtures).
- `ls tests/fixtures/sim-sip-bridge.ts tests/fixtures/sim-caller.ts` passes.
- `grep -q 'HpkeSuite' src/shared/hpke.ts` passes.

## Scope

- SFrame (`draft-ietf-sframe-enc`) via `RTCRtpScriptTransform`.
- Per-call HPKE key distribution over Nostr (strfry).
- DTLS fingerprint binding to Nostr-signed signaling (§5.6).
- Asterisk passthrough: media plane unchanged, SFrame layer inserted
  above RTP in the browser.
- `E2eeFallbackModal` with explicit two-button consent (§5.8) —
  recommends Firefox 135+, Brave, Chromium 2025+, Safari 17.4+.
  Silent fallback is banned.
- 22-locale translation: English + placeholder fallbacks land in THIS
  PR; the full translation sweep is a separate session per §5.11.1.
- **Pick up Tier 5 prereq follow-ups** (Workstream 5.8 header note in
  the plan, added by the prereq PR):
  - **Task 19b** — extend `SimCaller` with `bindCall` / `loadKey` /
    `produceFrame` / `consumeFrame` methods that use
    `@shared/sframe/cipher-suite` + `@shared/sframe/frame-codec`.
    This unblocks Task 20.
  - **Task 20** — `SimCompromisedBridge` adversarial subclass +
    tests (old plan Task 20 listing, now deferred here because
    the tests call `SimCaller.produceFrame`).
  - **Task 32** (plan Workstream 5.11) — `tests/api/sim-sip-bridge.spec.ts`
    Playwright API E2E adversarial suite. Uses the extended
    `SimCaller` from Task 19b + `SimCompromisedBridge` from Task 20.

## Verification gate

bun run typecheck && bun run lint && bun run build && bun run test:unit
bun run dev:docker
bun run migrate
bunx playwright test tests/api/voice-sframe.spec.ts
bunx playwright test tests/ui/voice-call.spec.ts
bunx playwright test tests/ui/voice-fallback-modal.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **Fallback modal is explicit consent** — do not auto-fallback.
  Volunteers must click "Proceed without E2EE this one time".
  `non_e2ee_call_accepted` signed audit entry on proceed.
- **Recording incompatibility** (spec §5.7.4): server-side recordings
  break under SFrame. Add the per-hub `voice_e2ee_mode: 'required' |
  'preferred' | 'off'` setting so recording-required hubs can opt out.
- **22 locales live at `public/locales/`**, not `src/client/locales/`.
  (CLAUDE.md fix landed in #61.)
- **Session B (translation sweep)** is a separate follow-up session
  — set `ALLOW_TIER_5_I18N_PLACEHOLDERS=true` in CI during this PR.
```

---

## 15. Tier 6.A — fingerprint UX + vendored core-crypto

**Worktree slug:** `mls-vendor`
**Branch:** `feat/sec-tier-6a-impl-mls-vendor`
**Depends on:** Tier 3.A merged (device identity for fingerprint UX)
**Feature flag:** MLS code path OFF — this PR ships UX + skeleton only.

```
I'm implementing **Tier 6 PR #1: fingerprint verification UX + vendored
`@wireapp/core-crypto` skeleton** (feature-flagged OFF).

## Prerequisites

- Tier 3.A merged.
- `grep -q 'devices' src/server/db/schema/devices.ts` passes.

## Scope

- Vendor `@wireapp/core-crypto` (WASM) at `vendor/core-crypto/`.
  Upstream: `github.com/wireapp/core-crypto`. License: **GPL-3.0**
  (documented in `vendor/core-crypto/PROVENANCE.md`).
- Type definitions for MLS methods: `createConversation`,
  `addClientsToConversation`, `commitPendingProposals`,
  `decryptMessage`, `processWelcomeMessage`, `updateKeyingMaterial`.
- Fingerprint verification UX: QR + numeric comparison flow for
  device-to-device identity verification.
- Serialized MLS state field renamed `serializedMlsState` (NOT
  `opaqueState` — avoids Tier 2 OPAQUE collision per review I-1).
- Feature flag `VITE_ENABLE_MLS=false` in production.

**NOT in PR #1:**
- Live MLS code path (PR #2)
- Group creation / commit flow (PR #2)
- strfry extension for MLS delivery (PR #2)

## Verification gate

bun run typecheck && bun run lint && bun run build && bun run test:unit
bunx playwright test tests/ui/fingerprint-verify.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **`@wireapp/core-crypto`, not `ts-mls`.** Review I-1 decision from
  2026-04-10: adding WASM is fine (Vite handles it), bundle size is
  not a concern, and core-crypto has production pedigree + Cure53/
  Kudelski/X41/Cryspen audit history.
- **GPL-3.0 compatibility** is the main consideration. Llamenos'
  server is already AGPL-compatible; vendoring core-crypto under
  GPL-3.0 is permissible for client bundle inclusion. Document in
  `vendor/core-crypto/PROVENANCE.md`.
- **XWing ciphersuite fallback:** if draft-connolly-cfrg-xwing-kem
  is not IANA-registered at impl time, fall back to P-384 as default
  (spec §6.2). Verify via IETF datatracker before picking.
```

---

## 16. Tier 6.B — MLS code path behind flag

**Worktree slug:** `mls-live`
**Branch:** `feat/sec-tier-6b-impl-mls-live`
**Depends on:** Tier 6.A merged + Tier 3.C merged
**Rollout schedule:** months, not weekend

```
I'm implementing **Tier 6 PR #2: MLS live code path behind feature flag**.
This is a long-horizon PR — the spec's staged rollout (internal → opt-in
→ default) takes months by design.

## Prerequisites

- Tier 6.A merged.
- Tier 3.C merged (per-device hub key + CLKR).

## Scope

- MLS group creation + commit + welcome processing via `core-crypto`.
- `strfry` extension for MLS delivery service — **new Nostr kind**
  (e.g. kind 40000 `llamenos-mls-commit`) carrying base64 MLS wire
  format. Relay does not interpret content.
- Provable-delete via epoch advancement (master §8.3) with batching:
  epochs advance every N notes or T seconds.
- SFrame base key derivation from MLS `exporter_secret` (§6.6) —
  coordinates with Tier 5's existing SFrame key distribution.
- Staged rollout: internal (month 1) → volunteer opt-in (month 2) →
  default (month 3).

## Verification gate

bun run typecheck && bun run lint && bun run build && bun run test:unit
bunx playwright test tests/api/mls.spec.ts
bunx playwright test tests/ui/mls-group.spec.ts

## Guard rails

{paste shared guard rails}

## Session notes

- **Not a weekend PR.** Ship PR #1 (Tier 6.A) this weekend; PR #2
  begins after Tier 3.C lands and follows the staged rollout.
- **Tier 5 cut-over:** Tier 5 main ships first with per-call HPKE
  key distribution. Tier 6.B migrates to MLS exporter. Active calls
  at cut-over must terminate + re-dial (spec §6.6 / Tier 5 M-3).
- **strfry extension strategy:** new Nostr kind (simplest) per
  decision in Tier 6 review I-3. Do NOT write a strfry C++ plugin
  unless simple kind approach hits a wall.
- **Provable-delete batching:** start with N=10 notes OR T=30s
  whichever comes first. Tune after internal rollout.
```

---

## Revision history

- **2026-04-10 (Rhonda + Claude Opus 4.6):** Initial prompts drafted
  after PRs #60, #61, #62, #52 merged + #53–#58 rebased onto main.
  Every prompt references a spec+plan PR that is either merged or
  mergeable on current main.
