# Post-Overhaul Security Stack Audit — 2026-04-12

**Branch:** `audit/post-overhaul-security-stack`
**Base SHA:** `e81b8bdd` (post Tier 0 → Tier 5 merges, post EnvelopeV3 → HpkeEnvelope rename)
**Scope:** End-to-end verification of the merged 7-tier security overhaul (Tier 0
Albrecht hardening through Tier 5 SFrame voice E2EE). Tier 6 MLS-PQ is not in
scope — it is still an unmerged feature branch.

## Executive summary

The merged 7-tier security stack is structurally sound at the primitive layer
(20/20 invariants PASS on first-pass verification, all confirmed by the
independent `superpowers:code-reviewer` fan-out), but the phase-2 parallel
reviewer fan-out surfaced **one CRITICAL authorization bypass** in the
audit-log write path (F-8: `payloadIsAuthorizedFor` never binds the signer
identity to the payload target for Tier 2 / Tier 3 payloads) that the
primary-source audit missed, plus **four HIGH** findings — a dormant AAD
schema mismatch (F-9), a device-revoke worker that reports completion
without rotating (F-11), the already-known Tier 5 wiring gap that must be
severity-bumped because the whitepaper is advertising it (F-3), and a set
of whitepaper claims that contradict code (F-16). Thirteen additional
MEDIUM/LOW findings round out the picture, almost all of which are either
dormant (unreachable code paths, dead-code verifiers) or doc drift. This
document supersedes the phase-1 version with 18 fresh findings (F-8..F-19),
re-ranked recommendations, and preserved F-1..F-7 carry-forwards.

This audit is a *post-merge* sanity check, not a re-review of every tier. Each
tier already has its own `TIER_N_POST_REVIEW.md`. The point of this document is
to confirm that the invariants those reviews promised still hold on `main`
after the merges, the `EnvelopeV3` → `HpkeEnvelope` rename, the `key-store-v2`
→ `key-store` consolidation, and the `hub-field-crypto-v3` → `hub-field-crypto`
consolidation that landed in commits `b7b70671..e81b8bdd`.

## Method

- Phase 1 (author): Direct verification via Grep/Read against the merged tree.
  All F-1..F-7 findings below are from primary-source code review.
- Phase 2 (parallel reviewer fan-out, 2026-04-12): Dispatched the six
  pr-review-toolkit agents the prompt originally scheduled —
  `code-reviewer`, `silent-failure-hunter`, `type-design-analyzer`,
  `pr-test-analyzer`, `comment-analyzer`, and an independent
  `superpowers:code-reviewer` second opinion. Their findings are consolidated
  in the "Parallel reviewer findings (F-8..F-18)" section below; every
  load-bearing CRITICAL / HIGH claim was spot-verified by re-reading the cited
  file:line before landing in this document.
- Local verification: `bun run typecheck`, `bun run lint`, `bun run build`, and
  `bun run test:unit` (acceptable known failure: `panic-wipe.test.ts`
  cross-file pollution with `key-manager.lock` — pre-existing, tracked, not
  introduced by anything in scope of this audit. Update: the pr-test-analyzer
  reviewer confirms the `panic-wipe.test.ts` save/restore pattern has since
  been fixed at lines 43-153; adjacent crypto tests are no longer poisoned.)
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

### F-1 (FRESH, MEDIUM → LOW after reachability check): `rotateHubKeyClkr` no longer enforces the chain-head gate

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

**Reachability note (post-phase-2):** `rotateHubKeyClkr` has zero production
callers (`grep -rn 'rotateHubKeyClkr' src` returns only the implementation
and its own test file; the `crypto-rpc.ts:72` `'rotateHubKey'` op schema has
no worker-side implementation). F-1 is therefore unreachable in production
today, so the effective severity is LOW. It will flip back to MEDIUM the
moment the wiring PR lands — **fix before wiring** regardless.

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

### F-3 (CARRY-FORWARD, MEDIUM → HIGH post-phase-2): SFrame voice E2EE pipeline is unreachable in production

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

**Severity bump (post-phase-2):** The `comment-analyzer` reviewer confirmed
that `WHITEPAPER.md` §4 / §5 already advertise voice E2EE as if it ships.
With that drift in play, F-3 is no longer a deferred primitives-only gap —
it is the code side of a user-facing security claim that is currently
unsupported. Bumping to HIGH. See F-16.

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

## Parallel reviewer findings (F-8..F-18)

The six reviewer agents dispatched in phase 2 turned up eleven additional
findings, most of which the primary-source author missed. Each row below was
re-verified against the merged tree before landing here. Where a reviewer's
severity proposal is downgraded by production reachability, I note why inline.

### F-8 (FRESH, CRITICAL): `payloadIsAuthorizedFor` ignores signer identity for Tier 2/Tier 3 payloads

**File:** `src/server/services/audit-log-service.ts:70-109` (authorization
function), `:172-181` (call site in `appendSigned`)

`payloadIsAuthorizedFor(payload, role)` returns `true` unconditionally for
every Tier 2 and Tier 3 payload type — `factor_add`, `factor_remove`,
`root_kek_rotate`, `user_init`, `tier3_device_add`, `tier3_device_remove`,
`puk_rotate`, `user_master_signing_update`, `device_cross_sign`,
`user_cross_sign`, `recovery_initiated`, `recovery_completed`, plus the
legacy Tier 0 `device_add`/`device_revoke`. The function only receives
`role: string` — it never sees the **target** `userId` embedded in the
payload, and `appendSigned` never binds `entry.payload.userId` /
`payload.signerUserId` / `payload.signedByDeviceId` to the signer resolved
from `findSignerByPubkey`.

**Attack:** an authenticated volunteer in hub H signs a `tier3_device_remove`
entry whose `payload.userId` is an admin's user id and `removedDeviceId` is
that admin's active device id. The Schnorr signature validates against the
volunteer's own pubkey; the signer is "known" to the registry; the role check
hits `case 'tier3_device_remove': return true`; the entry lands in the chain
and downstream consumers (`audit-chain-verifier.ts#device_revoke` arm)
shrink the trusted device set accordingly. Variants:
`puk_rotate` with an attacker-chosen `newPukSignPubkey` against any target;
`user_cross_sign` claiming the volunteer cross-signed anyone; `factor_remove`
stripping an admin's recovery factor.

The attack requires chain-head-write access and the hub's current prev hash,
both available to any hub member running a modified client. There is no
defense-in-depth: `user-sigchain-verifier.ts` does not verify inner
cross-sign signatures (F-6), so even the cross-sign arms don't have a second
gate.

**Severity:** CRITICAL. This is a straight authorization bypass on a gate
that exists precisely to prevent it. The primary audit missed it because
Tier 3 plan docs described the gate as "any authenticated signer" without
spelling out that the signer must be bound to the target.

**Recommendation:** `payloadIsAuthorizedFor` must take
`(payload, signer, signerDeviceId)` and enforce, per payload type:
- Every payload carrying `userId`: `signer.id === payload.userId` (self-service)
  OR `signer.role in {admin, super_admin}` for admin-revocation variants.
- `*_cross_sign`: `payload.signerUserId === signer.id`.
- `*_remove`, `puk_rotate`, `user_master_signing_update`: additionally verify
  that the resolved signer's device id (via `userDevices.deviceId`) matches
  `payload.signedByDeviceId` and that device is not itself revoked.
- `AuditSignerLookup` must return `{ id, role, deviceId }`.

### F-9 (FRESH, HIGH): dormant AAD schema mismatch between client and server hub-key wrap paths

**Files:** `src/client/lib/hub-key-manager.ts:102,163`,
`src/server/lib/hpke-service.ts:141,163,184,198,204`

Client-side wrap/unwrap of the hub key uses
`buildAad(LABEL_HUB_KEY_WRAP, deviceId, hubId)`. The server-side `HpkeService`
— whose docstring explicitly claims it will replace the legacy ECIES
`CryptoService` path per `HPKE_MIGRATION_NOTES.md` — uses
`buildAad(LABEL_HUB_KEY_WRAP, memberPubkeyHex, 'hub-key-wrap')`. These
produce different AAD strings, so AES-GCM authentication will fail in either
cross-direction.

`HpkeService` has no production caller today (only its own unit tests), so
live traffic is unaffected — this is a **dormant** bug. But the moment
someone follows the migration note and wires `HpkeService` into a real route,
every existing device-wrapped hub-key envelope becomes un-unwrappable and
every freshly server-wrapped envelope is un-unwrappable by existing clients.
This is precisely the drift class that the single-source `hubFieldAad`
helper was created to eliminate.

**Recommendation:** Introduce `hubKeyWrapAad(recipientId, hubId)` in
`src/shared/lib/` as the single source of truth, delete the two local
formulas, and add a cross-direction unit test (client seal → server open,
server seal → client open) that runs in CI before `HpkeService` gets
wired into any production route.

### F-10 (FRESH, MEDIUM downgrade from reviewer CRITICAL): CLKR rotation silently commits partial device envelopes

**Files:** `src/client/lib/hub-key-manager.ts:113-146` (`wrapHubKeyForDevices`),
`:315-351` (`rotateHubKeyClkr`)

`wrapHubKeyForDevices` uses `Promise.allSettled`, logs rejected settlements
via `createDebugLog('llamenos:hub-key-manager')` (per
`feedback_createDebugLog_stripped_in_prod.md`, stripped in production), and
returns only the succeeded subset. `rotateHubKeyClkr` builds its
`HubKeyRotationResult` from that subset with no per-device failure metadata:
the caller that audit-logs the rotation and writes the new generation row
writes an entry claiming "rotated to gen N" while any failed-wrap devices
never received a gen-N envelope. Those devices are permanently unable to
decrypt anything written after the rotation, with no diagnostic.

**Severity downgrade rationale:** The silent-failure-hunter reviewer flagged
this as CRITICAL. Reachability check:
`grep -rn 'rotateHubKeyClkr\|wrapHubKeyForDevices' src --include='*.ts'`
returns only `hub-key-manager.ts` itself and its own test file — no
production caller. The crypto-worker RPC schema defines a `'rotateHubKey'`
op in `src/shared/schemas/crypto-rpc.ts:72` but neither the worker nor the
client implements it. Currently unreachable in production → MEDIUM rather
than CRITICAL. Will flip to CRITICAL the moment the wiring PR lands, so
**fix before wiring**.

**Recommendation:** Return `{ envelopes, failures }` from
`wrapHubKeyForDevices`. `rotateHubKeyClkr` must either fail closed (throw
on any wrap failure) or surface `failures` so the caller can abort the
audit-log write. At minimum switch the `log(...)` to `console.error(...)`
so the failure is observable in prod.

### F-11 (FRESH, HIGH): `device-revoke-worker` reports "completed" without actually rotating

**Files:** `src/server/jobs/device-revoke-worker.ts:302-314,323-366,157-162`

`processHubRotationWithRetry` (line 323) only DELETES the revoked device's
`hub_key_envelopes` rows. It never inserts the `hub_ptk_generations` row —
that row is written later by `processHubRotation` (line 203), which is only
called by the client asynchronously. `processRevocation` reports each hub as
`status: 'completed'` as soon as the delete succeeds (line 157-162).

Meanwhile `isHubRotationComplete` (the idempotency probe at line 302)
returns true only when the generation row exists. Failure mode: if the
client never follows up with `processHubRotation` (browser crash, tab
closed, network drop mid-flight), the hub is left with the revoked
envelopes gone but the key un-rotated. On the next invocation for the same
`revokeEntryHash`, `isHubRotationComplete` still returns false (so the
delete is retried against zero rows — no-op), `processRevocation` again
reports `completed`, and the queue never retries the real work.
`ROTATION_DEADLINE_MS` at lines 177-182 is a log-only warning — blowing
past the 30-second deadline produces no failure.

The revocation is permanently wedged with no error surface.

**Reachability:** the worker IS wired as a background job. This is a live
code path — HIGH severity stands.

**Recommendation:** `isHubRotationComplete` must check both that the
generation row exists AND that the envelopes were deleted (or the worker
must record its own job-status row). Partial states must requeue, not
return completed. The deadline must be a failure, not a warning.

### F-12 (FRESH, MEDIUM): `audit-chain-verifier` silently tolerates `device_revoke` for unknown devices

**File:** `src/client/lib/audit-chain-verifier.ts:203-205`

The `device_revoke` arm calls `trusted.delete(entry.payload.devicePubkey)`
without first asserting the pubkey was previously in `trusted` (from a
prior `device_add` or the initial anchor set). A chain entry revoking a
device that was never added silently no-ops — breaking the invariant that
every `device_revoke` has a matching `device_add` predecessor. This is
exactly the failure mode the original audit prompt called out as
"revoke of unknown device" / "revoke-before-add ordering", and it's
unguarded.

**Recommendation:** throw `ChainVerificationError('device_revoke_unknown_device')`
when `trusted.delete` would remove a pubkey it does not contain. Same for
`trusted.has(...)` pre-check on revoke.

### F-13 (FRESH, MEDIUM): empty-chain verify persists poisoned cache row before throwing

**File:** `src/client/lib/audit-chain-verifier.ts:211-222`

`await cache.put(newRow)` runs before the `empty_chain` throw. A hub with
a cleared cache and zero server entries writes a cache row with
`lastVerifiedEntryHash: null, headEntry: null` and then throws. Subsequent
verify calls read the poisoned row back and behave as though the cache had
never been primed. Low real-world impact (the path is already broken), but
it's a silent half-commit inside a security-critical verifier.

**Recommendation:** move the `put` after the `empty_chain` check.

### F-14 (FRESH, MEDIUM): `decrypt-fields` recovery swallows AAD failures via dev-only logger

**File:** `src/client/lib/decrypt-fields.ts:153-219,366-369`

The "worker claims unlocked but decrypt still fails" branch is explicitly
documented at line 200-208 as "should not happen during normal operation"
— exactly the case where an AEAD authentication tag failed (possible
causes: wrong label, cross-record AAD mismatch, genuine corruption,
poisoned envelope). The only diagnostic is `log(...)` via
`createDebugLog(...)`, which is stripped in production. In prod the user
sees `[encrypted]` placeholders with zero telemetry and zero way to
distinguish "you don't have the key" from "AEAD tag verify failed".

**Recommendation:** switch the security-relevant branches
(unlocked-but-failing, isUnlocked probe failure) to `console.error` at
minimum per `feedback_createDebugLog_stripped_in_prod.md`.

### F-15 (FRESH, LOW): `decryptHubField` returns short ciphertext as plaintext on fall-through

**File:** `src/client/lib/hub-field-crypto.ts:172-187`

`decryptHubField` uses a `looksLikeCiphertext` heuristic: if the string is
shorter than 40 chars OR contains a non-base64url character, the function
returns the input itself as "plaintext". Real hub-key ciphertexts always
exceed the heuristic today, so in normal operation this is harmless — but
any future caller that passes a short encrypted string, or any future
column format that shortens the blob, will get the still-encrypted bytes
handed back as plaintext. The path also produces no telemetry on AEAD
decrypt failure.

**Recommendation:** drop the heuristic and treat "hub key is loaded,
decrypt returned null" as a hard failure with placeholder + logged error.

### F-16 (FRESH, HIGH doc drift): `WHITEPAPER.md` advertises protection the code does not deliver

**Files:** `docs/security/WHITEPAPER.md` §4.1 (lines 185-214), §4.3 (line
272), §5.4-5.6 (lines 422-526), §6.3 (lines 591-603), §7.5 (line 683), §9
(line 790), §10

The comment-analyzer reviewer found the whitepaper makes several claims
that contradict merged code. Spot-verified against source:

1. §4.1 lines 190-194: "HPKE uses `DHKEM(P-256, HKDF-SHA256)` kem and
   `ChaCha20-Poly1305` aead". Code (`src/shared/crypto-suite.ts`):
   `DHKEM(X25519, HKDF-SHA256) + AES-256-GCM`. Both the KEM curve and the
   AEAD are different from the advertised suite. §7.5 line 683 repeats
   "HPKE-P256 is not post-quantum secure" — same error.
2. §4.1 lines 190-214: claims note content keys are HPKE-wrapped. Code:
   notes still use the legacy ECIES sidecar (`crypto-worker-helpers.ts`
   calls `eciesUnwrapKey(envelope, LABEL_NOTE_KEY)`); this is Bucket B in
   `AEAD_AUDIT_2026-04-10.md`, tracked as the next migration slice.
3. §4.3 line 272: "Source: `src/client/lib/key-store-v2.ts`". Post-merge
   cleanup renamed this to `key-store.ts` (commit `75dc7a45`).
4. §5.5 lines 445-473 + §6.3 lines 591-603: promises a client-side binary
   verifier that fails closed on every unlock, with a "Run the one-click
   Verify bundle" user flow. Reality (F-4 in this audit): `verifyOrThrow`
   has zero production callers, `/api/releases/latest/manifest` is not a
   route, no security menu entry exists.
5. §5.6 lines 484-526: promises kind-20002 gossip attestation on every
   unlock via `GossipVersionClient`. Reality (F-4): `GossipVersionClient`
   has zero callers.
6. §5.4 + §10: references `verify-llamenos.yml` GitHub Action and
   `docs/security/VERIFIER_MOU.md`. Neither file exists.
7. §9 line 790: "AEAD audit… Clean." The cited document explicitly lists
   pending Bucket B rows. Not clean.

§1 property #5 ("code running in your browser matches the code the repo
shipped") is the keystone of the whitepaper's marketing claim, and in the
merged tree it is unenforced. This is the single most dangerous drift in
the doc set.

**Severity:** HIGH despite being a doc-only finding because publishing
the whitepaper as-is promises protection that doesn't ship. A crisis-
response hotline whose threat model is nation-state adversaries cannot
afford a gap between advertised and actual cryptographic protection.

**Recommendation:** §4.1, §5.5, §5.6, §7.5, and §9 must be rewritten to
match the merged stack before the whitepaper can circulate publicly.
§5.5 and §5.6 should either be removed or rewritten to say "planned,
not yet shipping".

### F-17 (FRESH, LOW doc drift): `CLAUDE.md` has stale descriptions

**File:** `CLAUDE.md` (project root)

- Line ~100: "All 25 crypto context constants in `src/shared/crypto-labels.ts`".
  Actual: `LABEL_REGISTRY` contains 42 labels; the file exports 71 `LABEL_*`
  constants. Stale count.
- Line ~106: "legacy ECIES path… retained as a sidecar for unmigrated call
  sites (notes/files/**hub-key-manager**/provisioning)". Post-Tier 1 PR-B,
  `hub-key-manager.ts` uses `hpkeSeal`/`hpkeOpen`. Remove `hub-key-manager`
  from the unmigrated list.
- Line ~115: "Hub-key encrypted org metadata… **Symmetric XChaCha20** with the
  hub's shared key." Code (`hub-field-crypto.ts`) uses AES-256-GCM via a
  non-extractable `CryptoKey`. Pre-Tier-1 description.

**Recommendation:** small follow-up PR to refresh these three bullets.

### F-18 (FRESH, LOW): `HPKE_MIGRATION_NOTES.md` uses pre-rename filenames

**File:** `docs/security/HPKE_MIGRATION_NOTES.md`

Uses `envelope-v3.ts`, `EnvelopeV3`, `key-store-v3`, `hub-field-crypto-v3.ts`,
`key-store-v2.ts`, `0054_tier1_items_key_columns.sql` — all renamed or
renumbered by commits `b7b70671..e81b8bdd`. The post-Tier-1 completion of
the `key-store-v2.ts` deletion is still listed as "Deferred beyond Tier 1".

**Recommendation:** doc refresh sweep. Not blocking.

### F-19 (FRESH, INFORMATIONAL): CI guardrail allowlist has dead entries

**File:** `.github/workflows/ci.yml:636`

`TIER1_LEGACY_ALLOW` allowlists `src/client/lib/crypto-service.ts` and
`src/server/lib/crypto-service.ts`. Neither file exists in the tree; they
were renamed and consolidated during the post-Tier-1 cleanup commits. The
guardrail still fires correctly (every file actually importing legacy
primitives is matched), but the allowlist is supposed to shrink as
migrations land and stale entries obscure that progress.

**Recommendation:** prune `crypto-service.ts` entries from the allowlist
next time anyone touches the guardrail.

### Type-design recommendations (from `type-design-analyzer`)

The reviewer produced scorecards for `CryptoLabel`, `HpkeEnvelope`,
`SignedAuditEntry`, `DeviceKeypair`, Shamir share types, and SFrame types.
Three improvements with outsized ROI, in severity order:

1. **`sframeHook?:` → discriminated union.** `SFramePeerConnectionHook`
   is currently an optional-nullable field on `SipWebRTCAdapter`. The
   absence of E2EE is indistinguishable from a conscious opt-out. For a
   threat model dominated by voice interception this should be an
   explicit `{ e2ee: 'on', hook } | { e2ee: 'off' }` so every call site
   consciously picks one or the other. Single-file change,
   `src/client/lib/webrtc/sframe-hook-types.ts:20-29`. Also directly
   addresses the root-cause of F-3 (silent voice-E2EE-off default).
2. **`VerifiedAuditEntry` phantom type.** `SignedAuditEntry` is used as
   the argument of `appendSigned` (pre-verification) and as the storage
   row (post-verification). A `VerifiedAuditEntry extends SignedAuditEntry
   & { readonly __verified: unique symbol }` returned by a pure
   `verifyAuditEntry` helper would make it impossible for a future route
   handler to persist a row that was merely schema-parsed. Zero wire
   impact, one-file refactor of `audit-log-service.ts:135`.
3. **Brand the 32-byte secrets.** `CallSecret`, `SenderBaseKey`,
   `HexHash32`, `HexPubkey32`, `SchnorrSig` — five brand types eliminate a
   whole cross-wiring bug class at zero runtime cost. Most impactful in
   `sframe-key-distribution.ts:39` and `audit-log-service.ts:147-166`,
   where the same raw bytes are currently used in multiple distinct roles.

### Adversarial test coverage gaps (from `pr-test-analyzer`)

Strong coverage already exists for HPKE (label swap, AAD row swap, v2
reject), audit-log-service (prevHash/entryHash mismatch, signer
authorization), hub-field-crypto (row/column swap), and binary-verifier
(every non-match status). Significant gaps:

- **SFrame has zero adversarial tests.** `sframe-worker.test.ts` only tests
  state management. No seal→open round-trip, no wrong-key-fails, no replay/
  epoch-mismatch, no cross-call-injection. This is the single largest test
  gap in the suite.
- **CLKR rotation has zero fault injection.** `hub-key-manager.test.ts`
  covers happy paths only. No "one of N pubkeys malformed" test, no
  "all devices fail" test, no commitment-matches-actual-envelopes test.
  Directly related to F-10 — the partial-commit bug is invisible because
  nothing tests for it.
- **Shamir missing cross-split & duplicate-share cases.**
  `recovery-group-share.test.ts` covers (t-1) fails and tampered-share
  rejection, but doesn't prove that mixing shares from two independent
  splits fails (instead of silently returning garbage).
- **Cross-signing missing replay and untrusted-signer cases.**
  `cross-signing.test.ts` covers tampered-bit failure but doesn't pin
  rejection of a cross-sign produced by a device not yet in the trust set,
  nor replay of an old cross-sign after revocation.
- **`device-revoke-worker.test.ts` tests a reimplementation.** The
  idempotency and partial-failure tests monkey-patch `processRevocation`
  itself, so they exercise a hand-rolled stand-in rather than the real
  worker. This is effectively tautological — it cannot catch a regression
  in the real method. Directly related to F-11.
- **Audit chain fork/missing-prev tests absent.** `audit-chain-verifier.test.ts`
  covers prev/hash/sig tampers but not "two entries with the same prevHash"
  or "prevHash pointing to nowhere".

**Recommendation:** a `tests/security/adversarial-*.test.ts` sweep that
specifically targets these gaps. Priority order: SFrame → CLKR → Shamir
cross-split → device-revoke worker rewrite → audit chain fork.

## What this audit did NOT cover

- **Tier 6 MLS-PQ.** Not merged. Spec/plan/review only.
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

Re-ranked after the phase-2 reviewer fan-out. Severity order (highest first):

### CRITICAL — fix before anything else ships

1. **F-8: Bind signer identity to payload target in `payloadIsAuthorizedFor`.**
   Straight authorization bypass on the audit-log write gate.
   `src/server/services/audit-log-service.ts:70-181` — refactor
   `payloadIsAuthorizedFor` to take `(payload, signer, signerDeviceId)` and
   enforce self-service vs admin-authority per payload type. Also enrich
   `AuditSignerLookup` to return `deviceId`.

### HIGH — fix before next release

2. **F-11: Make `device-revoke-worker` actually rotate, not just delete.**
   Live code path; the worker currently reports `completed` without
   writing the generation row, and the idempotency probe masks the gap.
3. **F-3 (bumped HIGH): Wire SFrame into the WebRTC adapters.** Zero
   production calls use E2EE today. Primitives ship; plumbing does not.
   The whitepaper claims voice E2EE; current reality does not match —
   this is also the easiest-to-fix F-16 drift item.
4. **F-9: Unify the hub-key wrap AAD shape between client and server.**
   Dormant bug that will brick hub unwrap the moment `HpkeService` is
   wired into any route. Add shared helper + cross-direction CI test.
5. **F-16: Rewrite `WHITEPAPER.md` §4.1/§5.5/§5.6/§7.5/§9 to match code.**
   Advertises P-256 + ChaCha20 + HPKE-wrapped notes + fail-closed
   verifier that don't ship. Block public circulation until resolved.

### MEDIUM — fix before the next wave of wiring

6. **F-4: Wire `verifyOrThrow` + ship `/api/releases/latest/manifest`.**
   Binary verifier is correct but unreachable. Marketing claim in F-16
   #4 is unsupportable without this.
7. **F-10: Pre-emptively fix CLKR partial-commit before wiring.** MEDIUM
   only because `rotateHubKeyClkr` is currently unreachable in production
   — flips to CRITICAL on the day it gains a production caller.
8. **F-1: Re-introduce the chain-head gate on `rotateHubKeyClkr`.** Same
   reachability caveat as F-10.
9. **F-12: Throw `device_revoke_unknown_device` in the audit chain
   verifier** instead of silently no-op'ing `trusted.delete`.
10. **F-13: Reorder the empty-chain check in `audit-chain-verifier.ts`**
    so the cache row is not persisted before the throw.
11. **F-14: Switch `decrypt-fields` error paths to `console.error`** —
    the dev-only logger is stripped in prod.
12. **F-5: Resolve the crypto sandbox opaque-origin postMessage breakage**
    before the sandbox becomes load-bearing.

### LOW / cleanup

13. **F-2: Adopt `cookies.ts` helpers in login + invite paths.**
14. **F-6: Verify inner cross-sign signatures in `user-sigchain-verifier.ts`**
    when cross-signing lands on the production boot path.
15. **F-7: Move `cross-signing.ts` master seed into the crypto sandbox**
    when cross-signing lands on the production boot path.
16. **F-15: Drop the `looksLikeCiphertext` heuristic in `decryptHubField`.**
17. **F-17: Refresh stale `CLAUDE.md` bullets** (label count,
    hub-key-manager legacy callout, hub-field AEAD algorithm).
18. **F-18: Refresh `HPKE_MIGRATION_NOTES.md`** with post-rename filenames.
19. **F-19: Prune stale `TIER1_LEGACY_ALLOW` entries in `ci.yml`.**

### Type-design and test-coverage improvements (not severity-ranked)

20. **`sframeHook?:` → `{ e2ee: 'on', hook } | { e2ee: 'off' }` discriminated
    union.** Highest-ROI type fix in the audit; directly addresses F-3's
    root cause.
21. **`VerifiedAuditEntry` phantom type** on `appendSigned` return / input
    boundary.
22. **Brand `CallSecret`, `SenderBaseKey`, `HexHash32`, `HexPubkey32`,
    `SchnorrSig`** to prevent cross-wiring at the bytes level.
23. **SFrame adversarial test sweep** (seal→open, wrong key, replay,
    cross-call injection) — biggest test gap in the suite.
24. **CLKR fault-injection tests** (one malformed pubkey, all-fail).
25. **Shamir cross-split + duplicate-share tests.**
26. **Rewrite `device-revoke-worker.test.ts`** so it exercises the real
    worker rather than a reimplementation of it.
