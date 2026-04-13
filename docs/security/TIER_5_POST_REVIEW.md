# Tier 5 Post-Review — Voice E2EE via SFrame

**Date:** 2026-04-12
**PR:** #76 (`feat/sec-tier-5-impl-voice-main`)
**Reviewers dispatched:** 6 (pr-review-toolkit: code-reviewer, silent-failure-hunter,
type-design-analyzer, pr-test-analyzer, comment-analyzer; superpowers: code-reviewer)

## Summary

The SFrame cryptographic core is solidly implemented. Cipher suite pinning
(AES_128_GCM_SHA256_128, no negotiation), HKDF key derivation with domain
separation, AAD binding (callId + senderId + keyId), nonce construction
(SSRC || rtpTimestamp || counter), branded byte types (CiphertextBytes /
PlaintextBytes), and worker isolation are all correct. SRTP keys are never
logged. The sip-bridge recording ban is enforced. Test coverage of
cryptographic primitives is thorough.

The integration layer has gaps: the SFrame pipeline is fully built but not
yet connected to the call flow in production. These are carry-forward items
for the wiring phase.

## Fixes Applied in This Review

### Critical

1. **Nostr kind 20002 collision** — `KIND_SFRAME_KEY` and `BUNDLE_ATTEST_KIND`
   (gossip-version.ts) both used kind 20002. Moved SFrame keys to kind 20004
   and DTLS binding to kind 20005 to avoid collision.
   Files: `src/shared/nostr-events.ts`

### Important

2. **Bridge recording guard fail-open default** — `execBridge` defaulted to
   `mode='pstn'` when call state was missing, allowing accidental recording of
   untracked SFrame calls. Changed to `mode='sframe'` (fail-closed).
   Files: `sip-bridge/src/command-handler.ts`

3. **Worker catch-all error code** — `handleRequest()` catch-all used misleading
   `'worker_not_ready'` code for all unexpected errors. Added `'internal_error'`
   to `SFrameErrorCodeSchema` and use it in the catch-all.
   Files: `src/shared/schemas/sframe-worker-messages.ts`, `src/client/lib/webrtc/sframe-worker.ts`

4. **`parseStasisArgs` case sensitivity** — Asterisk extensions.conf is
   case-insensitive for app names but case-sensitive for args. A dialplan typo
   (`SFrame` vs `sframe`) would silently disable SFrame mode. Made matching
   case-insensitive.
   Files: `sip-bridge/src/sframe-mode-dispatcher.ts`, `sip-bridge/src/sframe-mode-dispatcher.test.ts`

### Comment Fixes

5. **Chrome version in feature-detect** — "Chrome 2025+" → "Chrome 100+"
   (confused calendar year with browser version).
   Files: `src/client/lib/webrtc/feature-detect.ts`

6. **HKDF comment accuracy** — "HKDF-Expand-Label style" → "HKDF (RFC 5869,
   extract + expand)". The code uses full HKDF, not TLS 1.3 Expand-Label.
   Files: `src/shared/sframe/cipher-suite.ts`

7. **JFrame compatibility claim** — "Jitsi JFrame v1 compatible" → "structurally
   modeled after Jitsi JFrame v1, NOT wire-compatible". AAD and nonce differ.
   Files: `src/shared/sframe/frame-codec.ts`

8. **Trailer AAD binding accuracy** — Comment said trailer contents are "bound
   into the per-frame AAD" but only keyId is in AAD; counter is in the nonce.
   Files: `src/shared/sframe/trailer.ts`

## Critical Findings — Deferred to Tier 6

### C-1: SFrame hook not wired in WebRTC manager

`src/client/lib/webrtc/manager.ts` creates all four adapters (`new TwilioWebRTCAdapter()`,
etc.) without passing `sframeHook`. The entire SFrame pipeline is unreachable in
production. All adapters have the hook plumbing; the manager just never passes it.

### C-2: UI components not rendered in call flow

`ActiveCallBadge` and `E2eeFallbackBanner` are defined and unit-tested but never
imported by any parent component or route. No user will ever see the E2EE badge
or fallback consent modal in the current state.

### C-3: Vonage + Plivo adapters — dead `#installHook` code

Both adapters define `#installHook` but never call it (TODO comments about SDK
pc accessor). When these providers are used, SFrame is silently skipped even if
the manager wiring (C-1) is fixed. Should fail loudly when `sframeHook` is
provided but pc is inaccessible.

## Important Findings — Deferred to Tier 6

### I-1: Worker frame-drop silent failure

`sframe-worker.ts` lines 273-276: frame decryption errors are caught, metrics
incremented, and frames silently dropped. No production code polls `getMetrics()`.
Sustained decryption failure = silent audio dropout with no user notification.
Need a threshold-based notification to the main thread.

### I-2: No RPC timeout on SFrame worker client

`sframe-worker-client.ts` `call()` creates promises that never timeout if the
worker hangs or crashes. Add timeout (e.g., 5s) to prevent frozen UI during
key registration/rotation.

### I-3: Twilio adapter pc access via undocumented internal API

`twilio.ts` `#pcFromConnection` reaches into `conn.mediaHandler.version.pc` — an
undocumented internal Twilio SDK path. SDK update could silently break SFrame
for all Twilio calls with no error emitted.

### I-4: `E2eeFallbackBanner` — no defense against external unmounting

If the parent component unmounts the modal without the user clicking Cancel or
Continue (e.g., remote hangup, route navigation), the consent decision is bypassed.
Need fail-closed tracking at the call-state-machine level.

### I-5: Audit entry variants not implemented

Plan called for `call_e2ee_state_change` and `call_sframe_key_rotation` audit
payload variants. These are security-critical events that should be audit-logged.

### I-6: `LABEL_SFRAME_BASE_KEY` branding inconsistency

Branded as `CryptoLabel` but used as HKDF info and raw UTF-8 in AAD, not as an
ECIES/AEAD label. Per codebase rules, should be a plain `string`. Similarly,
`LABEL_SFRAME_RATCHET` is in `LABEL_REGISTRY` but only used as an HKDF salt.

### I-7: VOICE_E2EE.md describes fallback as "banner" but it's a modal

Doc says "persistent banner at the top of the call UI" but the component renders
a full-screen modal overlay with `role="alertdialog"`. Doc should say "modal".

### I-8: Browser matrix Chrome version discrepancy

`VOICE_E2EE_BROWSER_MATRIX.md` claims Chrome 94+ for `RTCRtpScriptTransform`,
but that version shipped the older `createEncodedStreams` API. The constructor-
based API used in this codebase likely requires Chrome 100+.

## Type Design Improvements — Deferred

1. **Brand key material pipeline**: `CallSecret` (32B) → `BaseKeyMaterial` (16B)
   → `CryptoKey`. Three branded types would prevent cross-contamination.
2. **Accept `PlaintextBytes` in `sealFrame`**: Prevents accidental double-
   encryption at compile time (zero runtime cost).
3. **Validate worker messages at trust boundary**: `SFrameWorkerRequestSchema.parse()`
   in `onmessage` handler instead of `as` cast.

## Test Coverage Gaps — Deferred

1. Worker `TransformStream` pipeline (encode/decode through the pipe, not just
   `handleRequest`)
2. DTLS fingerprint mismatch integration (verify call setup code calls
   `verifyDtlsFingerprint` and terminates on throw)
3. Key distribution end-to-end (buildKeyEvent → Nostr → parseKeyEvent → worker)
4. Fallback banner integration with call flow (onContinue/onCancel behavior)
5. UI E2E test bodies (5/6 files are skip-gated stubs with empty bodies)

## Security Verification Results

| Check | Result |
|-------|--------|
| SRTP keys never logged | PASS — no `console.*key`, `logger.*key`, `debug.*key` in sframe/webrtc code |
| Silent fallback absent | PASS — all 4 adapters close pc + disconnect on hook failure; `E2eeFallbackBanner` hides continue button when `policy=required` |
| Domain separation | PASS — all SFrame crypto contexts use constants from `crypto-labels.ts` |
| Raw sframe label literals | PASS — CI grep guardrail blocks raw `llamenos:sframe-*` strings |
| Recording ban enforced | PASS — `SframeModeDispatcher.assertRecordingAllowed()` throws on sframe mode |
| Nostr kind collision | FIXED — moved to 20004/20005 |

## Verification After Fixes

| Tool | Result |
|------|--------|
| `bun run typecheck` | PASS (0 errors) |
| `bun run lint` | PASS (warnings only, 0 errors) |
| `bun run build` | PASS |
| `bun run test:unit` | 1788 pass, 1 skip, 0 fail |
