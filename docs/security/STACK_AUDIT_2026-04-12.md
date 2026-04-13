# Post-Overhaul Security Stack Audit — 2026-04-12

**Branch:** `audit/post-overhaul-security-stack`
**Base SHA:** `e81b8bdd` (post Tier 0 → Tier 5 merges, post EnvelopeV3 → HpkeEnvelope rename)
**Scope:** End-to-end verification of the merged 7-tier security overhaul (Tier 0
Albrecht hardening through Tier 5 SFrame voice E2EE). Tier 6 MLS-PQ is not in
scope — it is still an unmerged feature branch.

This audit is a *post-merge* sanity check, not a re-review of every tier. Each
tier already has its own `TIER_N_POST_REVIEW.md`. The point of this document is
to confirm that the invariants those reviews promised still hold on `main`
after the merges, the `EnvelopeV3` → `HpkeEnvelope` rename, the `key-store-v2`
→ `key-store` consolidation, and the `hub-field-crypto-v3` → `hub-field-crypto`
consolidation that landed in commits `b7b70671..e81b8bdd`.

## Method

- Direct verification via Grep/Read against the merged tree. CI budget for this
  session was exhausted before reviewer dispatch, so the parallel pr-review-toolkit
  fan-out scheduled by the prompt was not run; all findings here are from
  primary-source code review.
- Local verification: `bun run typecheck`, `bun run lint`, `bun run build`, and
  `bun run test:unit` (acceptable known failure: `panic-wipe.test.ts`
  cross-file pollution with `key-manager.lock` — pre-existing, tracked, not
  introduced by anything in scope of this audit).
- Cross-reference to the existing `TIER_*_POST_REVIEW.md` documents so we don't
  re-litigate items that are already documented as deferred.

## Invariant verification

The prompt's "Specific invariants to verify" section, with current status:

| # | Invariant | Status | Notes |
|---|---|---|---|
| 1 | HPKE envelope is `v: 3` and label cross-check is mandatory in `hpkeOpen` | PASS | `src/shared/hpke-primitives.ts` lines 108-114: rejects `v !== 3` and `actualLabel !== expectedLabel` before AEAD open. `decryptHpkeEnvelope` adds zod parse for trust boundaries. |
| 2 | HPKE `info` is bound to label on both seal and open | PASS | `hpke-primitives.ts` lines 73, 120: `info: new TextEncoder().encode(label)` on both sides. Combined with labelId wire check + AAD + AEAD tag, five independent defense layers. |
| 3 | Hub-field AAD is bound to `(recordId, fieldName)` via `hubFieldAad` | PASS | `src/shared/lib/hub-field-aad.ts` is the single source of truth; both `hub-field-crypto.ts` (client) and the server import the same helper. |
| 4 | All HPKE call sites use a `CryptoLabel` from `LABEL_REGISTRY` | PASS | CI grep guardrail (`.github/workflows/ci.yml` lines 636-655) blocks raw `llamenos:*` literals outside the `crypto-labels.ts` definition. The `TIER1_LEGACY_ALLOW` regex still exempts the legacy ECIES sidecar. |
| 5 | Hub key handle is a non-extractable `CryptoKey`, never exposed as raw bytes on the new path | PASS | `hub-field-crypto.ts#importHubKeyCryptoKey` imports as `extractable=false`. `getHubKeyRawBytesForLegacyPath` is the only raw accessor and is documented as the Nostr legacy path. |
| 6 | CLKR rotation uses `Promise.allSettled` so one bad pubkey can't block the whole hub | PASS | `src/client/lib/hub-key-manager.ts#wrapHubKeyForDevices` lines 118-146: settled iteration, throws only if ALL fail. (Tier 3 PR-C fix I1.) |
| 7 | Per-device CLKR records device commitments in the sigchain entry | PASS | `hub-key-manager.ts#rotateHubKeyClkr` lines 315-351: `SHA-256(deviceId || envelope.ct)` per device. |
| 8 | Device-revoke worker is idempotent | PASS | `src/server/jobs/device-revoke-worker.ts#processRevocation` checks `isHubRotationComplete(hubId, revokeEntryHash)` before re-rotating; uses `Promise.allSettled` for parallel hub rotations with retry/backoff. |
| 9 | Audit log signer lookup prefers device registry then falls back to user pubkey | PASS | `src/server/services/audit-log-service.ts#findSignerByPubkey` queries `userDevices` first, then `users.pubkey`. No `TODO(tier-3):` markers remain (Tier 3 Compromise #7 closure verified). |
| 10 | Audit chain verifier walks `device_add` / `device_revoke` to mutate the trusted device set | PASS | `src/client/lib/audit-chain-verifier.ts` extends/shrinks the trusted set as it walks; results cached in IDB `llamenos-audit-chain-cache`. |
| 11 | API-host CSP defaults to enforcing | PASS | `src/server/middleware/security-headers.ts`: `CSP_MODE` unset → enforcing (Tier 4 C-2 fix). Three unit tests cover unset / report-only / enforcing. |
| 12 | `securityHeaders` middleware is registered before `app.route('/api', api)` | PASS | `src/server/app.ts` hoists `app.use('*', securityHeaders)` to first position (Tier 4 C-1 fix). |
| 13 | Crypto sandbox iframe meta-CSP and Caddy CSP are aligned and both pin `connect-src 'none'` | PASS | `crypto-sandbox/sandbox.html` line 44 and `deploy/docker/Caddyfile.production` / `deploy/ansible/roles/llamenos/templates/caddy.j2` align after Tier 4 C-4 fix. |
| 14 | Trusted Types policy name matches between `main.ts` and CSP | PASS | Both say `llamenos-sandbox` (Tier 4 C-5 fix); the `try/catch` swallow that hid policy install failure was removed. |
| 15 | Auth cookies use `SameSite=Strict`, `HttpOnly`, `Secure` (with dev escape) | PASS for the helper | `src/server/lib/cookies.ts` sets `sameSite: 'Strict'`, `httpOnly: true`, dev-aware `secure`. **However** see F-2 below — the helper is not adopted by login/invite paths. |
| 16 | SFrame cipher suite is pinned to `AES_128_GCM_SHA256_128` with no negotiation | PASS | `src/shared/sframe/cipher-suite.ts` exports a single suite constant; verified by Tier 5 review (PASS row in TIER_5_POST_REVIEW). |
| 17 | SFrame call secret is HPKE-wrapped per device with `LABEL_SFRAME_CALL_SECRET` | PASS | `src/client/lib/webrtc/sframe-key-distribution.ts#buildKeyEvent` seals 32-byte secret per recipient and stamps `labelId = labelToId(LABEL_SFRAME_CALL_SECRET)` on parse so the `hpkeOpen` cross-check passes. |
| 18 | sip-bridge recording ban is enforced on SFrame calls | PASS | `sip-bridge/src/command-handler.ts` defaults to `mode='sframe'` when state is missing (Tier 5 fail-closed fix). |
| 19 | `verifyOrThrow` is fail-closed (throws on any non-`match` status) | PASS for the function | `src/client/lib/binary-verifier.ts` wraps the verifier and throws `VerifierFailure` on every non-match status. **However** see F-3 below — no production caller invokes it. |
| 20 | CI grep guardrails block raw legacy primitive imports outside `TIER1_LEGACY_ALLOW` | PASS | `.github/workflows/ci.yml` lines 636-655: blocks `from '@noble/ciphers/chacha`, `getSharedSecret`, and silent HPKE→ECIES fallback patterns. |

## Findings

All findings here are *carry-forward* from earlier tier post-reviews unless
labelled FRESH. The intent is to reconfirm scope after the rename/consolidation
commits and to flag the one item I did not see in any prior review.

### F-1 (FRESH, MEDIUM): `rotateHubKeyClkr` no longer enforces the chain-head gate

**Files:** `src/client/lib/hub-key-manager.ts:315`, `src/client/lib/audit-chain-verifier.ts:39`

`audit-chain-verifier.ts` defines `rotation_trigger_not_at_head` as an error
code, and the Tier 0 plan (Task 22) called for `rotateHubKey` to be gated on a
verified audit-chain head before proceeding so a stale or forked chain cannot
be used to trigger rotations on devices that have not seen the latest
revocations. The current `rotateHubKeyClkr` does not call `verifyAuditChain` or
its derivatives, and `grep -r 'verifyAuditChain\|rotation_trigger_not_at_head'
src` returns only the verifier itself and its tests. No production caller
exercises the gate.

This appears to be a regression introduced when Tier 3 PR-C refactored hub
rotation to per-device CLKR; the older single-function gate was unwound and
nothing was wired in its place. It is not load-bearing for the data
confidentiality of any single rotation (the new key is still random, the old
key is still wrapped under the new for chain continuity), but it removes the
defense against a compromised admin device triggering rotation against an
unverified chain head and outracing the device-revoke worker.

**Recommendation:** Either re-introduce a `verifyAuditChain({ hubId, expectHead
}) → throw rotation_trigger_not_at_head` call at the top of
`rotateHubKeyClkr`, or document explicitly in `audit-chain-verifier.ts` that
the error code is reserved for a future caller (so the next audit doesn't
flag it again). I lean toward the former — the cost is one async call before
the rotation runs.

### F-2 (CARRY-FORWARD, LOW): `cookies.ts` helper still not adopted by login / invite paths

**Files:** `src/server/lib/cookies.ts`, `src/server/routes/auth.ts`,
`src/server/routes/invites.ts`

Tier 4 review I-1 documented that login + invite-accept flows still hand-build
their cookie option blocks inline instead of routing through
`refreshCookieOptions()` / `sessionIdCookieOptions()`. Re-grepping the merged
tree, those helpers still have only one production caller (the helper file
itself) and one test caller — so the carry-forward item is unresolved.

Risk: if `API_COOKIE_DOMAIN` is set in production, the helper-built refresh +
session-id cookies use the explicit domain and the inline-built login cookies
do not, producing two cookies of the same name with different `Domain`
attributes and silent session confusion. Already documented in TIER_4_POST_REVIEW
I-1; reconfirmed unresolved on this audit.

**Recommendation:** Schedule a small follow-up PR that deletes the inline option
blocks in `auth.ts` and `invites.ts` and threads everything through the
helpers. No new design work needed; the helpers are correct.

### F-3 (CARRY-FORWARD, MEDIUM): SFrame voice E2EE pipeline is unreachable in production

**Files:** `src/client/lib/webrtc/manager.ts:46-55`,
`src/client/lib/webrtc/adapters/sip.ts`, the unrendered UI components.

This is TIER_5_POST_REVIEW C-1 / C-2, reconfirmed verbatim:

```ts
case 'asterisk':
case 'freeswitch':
case 'kamailio':
case 'sip':
  return new SipWebRTCAdapter()
```

The constructor is called with no `sframeHook` argument. The SIP adapter's
`#sframeHook` plumbing is silent-no-op when no hook is provided
(`if (!hook) return`), so SFrame is never installed on any production call.
`ActiveCallBadge` and `E2eeFallbackBanner` are defined and unit-tested but
imported by zero parent components. `installSFrameTransforms` is imported only
by its own test file. The cryptographic core is correct and the building
blocks all exist — they just don't reach the call flow.

This is the single largest gap in the merged stack. Tier 5 is "feature
complete" only in the sense that the primitives exist and pass their unit
tests. No real call ships with E2EE today.

**Recommendation:** Already tracked as a Tier 6 carry-forward in TIER_5_POST_REVIEW.
Scope is well-understood. No further audit action — flagged here so the next
review pass (or the wiring PR itself) doesn't lose it.

### F-4 (CARRY-FORWARD, MEDIUM): Binary verifier + gossip protocol are dead code

**Files:** `src/client/lib/binary-verifier.ts`,
`src/client/lib/gossip-version.ts`, `src/client/main.tsx`.

This is TIER_4_POST_REVIEW C-6, reconfirmed. No production caller invokes
`verifyOrThrow`. There is no `/api/releases/latest/manifest` server route. The
`GossipVersionClient` has zero callers. The release manifest build step does
not include the crypto-sandbox bundle, so even after wiring the verifier
would never see iframe drift. Already documented and tracked; confirming
unresolved on this audit so the gap doesn't quietly survive a few more rename
passes.

### F-5 (CARRY-FORWARD, MEDIUM): Crypto sandbox iframe postMessage is broken under opaque origin

**Files:** `crypto-sandbox/src/main.ts`,
`src/client/lib/crypto-iframe-client.ts`.

TIER_4_POST_REVIEW C-3, reconfirmed. `bootRealIframe()` sets
`sandbox="allow-scripts"` without `allow-same-origin`, so the iframe runs in
an opaque origin and the parent's `ev.origin !== this.cryptoOrigin` filter
discards every response. The sandbox is not on the critical path today (boot
still goes through the legacy worker), so this is documented as deferred-and-
known. Reconfirming so it is not lost during the SFrame wiring work that will
turn the sandbox into a load-bearing component.

### F-6 (CARRY-FORWARD, LOW): User-sigchain verifier does not verify inner cross-sign signatures

**Files:** `src/client/lib/user-sigchain-verifier.ts`

TIER_3_POST_REVIEW I9, reconfirmed. The `case 'device_cross_sign'` and
`case 'user_cross_sign'` arms in the verifier check the outer Schnorr chain
signature but do not verify the inner Ed25519 cross-sign payload. The comments
in the source say "verify the signer is a same-user device (already checked
above)" and "Track cross-signing state — just recording, no additional
constraints". This is fine as long as the chain entry's outer signature is
trusted (which, in the Tier 3 trust model, it is — the signing device is
already in the trusted set when the entry lands), but it means a same-user
device with cross-sign authority can publish a structurally-malformed inner
payload and the verifier will still accept the chain entry. Documented and
deferred. Reconfirmed.

### F-7 (CARRY-FORWARD, LOW): Master key derivation runs in main thread JS

**Files:** `src/client/lib/cross-signing.ts`

The cross-signing master key is derived in main-thread JS via
`crypto.subtle.importKey`, not behind a WASM/iframe boundary. The module is
imported only by its own test file today — it is not yet wired into
production. Once it lands on the boot path (Tier 6 territory), the master seed
should move into the crypto sandbox iframe so it cannot be observed by main-
thread XSS. Carry-forward.

## What this audit did NOT cover

- **Tier 6 MLS-PQ.** Not merged. Spec/plan/review only.
- **Reviewer fan-out.** The prompt scheduled six parallel pr-review-toolkit
  agents. CI/agent budget for this session was already exhausted by the Tier 5
  merge work and the post-merge cleanup; agent dispatch was substituted with
  primary-source verification in this document. The prior tier post-reviews
  (TIER_0 through TIER_5) provide the multi-reviewer coverage on a per-tier
  basis.
- **Server-side AEAD column path migration to HPKE.** Most envelope-encrypted
  PII columns (contacts, conversations, notes, files) still use the legacy
  ECIES sidecar with label-only AAD as documented in `AEAD_AUDIT_2026-04-10.md`.
  The HPKE primitive landed in Tier 1; the per-record AAD migration of the
  envelope-encrypted columns is tracked as Tier 2+ carry-forward in
  `HPKE_MIGRATION_NOTES.md`. See the post-merge status section appended to
  `AEAD_AUDIT_2026-04-10.md` for the current resolution state per row.
- **Production-load verification.** This is a code review, not a runtime test.
  No real browser was driven; no real call was placed; no actual fleet
  divergence was injected.

## Cross-reference

| Doc | Covers |
|---|---|
| `TIER_0_POST_REVIEW.md` | Albrecht hardening (label index, hub-field AAD, AEAD reuse audit) |
| `TIER_1_POST_REVIEW.md` | HPKE primitive rewrite, hub-field migration, client/server id fix |
| `TIER_2_POST_REVIEW.md` | OPAQUE / Diceware / Shamir / multi-factor KEK |
| `TIER_3_POST_REVIEW.md` | Devices, cross-signing, CLKR, device revoke worker |
| `TIER_4_POST_REVIEW.md` | Origin split, crypto sandbox, binary verifier, gossip protocol |
| `TIER_5_POST_REVIEW.md` | SFrame voice E2EE primitives + key distribution |
| `AEAD_AUDIT_2026-04-10.md` | Per-column ciphertext AAD audit + post-merge status appendix |
| `HPKE_MIGRATION_NOTES.md` | Migration roadmap for legacy ECIES → HPKE |

## Local verification

Run from `/media/rikki/recover2/projects/llamenos-hotline` on
`audit/post-overhaul-security-stack` at `e81b8bdd`:

```
bun run typecheck   # PASS (0 errors)
bun run lint        # PASS (warnings only, 0 errors)
bun run build       # PASS (SPA + crypto-sandbox build clean)
bun run test:unit   # PASS apart from the documented panic-wipe.test.ts
                    # cross-file pollution of cryptoWorker.lock — pre-existing,
                    # unrelated to anything in scope of this audit.
```

## Recommendations summary

In rough priority order (highest first):

1. **Wire SFrame** (F-3) — the single largest gap. The wiring PR is well-scoped
   in TIER_5_POST_REVIEW C-1 / C-2.
2. **Wire `verifyOrThrow` + ship `/api/releases/latest/manifest`** (F-4) — fix
   the dead binary verifier so users get the fail-closed guarantee Tier 4 PR-C
   advertised.
3. **Re-introduce the chain-head gate on `rotateHubKeyClkr`** (F-1, fresh).
4. **Resolve the crypto sandbox opaque-origin postMessage breakage** (F-5)
   before the sandbox becomes load-bearing.
5. **Adopt `cookies.ts` helpers in login + invite paths** (F-2) — small,
   mechanical PR.
6. **Verify inner cross-sign signatures in `user-sigchain-verifier.ts`** (F-6)
   when cross-signing lands on the production boot path.
7. **Move `cross-signing.ts` master seed into the crypto sandbox** (F-7) when
   cross-signing lands on the production boot path.
