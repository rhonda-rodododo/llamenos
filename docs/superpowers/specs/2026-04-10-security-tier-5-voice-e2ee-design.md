# Security Tier 5 — Voice E2EE via SFrame

**Date:** 2026-04-10
**Status:** Draft
**Branch:** `feat/sec-tier-5-voice-e2ee`
**Branch base:** `feat/sec-tier-0-albrecht-hardening`
**Brief:** [`docs/security/spec-briefs/tier-5-voice-e2ee.md`](../../security/spec-briefs/tier-5-voice-e2ee.md)
**Master doc:** [`docs/security/SECURITY_IMPROVEMENTS_MASTER.md`](../../security/SECURITY_IMPROVEMENTS_MASTER.md) §3.5.4 (voice call E2EE state of the art), §3.5.1 (Signal 1:1 DTLS fingerprint), §3.5.2 (Wire MLS+SFrame), §3.7 (Jitsi Meet E2EE reference), §6.4 (Layer 4 Content: voice), §7 Tier 5, §8.2 (wild idea: PRF-keyed SFrame), §9 (mandatory cross-cutting principles)

**Depends on:**
- **Tier 0** (branded `CryptoLabel`, `LABEL_REGISTRY`, `labelToId`/`idToLabel`, AEAD AAD discipline, signed audit log). The two new SFrame labels (§5.1) extend `LABEL_REGISTRY`; SFrame frame AAD uses `labelToId` exactly like other envelope paths. **Hard dependency — Tier 5 cannot ship without Tier 0.**
- **Tier 1** (HPKE via `@hpke/core` + `@hpke/dhkem-x25519` + `@hpke/chacha20poly1305`, non-extractable `CryptoKey` model). Tier 5 uses HPKE to wrap the per-call root secret for each participant device. **Hard dependency** — if Tier 1 has not merged when Tier 5 starts, Tier 5's first commit adds the HPKE dependencies and the collapse into Tier 1's broader migration happens in the merge.
- **Partial Tier 3** (per-device keys). Tier 5 recipients are *devices*, not users. **Soft dependency** — Tier 5 can ship without Tier 3 using the single-recipient-per-user fallback described in §5.10. The fallback limits a user to one device per call; this is documented as a pre-production constraint.

## Problem

Llamenos routes voice calls through one of five providers — Twilio, SignalWire, Vonage, Plivo, or the self-hosted Asterisk SIP bridge — and exposes them to volunteers in the browser via a `WebRTCAdapter` abstraction (`src/client/lib/webrtc/manager.ts`). Every one of those providers terminates DTLS-SRTP on the provider's media-handling middlebox. In the Asterisk topology that is the flagship for self-hosted deployments, the Asterisk channel driver (`res_pjsip`) is a full B2BUA: it decrypts the inbound DTLS-SRTP leg, re-encrypts the outbound leg, and holds the keys on both sides. Audio passes through Asterisk in plaintext during that re-encryption. For cloud providers (Twilio et al.) the equivalent plaintext window lives in the provider's media servers, where subpoenas, nation-state intercepts, or a compromised tenant are all in-scope threats.

This is the **hop-by-hop DTLS-SRTP** problem identified in §3.5.4 of the master doc. It is the same problem that Wire, Jitsi Meet, Cisco Webex, Google Meet, and Discord DAVE have all solved with the same mechanism: a second AEAD layer above DTLS-SRTP, intercepting encoded media frames in the browser before they hit the DTLS transport, keyed independently of the DTLS handshake. That second layer is **SFrame** (`draft-ietf-sframe-enc`, currently at draft 09), and the browser primitive that enables it is **`RTCRtpScriptTransform`** from the W3C WebRTC Encoded Transform specification.

A hotline caller on a GSM phone can never be E2EE — the caller is a plain telephone with no crypto. But every *other* WebRTC-capable endpoint in the Llamenos topology (volunteer-to-volunteer internal calls, supervisor warm-transfer, supervisor listen-in, volunteer conferences, cross-hub escalation, and future caller apps that speak WebRTC) can be. Tier 5 brings all of those paths up to the same E2EE confidentiality level as call notes and messages: the SIP bridge forwards opaque ciphertext frames and cannot reconstruct the audio even with full root access, a valid subpoena, or a seized disk.

**Concrete gaps identified during exploration of the worktree:**

1. **No media-layer encryption above DTLS-SRTP anywhere.** `src/client/lib/webrtc/adapters/sip.ts` wires JsSIP to a `RTCPeerConnection` with default media constraints (`mediaConstraints: { audio: true, video: false }`, `iceServers` from the dev/prod config) and never touches `RTCRtpSender.transform` or `RTCRtpReceiver.transform`. Five other adapters (Twilio, SignalWire, Vonage, Plivo, FreeSWITCH) are in the same state. There is no crypto Web Worker for media frames, no SFrame library pinned in `package.json`, and no key-distribution channel for per-call symmetric keys. Search for `sframe|RTCRtpScriptTransform|insertableStreams` in `src/` yields zero matches.
2. **Asterisk dialplan assumes transcoding.** `sip-bridge/asterisk-config/extensions.conf` dumps every incoming call into `Stasis(llamenos)` which hands control to the ARI bridge for IVR + ring-group routing. The ARI bridge creates a channel-bridge pairing that puts Asterisk in the media path. `sip-bridge/src/endpoint-provisioner.ts` provisions each volunteer's PJSIP endpoint with `allow=opus,ulaw`, meaning Asterisk is free to transcode Opus→G.711 (or vice versa) on any call leg where it thinks it needs to. Transcoding is **fundamentally incompatible with SFrame**: once Asterisk has to touch the Opus packet payload to decode it, the SFrame wrapping gets stripped (the payload is opaque ciphertext from Asterisk's point of view and decode fails). For SFrame calls to work, Asterisk must be configured to **forward RTP payloads without inspection** — a specific combination of `allow`/`disallow` codec restrictions plus dialplan hygiene.
3. **coturn is already configured as a time-limited HMAC relay.** `deploy/ansible/templates/turnserver.conf.j2` uses `use-auth-secret` + `static-auth-secret` which is the standard coturn time-limited credential scheme, and `src/server/telephony/webrtc-tokens.ts` generates `expiry:identity` usernames with HMAC-SHA1 creds. This is good — coturn is a **pure packet forwarder** (it does not terminate DTLS-SRTP, it only relays UDP between peers), so a TURN-relayed 1:1 call between two WebRTC endpoints can in principle be E2EE end-to-end with nothing but DTLS-SRTP and fingerprint verification. No new credential scheme is needed for Tier 5.
4. **JsSIP exposes `peerconnection` event.** Before `newRTCSession` fires, JsSIP's `RTCSession` emits `peerconnection` once the `RTCPeerConnection` instance is constructed. We can hook this event to install an `RTCRtpScriptTransform` on every sender/receiver *before* the SDP exchange, which is the timing contract required by the W3C spec. No monkey-patching is needed.
5. **Nostr relay is already authenticated and hub-key-encrypted.** `src/client/lib/nostr/events.ts` signs every hub event with the user's schnorr key and ships encrypted content. `createHubEvent()` uses `['t', 'llamenos:event']` tagging so the relay cannot distinguish event *types*. Adding a new `type: "call:sframe-key"` inner payload reuses the existing channel with zero new infrastructure. No SIP INFO messages, no sidechannel WebSockets.
6. **Crypto labels are centralized but `LABEL_SFRAME_*` is absent.** `src/shared/crypto-labels.ts` has 42 labels today; none relate to SFrame. Tier 5 adds exactly two: `LABEL_SFRAME_CALL_SECRET` (for HPKE wrap of the per-call 32-byte root secret) and `LABEL_SFRAME_BASE_KEY` (as HKDF info when deriving per-sender SFrame base keys from the call secret). Both are added to `LABEL_REGISTRY` (Tier 0 infrastructure) so the `labelId` envelope field gets them automatically.
7. **Tier 5 has cross-session concurrency with Tier 1 and Tier 3.** Tier 1 will land HPKE (`@hpke/core` + `@hpke/dhkem-x25519` + `@hpke/chacha20poly1305`) and a non-extractable `CryptoKey` model. Tier 3 will land per-device keypairs. Tier 5 consumes both. If Tier 3 has not landed yet (per-device keys not available), Tier 5 ships a single-recipient-per-user fallback using the existing user-scoped identity key, with the limitation documented in §5.10 and a follow-up task to switch recipients to per-device once Tier 3 merges.

Every item above becomes a workstream in this tier.

## Design

The spec is organized as nine workstreams (5.1 through 5.9). They divide along natural seams — the **signaling** work (key distribution, fingerprint binding, Nostr event schemas), the **media-plane** work (SFrame worker, transform hooks, codec negotiation), the **infrastructure** work (Asterisk passthrough config, coturn compatibility, dialplan), and the **cross-cutting** work (UI badges, fallback behavior, test fixtures, documentation). They will be batched into one pull request so the entire voice E2EE stack lands together.

**Guiding principles** (derived from master §9 and the brief):

- **SFrame is a second AEAD layer above DTLS-SRTP, not a replacement.** DTLS-SRTP remains as the transport encryption. SFrame adds content confidentiality the middlebox cannot pierce. Any attempt to "just use SFrame and skip DTLS" is rejected — the browser stack will not permit it and the SFU/B2BUA still needs valid DTLS to forward RTP at all.
- **Per-call random key.** Never derive SFrame keys from the hub key, never reuse across calls, never persist beyond call-end. Cross-call forward secrecy is a non-negotiable property.
- **HPKE-wrapped per participant device.** Reuses the Tier 1 primitive. Labels go through the Tier 0 `LABEL_REGISTRY` so envelope type confusion is structurally impossible.
- **RTP header + codec payload header plaintext.** Asterisk's jitter buffer, NACK, bandwidth estimation, and forwarding logic work unchanged. SSRC, sequence, timestamp, and the Opus TOC byte are cleartext-but-authenticated (AEAD AAD).
- **Opus-only on SFrame-enabled contexts.** Transcoding is opt-out. Any dialplan leg that forces G.711 transcoding becomes a **non-E2EE leg** and the UI shows a clear fallback warning. Silent degradation is banned.
- **Every transform runs in a dedicated Web Worker.** The main thread stays responsive during calls. The SFrame worker is a singleton-per-call; termination happens at call-end.
- **Failure modes are loud.** Fingerprint mismatch → hangup. Key-wrap decrypt failure → hangup. AAD mismatch → drop-frame + telemetry. Key-rotation race → hangup. The UI surfaces every error with a specific cause code.
- **No backward-compatibility shims.** Pre-production gives us latitude to drop v0 formats cleanly. SFrame support is mandatory for WebRTC↔WebRTC calls in Llamenos; the only non-SFrame path is the unavoidable caller-phone-leg on the Asterisk SIP trunk.

### 5.1. New crypto labels and SFrame cipher suite pinning

Two new labels are added to `src/shared/crypto-labels.ts`:

```typescript
/** Per-call 32-byte root secret — HPKE-wrapped per participant device. */
export const LABEL_SFRAME_CALL_SECRET = 'llamenos:sframe-call-secret:v1' as CryptoLabel

/** HKDF info string when deriving a per-sender SFrame base key from the call secret. */
export const LABEL_SFRAME_BASE_KEY = 'llamenos:sframe-base-key:v1' as CryptoLabel
```

Both are appended to `LABEL_REGISTRY` (Tier 0 infrastructure). The `:v1` suffix is deliberate: if a future revision moves to a different KDF or a different AEAD, the new label gets a `:v2` suffix and legacy call events continue to decrypt independently.

**SFrame cipher suite.** The IETF SFrame draft defines five suites (AES_128_CTR_HMAC_SHA256_*, AES_128_GCM_SHA256_*, AES_256_GCM_SHA512_*, and their short-tag variants). Llamenos pins **AES_128_GCM_SHA256_128** — 128-bit key, 128-bit tag, SHA-256 in the HKDF. Rationale:

- **AES-GCM is native WebCrypto.** `crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plaintext)` runs inside the browser's crypto sandbox with hardware acceleration on every mainstream platform.
- **128-bit key is Jitsi's production choice.** Five years of deployment at scale without issue.
- **128-bit tag** (not 80, not 64) — the short-tag variants trade integrity for bitrate savings; audio calls do not need that. Full tag is negligible overhead at Opus frame sizes (20ms × ~20 kbps = ~50 bytes/frame, tag is 25% of that — still fine on any connection that can carry Opus at all).
- **96-bit nonce** — required by AES-GCM, constructed from `SSRC(4) || RTP timestamp(4) || frame counter(4)` which matches Jitsi's JFrame nonce derivation.

A single `SFrameCipherSuite` constant in `src/shared/sframe/cipher-suite.ts` encodes the choice; the SFrame worker reads it to select the AEAD algorithm. Changing the suite requires touching exactly this file plus the worker.

**Key ID width.** SFrame headers include a variable-length Key ID. Llamenos uses a fixed **7-bit Key ID** so it fits in a single header byte (matching SFrame's "compact" header layout): 0 for the initial call key, incremented on each ratchet/rekey event, wrapping at 128 — call duration never approaches 128 ratchets in practice, but if it does the call is rekeyed with a fresh call secret before the wrap. Key IDs are scoped per-call; they do not collide across calls.

### 5.2. SFrame Web Worker (`sframe-worker.ts` + `sframe-worker-client.ts`)

**New file:** `src/client/lib/webrtc/sframe-worker.ts` — runs inside a `DedicatedWorkerGlobalScope`, handles `RTCRtpScriptTransform` transformer events, and performs AES-GCM encrypt/decrypt on each encoded frame.

**New file:** `src/client/lib/webrtc/sframe-worker-client.ts` — main-thread typed facade, mirrors the pattern in `crypto-worker-client.ts`. Exposes `registerCall`, `setSenderKey`, `rotateCallKey`, `releaseCall`, `getMetrics` over postMessage.

#### 5.2.1. Worker protocol

```typescript
// src/shared/schemas/sframe-worker-messages.ts — zod + typed union
export type SFrameWorkerRequest =
  | { type: 'registerCall'; id: string; callId: string }
  | { type: 'setSenderKey'; id: string; callId: string; keyId: number; baseKey: ArrayBuffer; senderId: string }
  | { type: 'setReceiverKey'; id: string; callId: string; keyId: number; baseKey: ArrayBuffer; senderId: string }
  | { type: 'rotateCallKey'; id: string; callId: string; newKeyId: number; newBaseKeys: Record<string /* senderId */, ArrayBuffer> }
  | { type: 'releaseCall'; id: string; callId: string }
  | { type: 'getMetrics'; id: string; callId: string }

export type SFrameWorkerResponse =
  | { type: 'success'; id: string; result?: unknown }
  | { type: 'error'; id: string; error: string; code: SFrameErrorCode }

export type SFrameErrorCode =
  | 'unknown_call'
  | 'unknown_key_id'
  | 'key_zero_length'
  | 'decrypt_failed'
  | 'encrypt_failed'
  | 'aad_mismatch'
  | 'header_parse_failed'
  | 'worker_not_ready'
```

Every request carries an `id` for request/response correlation, same as `crypto-worker-client.ts`. Errors are structured (code + message) so callers can distinguish expected failure modes (decrypt-failed-after-rotation-race) from programmer errors (unknown_call).

#### 5.2.2. Transform event wiring

`RTCRtpScriptTransform` fires an `rtctransform` event on the worker's `self` for every new transform instance (one per sender, one per receiver). The worker routes the event to the registered call based on the `options` passed at `new RTCRtpScriptTransform(worker, options)` construction time:

```typescript
// sframe-worker.ts (abbreviated)
import { SFrameCipherSuite } from '@shared/sframe/cipher-suite'
import { sealFrame, openFrame } from '@shared/sframe/frame-codec'

interface CallState {
  callId: string
  senderKeys: Map<string /* senderId */, { keyId: number; baseKey: CryptoKey; counter: number }>
  receiverKeys: Map<string /* senderId */, Map<number /* keyId */, CryptoKey>>
  metrics: { sealed: number; opened: number; errors: number; lastError?: SFrameErrorCode }
}

const calls = new Map<string, CallState>()

onrtctransform = (event: Event) => {
  // event is an RTCTransformEvent — typed via '@types/dom-webcodecs' augmentations.
  const transformer = (event as RTCTransformEvent).transformer
  const opts = transformer.options as SFrameTransformOptions
  const state = calls.get(opts.callId)
  if (!state) {
    // Fail-closed — a call that isn't registered means a programming error.
    transformer.writable.abort(new Error('unknown_call'))
    return
  }

  const frameStream = new TransformStream<RTCEncodedFrame, RTCEncodedFrame>({
    async transform(frame, controller) {
      if (opts.direction === 'outbound') {
        await transformOutbound(frame, state, opts.senderId, controller)
      } else {
        await transformInbound(frame, state, controller)
      }
    },
  })

  transformer.readable.pipeThrough(frameStream).pipeTo(transformer.writable)
}
```

`transformOutbound` and `transformInbound` call into `@shared/sframe/frame-codec.ts` (see §5.3) which handles the wire format. The worker is **stateless between frames** for a given key — each AES-GCM operation uses its own nonce, no cipher state carries forward.

#### 5.2.3. Main-thread client facade

`sframe-worker-client.ts` follows the same lazy-singleton pattern as `crypto-worker-client.ts`:

```typescript
export class SFrameWorkerClient {
  private worker: Worker
  private pending = new Map<string, PendingRequest>()

  constructor() {
    this.worker = new Worker(new URL('./sframe-worker.ts', import.meta.url), {
      type: 'module',
      name: 'llamenos-sframe',
    })
    this.worker.onmessage = this.handleMessage.bind(this)
    this.worker.onerror = this.handleError.bind(this)
  }

  async registerCall(callId: string): Promise<void> { /* postMessage + await response */ }
  async setSenderKey(callId: string, keyId: number, baseKey: ArrayBuffer, senderId: string): Promise<void> { /* ... */ }
  async setReceiverKey(callId: string, keyId: number, baseKey: ArrayBuffer, senderId: string): Promise<void> { /* ... */ }
  async rotateCallKey(callId: string, newKeyId: number, newBaseKeys: Record<string, ArrayBuffer>): Promise<void> { /* ... */ }
  async releaseCall(callId: string): Promise<void> { /* ... */ }
  async getMetrics(callId: string): Promise<SFrameCallMetrics> { /* ... */ }

  /**
   * Build an RTCRtpScriptTransform that routes frames through this worker.
   * Must be called on the main thread; the returned object is attached to
   * sender.transform / receiver.transform directly.
   */
  buildTransform(options: SFrameTransformOptions): RTCRtpScriptTransform {
    return new RTCRtpScriptTransform(this.worker, options)
  }
}

export const sframeWorker =
  typeof Worker !== 'undefined' && 'RTCRtpScriptTransform' in window
    ? new SFrameWorkerClient()
    : (null as unknown as SFrameWorkerClient)
```

The runtime guard on `RTCRtpScriptTransform` is the **browser support gate** (see §5.8). Browsers that do not support the standard API get `null` and fall back to a non-E2EE path with a mandatory UI warning — they do not silently call a different API.

### 5.3. SFrame wire format and frame codec (`@shared/sframe/frame-codec.ts`)

The SFrame draft specifies two framing styles — header-based (draft spec) and trailer-based (Jitsi JFrame). The brief leaves this open as design question #1. **Decision: adopt the trailer-based layout matching Jitsi JFrame**, rationale below.

#### 5.3.1. Frame layout

```
┌─────────────────────────────────────────────────────────────┐
│ RTP header (cleartext-authenticated as AAD)                 │  ← unchanged, Asterisk sees + authenticates
├─────────────────────────────────────────────────────────────┤
│ Codec payload header (Opus TOC byte, cleartext-auth'd)      │  ← unchanged for Opus
├─────────────────────────────────────────────────────────────┤
│ AES-GCM ciphertext of encoded frame payload                 │  ← Asterisk sees opaque bytes
│                                                              │
│ ...                                                          │
├─────────────────────────────────────────────────────────────┤
│ 16-byte GCM tag                                             │
├─────────────────────────────────────────────────────────────┤
│ 4-byte frame counter (big-endian)                           │  ← trailer
├─────────────────────────────────────────────────────────────┤
│ 1-byte SFrame config: | 1 bit reserved | 7-bit keyId |      │  ← trailer end
└─────────────────────────────────────────────────────────────┘
```

Total trailer overhead = 21 bytes = 16 (tag) + 4 (counter) + 1 (config). RTP header is untouched; Opus TOC byte is preserved.

**Nonce construction** — 96-bit AES-GCM IV:

```
IV[0..4]  = SSRC (big-endian, from RTP header)
IV[4..8]  = RTP timestamp (big-endian, from RTP header)
IV[8..12] = frame counter (big-endian, from trailer)
```

Matches Jitsi JFrame exactly. Uniqueness per key is guaranteed because the counter is per-(call, key, sender) and monotonic; SSRC is unique per-sender for the lifetime of an RTP session; rekey resets the counter but advances the key. A counter overflow (4 billion frames = 80 days at 50 fps) triggers a forced rekey before wrap — defense in depth, never observed in practice.

**Why trailer over header?**

1. **Asterisk/SFU header inspection is read-only.** RTP forwarders read the RTP header, possibly peek at the codec-specific payload header (e.g. Opus TOC for mute detection), and then forward the rest as opaque bytes. A trailer is invisible to them — they neither read nor rewrite it.
2. **Jitsi interop is preserved for a possible future bridge.** If Llamenos ever bridges into a Jitsi meeting (supervisor join via SIP-to-Jitsi gateway), the wire format is already compatible.
3. **Opus TOC remains at a fixed offset.** Some Asterisk versions peek at the Opus TOC for silence suppression; leaving the codec header at byte 0 of the payload keeps that path working.
4. **Counter + keyId at the tail** means the RTP packetizer does not have to fragment the header across frames — trailer bytes always stay together at the end of a single RTP packet.

**AEAD AAD binding** per frame:

```
AAD = concat(
  utf8ToBytes(LABEL_SFRAME_BASE_KEY),  // domain separation (Tier 0)
  [labelToId(LABEL_SFRAME_BASE_KEY)],  // label registry index
  utf8ToBytes(callId),                 // binds to this specific call
  senderIdBytes,                       // 32-byte sender pubkey
  [keyId],                             // binds to this specific key epoch
)
```

A frame encrypted under one call's key cannot be replayed into another call because `callId` is in the AAD; a frame from a compromised former participant cannot be replayed into a new epoch because `keyId` is in the AAD.

#### 5.3.2. `frame-codec.ts` API

```typescript
// src/shared/sframe/frame-codec.ts
export interface SFrameSealInputs {
  plaintext: Uint8Array
  key: CryptoKey           // AES-GCM 128, non-extractable
  callId: string
  senderId: string          // 32-byte hex pubkey
  keyId: number             // 7-bit
  counter: number           // 32-bit, per-(key, sender) monotonic
  ssrc: number
  rtpTimestamp: number
  codecHeaderLength: number // number of leading bytes to leave plaintext (Opus TOC = 1)
}

export async function sealFrame(inputs: SFrameSealInputs, frameData: Uint8Array): Promise<Uint8Array>
export async function openFrame(
  key: CryptoKey,
  frameData: Uint8Array,
  params: { callId: string; senderId: string; keyId: number; ssrc: number; rtpTimestamp: number; codecHeaderLength: number }
): Promise<Uint8Array>

// Parses only the trailer — used by the receiver to look up the right key
// before calling openFrame(). Pure function, no crypto.
export function parseTrailer(frameData: Uint8Array): { keyId: number; counter: number }
```

The module is shared between the SFrame worker and tests. It has zero DOM dependencies and zero Worker dependencies — it is a pure function over `Uint8Array` that the unit tests can exercise directly under `bun:test`.

### 5.4. Per-call key distribution via Nostr + HPKE

**Key hierarchy** (follows the brief's §5.3 proposal, tightened with Tier 0/1 primitives):

1. **Call secret** — 32 random bytes generated by the call initiator via `crypto.getRandomValues`. Never persisted, never leaves the crypto worker.
2. **Per-sender SFrame base key** — derived as `HKDF-SHA256(callSecret, salt=callId, info=LABEL_SFRAME_BASE_KEY || senderId, length=16)`. Each sender gets its own base key; receivers derive the same base key for each peer when they receive the call secret.
3. **AES-GCM key** — `await crypto.subtle.importKey('raw', baseKey, 'AES-GCM', extractable=false, ['encrypt', 'decrypt'])`. Non-extractable: once imported, the raw bytes never re-enter the JS heap.
4. **Per-frame AES-GCM operation** — nonce from SSRC/timestamp/counter, AAD from §5.3.1.

**Distribution flow** for a 2-party call initiated by device `D_A` targeting device `D_B`:

```
D_A                                     Nostr relay                     D_B
 │                                           │                           │
 │ 1. generate 32-byte callSecret            │                           │
 │                                           │                           │
 │ 2. HPKE-seal(callSecret, recipient=       │                           │
 │    D_B.pubkey, info=LABEL_SFRAME_         │                           │
 │    CALL_SECRET, aad=callId)               │                           │
 │                                           │                           │
 │ 3. createHubEvent(kind=20002, content=    │                           │
 │    encryptForHub({                        │                           │
 │      type: "call:sframe-key",             │                           │
 │      callId, initiatorDeviceId: D_A,      │                           │
 │      recipients: [                        │                           │
 │        { deviceId: D_B,                   │                           │
 │          hpkeSealedCallSecret: ... }      │                           │
 │      ],                                   │                           │
 │      keyId: 0,                            │                           │
 │      senderIds: [D_A, D_B],               │                           │
 │      issuedAt: ... }))                    │                           │
 │    ─────────────────────────────────────► │                           │
 │                                           │ ──────────────────────────► │
 │                                           │                           │
 │ 4. derive sframeBaseKey_A = HKDF(...)     │                           │
 │                                           │                           │
 │                                           │ 5. fetch event,           │
 │                                           │    decryptFromHub,        │
 │                                           │    HPKE-open(…)           │
 │                                           │    → callSecret           │
 │                                           │                           │
 │                                           │ 6. derive                 │
 │                                           │    sframeBaseKey_A,       │
 │                                           │    sframeBaseKey_B        │
 │                                           │                           │
 │ 7. SIP INVITE via Asterisk ──────────────►│ ──────────────────────────► │
 │ ◄───────────────────────────────────────  │ ◄─────── 200 OK ────────── │
 │                                           │                           │
 │ ══════════ SFrame-wrapped audio ═════════════════════════════════════► │
 │ ◄════════════ SFrame-wrapped audio ══════════════════════════════════ │
```

**Why HPKE-seal-to-recipient inside an already-hub-encrypted envelope?** Two layers are not redundant:

- **Outer layer (hub-key)** protects against relay operators, hub metadata extraction, and global passive observers. The Nostr relay sees `content: encryptedBlob, tags: [['t', 'llamenos:event']]` — it cannot tell a key-distribution event from a presence event or a call:ring event.
- **Inner layer (HPKE per-device)** protects against a compromised hub member who should not be a call participant. A volunteer who is on-shift and has the hub key but is not selected for this specific call cannot derive the call secret.

Each recipient gets its own HPKE envelope; adding participants is O(N) HPKE-seal operations, which is trivial for the small-N conferences Llamenos cares about (typically 2–5).

**Kind 20002** is a new ephemeral Nostr kind allocated for SFrame key distribution. It joins the existing ephemeral kinds currently defined in `src/shared/nostr-events.ts`:
- `KIND_PRESENCE_UPDATE = 20000`
- `KIND_CALL_SIGNAL = 20001`
- `KIND_SFRAME_KEY = 20002` *(new, this tier)*
- `KIND_DTLS_BINDING = 20003` *(new, this tier)*

The schema is added to `src/shared/schemas/nostr-events.ts`:

```typescript
export const SFrameKeyEventPayloadSchema = z.object({
  type: z.literal('call:sframe-key'),
  callId: z.string().uuid(),
  initiatorDeviceId: z.string().regex(/^[0-9a-f]{64}$/),
  keyId: z.number().int().min(0).max(127),
  recipients: z.array(
    z.object({
      deviceId: z.string().regex(/^[0-9a-f]{64}$/),
      hpkeEnc: z.string().regex(/^[0-9a-f]+$/),        // HPKE encapsulated key, hex
      hpkeCiphertext: z.string().regex(/^[0-9a-f]+$/), // HPKE ciphertext, hex
    })
  ).min(1),
  senderIds: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(32),
  issuedAt: z.string().datetime(),
  reason: z.enum(['initial', 'rotate_join', 'rotate_leave', 'rotate_scheduled']),
})
export type SFrameKeyEvent = z.infer<typeof SFrameKeyEventPayloadSchema>
```

The `reason` discriminator lets receivers handle the three rotation triggers differently (see §5.5). `senderIds` enumerates the devices that will transmit on this call so receivers can pre-derive all per-sender base keys and have them ready before the first frame arrives.

### 5.5. Rotation on join and leave

**On join (new participant added mid-call):**

1. Any existing participant (typically the initiator or the admin who approved the transfer) generates the new call secret by `HKDF-SHA256(currentCallSecret, salt="ratchet", info="join:" + newDeviceId, length=32)`. This is a **one-way ratchet** — the new participant cannot derive the *old* call secret.
2. The rotating participant publishes a new kind-20002 event with `reason: 'rotate_join'`, `keyId: currentKeyId + 1`, `senderIds` including the new device, and HPKE-wrapped `callSecret` for every recipient (including the new one and all existing ones).
3. Existing participants' clients receive the event, derive the new base keys, call `sframeWorker.rotateCallKey(callId, newKeyId, newBaseKeys)`, and the worker starts using the new key for outbound frames. Inbound frames with the old keyId continue to decrypt while the **grace window** is open (see below).

**On leave (participant drops or is kicked):**

1. Any remaining participant generates a completely fresh random call secret (not a ratchet — a ratchet would let the departed participant compute the next key if they kept their device key material). The new secret is `crypto.getRandomValues(new Uint8Array(32))`.
2. The remaining participant publishes kind-20002 with `reason: 'rotate_leave'`, `keyId: currentKeyId + 1`, `senderIds` excluding the departed device, HPKE-wrapped `callSecret` only for the remaining participants.
3. Everyone rotates. Old key is purged from the SFrame worker immediately — the departed participant cannot decrypt frames after the rotation point, and the remaining participants cannot decrypt post-departure frames with the old key either (the worker drops the old key entry).

**Grace window for in-flight frames.** When `rotateCallKey` runs, the worker does **not** immediately evict the old key — RTP is lossy and there may be in-flight frames encrypted under the old key. The worker keeps both keys active for a grace window of **2 seconds** (a generous upper bound on RTP jitter-buffer depth plus network RTT), then drops the old key. Frames received with an older keyId after the grace window are dropped with `SFrameErrorCode.unknown_key_id` and counted in metrics.

**On rotation race:** If `rotateCallKey` is called a second time before the grace window expires (e.g. two rapid leaves), the worker keeps three keys active — the pre-previous, the previous, and the current. A fourth rotation evicts the oldest. This is bounded by the small-N constraint — rapid rotations in a 2–5 party call are rare, and worst-case memory is 3 × 16 = 48 bytes per call.

**Rotation-triggered hangup.** If a rotation event references a `keyId` that is not `currentKeyId + 1` (e.g. `currentKeyId + 2` or `currentKeyId`), the receiving client refuses to apply the rotation and hangs up the call with a `key_rotation_gap` error. This prevents a malicious hub member from injecting out-of-order rotations to confuse key derivation.

### 5.6. DTLS fingerprint binding over Nostr-signed signaling

Phase 1 from the brief. Even with SFrame active, the DTLS-SRTP layer underneath still needs authentication to prevent a middlebox from substituting its own DTLS endpoint and modifying the SFrame header bytes (specifically: flipping `keyId` bits to force decrypt failures, which is a denial-of-service but not a confidentiality break). Tier 5 layers a DTLS fingerprint authentication step on top of SFrame — **defense in depth, not a replacement**.

**Flow:**

1. When `SipWebRTCAdapter.initialize()` finishes creating the `RTCPeerConnection`, the adapter calls `pc.getConfiguration()` to extract the local certificate's SHA-256 fingerprint (already present in the SDP offer/answer).
2. The adapter hashes the fingerprint with the call ID as salt to prevent cross-call replay: `bindingHash = SHA-256(fingerprint || callId)`.
3. The binding hash is published to a kind-20003 Nostr event (`type: "call:dtls-binding"`) signed by the device key. Event schema:

```typescript
export const DtlsBindingEventPayloadSchema = z.object({
  type: z.literal('call:dtls-binding'),
  callId: z.string().uuid(),
  deviceId: z.string().regex(/^[0-9a-f]{64}$/),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),     // SHA-256 hex, no colons
  bindingHash: z.string().regex(/^[0-9a-f]{64}$/),     // SHA-256(fingerprint || callId)
  issuedAt: z.string().datetime(),
})
```

4. Each participant fetches the other participants' kind-20003 events, recomputes `bindingHash` from the advertised fingerprint + callId, and verifies it matches the event's `bindingHash`.
5. Each participant then parses the incoming SDP (INVITE or 200 OK) to extract the `a=fingerprint:SHA-256 XX:YY:...` line, strips colons, lowercases, and compares byte-for-byte against the Nostr-asserted fingerprint.
6. If the SDP fingerprint does not match the Nostr-asserted fingerprint → **hang up immediately** with `dtls_fingerprint_mismatch` error. The UI shows a red-banner error with a copy-paste-able incident code.

**What this defends against:**

- Asterisk terminating DTLS and offering its own fingerprint in the re-INVITE (would be detected: the re-INVITE fingerprint does not match the Nostr-asserted one for the peer).
- A compromised SIP proxy injecting a MITM (same detection).
- A coturn relay replaced by an attacker (coturn does not terminate DTLS, but if it did, the fingerprint check would catch it).

**What this does not defend against:**

- A malicious participant who publishes a fingerprint matching their own DTLS — this is by design (they are a legitimate participant). SFrame AEAD with per-call HPKE-wrapped keys handles the case where a legitimate participant later turns malicious (they cannot decrypt frames sent after they leave).
- A race between fingerprint publication and SDP exchange — mitigated by requiring the fingerprint event to arrive *before* the SDP answer is processed. If the event is not present, the call setup is delayed up to **5 seconds** before hanging up with `dtls_fingerprint_missing`.

For Asterisk-mediated calls where Asterisk is a legitimate B2BUA (the primary topology), the DTLS fingerprint verification *will* fail on the naive config because Asterisk does terminate DTLS. For those calls, **§5.7 documents the explicit fall-back**: DTLS binding is skipped if Asterisk is configured in `bridged-b2bua` mode (set via a new `asteriskMode` field on the provider config). SFrame alone provides the confidentiality guarantee, and the call UI shows a weaker badge ("E2EE (transport relayed via Asterisk)" vs "E2EE (direct peer)").

### 5.7. Asterisk media-plane configuration for SFrame passthrough

Four concrete changes to `sip-bridge/asterisk-config/` and `sip-bridge/src/endpoint-provisioner.ts`:

#### 5.7.1. Force Opus-only on volunteer endpoints

Current `endpoint-provisioner.ts:50-61`:

```typescript
await ari.configureDynamic('res_pjsip', 'endpoint', username, {
  // ...
  disallow: 'all',
  allow: 'opus,ulaw',  // CURRENT — transcoding possible
})
```

Tier 5 change:

```typescript
await ari.configureDynamic('res_pjsip', 'endpoint', username, {
  // ...
  disallow: 'all',
  allow: 'opus',  // TIER 5 — Opus only, no transcoding path

  // SFrame-compatible codec negotiation:
  incoming_offer_codec_prefs: 'pending:prefer:pending:keep:all',
  outgoing_offer_codec_prefs: 'pending:prefer:pending:keep:all',
  incoming_answer_codec_prefs: 'intersect:prefer:pending:keep:all',
  outgoing_answer_codec_prefs: 'intersect:prefer:pending:keep:all',

  // Explicit: forbid transcoding (Asterisk 18+ directive)
  // If the far end does not offer Opus, the call fails at negotiation
  // rather than silently downgrading to G.711.
  codec_prefs_incoming_offer_resolve: 'refuse',
  codec_prefs_outgoing_offer_resolve: 'refuse',
})
```

If a caller's leg needs G.711 (PSTN trunk → Asterisk → volunteer browser), Asterisk will refuse the connection rather than transcode silently. The **volunteer-to-volunteer** path is unaffected — both ends speak Opus, Asterisk forwards the RTP payload without inspection.

For the **caller-to-volunteer** path, a separate dialplan context is used. See §5.7.3.

#### 5.7.2. Dedicated SFrame-passthrough dialplan context

New context in `sip-bridge/asterisk-config/extensions.conf`:

```asterisk
; ----------------------------------------------------------
; SFrame passthrough context — used for volunteer-to-volunteer,
; supervisor listen, warm transfers, and internal conferences.
; Opus-only, no transcoding, no recording at the Asterisk layer.
; ----------------------------------------------------------
[volunteers-sframe]
exten => _X.,1,NoOp(SFrame E2EE call from ${CALLERID(num)})
 same => n,Set(JITTERBUFFER(adaptive)=default)
 same => n,Set(MEDIA_ENCRYPTION=dtls)
 same => n,Stasis(llamenos,sframe)
 same => n,Hangup()
```

Endpoints provisioned via `provisionEndpoint()` are moved from `context: 'volunteers'` to `context: 'volunteers-sframe'`. The `Stasis(llamenos,sframe)` argument tells the sip-bridge ARI handler that the call is in SFrame mode and must not be offered any transcoding, recording, or IVR prompt injection (those would all break SFrame).

The existing `volunteers` context remains in place for backward-compatibility testing — removed entirely in the same commit because this is pre-production.

#### 5.7.3. Caller-to-volunteer path (SFrame not applicable)

Calls from PSTN callers arrive at `[from-trunk]` and go straight into `Stasis(llamenos)` (no sframe argument). The sip-bridge's Stasis handler checks the presence of the `sframe` argument:

```typescript
// sip-bridge/src/index.ts StasisStart handler (pseudocode)
if (args.includes('sframe')) {
  callMode = 'sframe'    // no transcoding, no recording, volunteers-only
} else {
  callMode = 'pstn'      // legacy path — G.711 transcoding allowed, SIP→RTP bridging
}
```

The pstn path continues to transcode G.711↔Opus because the caller is on a telephone. When the volunteer picks up, the server publishes a **kind-20001** Nostr event with inner `type: "call:mode"` content `{ mode: "pstn", reason: "caller_on_pstn_trunk", callId }` (the existing general hub-event kind, reusing the already-authenticated channel rather than allocating a new ephemeral kind for a single sub-type). The volunteer's client knows it should **not** attempt SFrame on this call. The call UI shows the "non-E2EE" badge with the explanation "Caller on a telephone — end-to-end encryption not available for this leg".

This is the only sanctioned non-E2EE code path. It is explicit, not silent.

#### 5.7.4. Recording incompatibility acknowledged

Asterisk's `MixMonitor()` and `Record()` dialplan applications are explicitly **banned** in the `volunteers-sframe` context. Adding them would produce recordings containing opaque SFrame ciphertext, which is worse than useless (it wastes storage and creates a false impression of recorded content). If hub admin recording is needed for SFrame calls, the client-side captures the decrypted audio via the `MediaRecorder` API after the receiver transform runs and uploads an encrypted recording to RustFS — that is a separate spec and out of scope for Tier 5.

### 5.8. Browser compatibility and feature gating

**Target browsers (April 2026):**

| Browser | RTCRtpScriptTransform | Notes |
|---|---|---|
| **Firefox 117+** | ✅ native, standard API | Shipped September 2023. |
| **Safari 15.4+** | ✅ native, standard API | Shipped March 2022 (WebKit was earliest adopter). |
| **Chrome / Edge (October 2025+)** | ✅ native, standard API | Chrome shipped the standard `RTCRtpScriptTransform` in a late-2025 release; the older non-standard `createEncodedStreams` is deprecated and removed from the W3C draft. Tier 5 targets the standard API only. |
| Chrome / Edge ≤ mid-2025 | ⚠️ non-standard `createEncodedStreams` | **Not supported.** These browsers see the "Your browser does not support end-to-end encrypted calls" banner and calls fall back to non-SFrame hop-by-hop encryption. No shim code is written. |
| Mobile Safari 17.4+ | ✅ native | Same code path as desktop Safari. |
| Mobile Chrome 2025+ | ✅ native | Same code path as desktop Chrome. |

**Feature detection** at app boot:

```typescript
// src/client/lib/webrtc/feature-detect.ts
export function isSFrameSupported(): boolean {
  return (
    typeof RTCRtpScriptTransform !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof crypto?.subtle?.importKey === 'function'
  )
}
```

`isSFrameSupported()` is called once at boot and cached in a module-level constant. The WebRTC manager reads it before attempting to register a call with the SFrame worker; if false, it routes the call through a **non-E2EE fallback path** (plain DTLS-SRTP to Asterisk, no SFrame transform) and surfaces a prominent UI warning. The call still completes; the volunteer can choose to cancel or proceed.

**Per-hub policy.** A new hub setting `voiceCallE2eePolicy: 'required' | 'preferred' | 'off'` (stored in hub settings, hub-key-encrypted as usual) gates fallback behavior:

- `required` — browsers without SFrame support cannot join voice calls at all. Incoming calls are auto-rejected with a banner explaining why.
- `preferred` (default) — browsers without SFrame support join with a visible warning and proceed.
- `off` — SFrame is never attempted. Used for debugging; defaults to `preferred` for new hubs.

### 5.9. WebRTCAdapter integration and lifecycle

The SFrame hooks attach inside `src/client/lib/webrtc/adapters/sip.ts` (and a matching pattern for twilio/vonage/plivo). JsSIP gives us a timing contract via the `peerconnection` event, which fires *before* `newRTCSession` for outgoing calls and *at session creation* for incoming calls:

```typescript
// src/client/lib/webrtc/adapters/sip.ts — diff showing SFrame integration

async initialize(token: string): Promise<void> {
  // ... existing JsSIP UA setup ...

  ua.on('newRTCSession', async (...args: unknown[]) => {
    const data = args[0] as {
      originator: string
      session: JsSIPRTCSession & { connection?: RTCPeerConnection }
    }
    if (data.originator !== 'remote') return
    if (this.#session) {
      data.session.terminate({ status_code: 486 })
      return
    }
    const session = data.session
    this.#session = session

    // NEW: subscribe to the peerconnection event BEFORE the session completes.
    session.on('peerconnection', async (...pcArgs: unknown[]) => {
      const pc = (pcArgs[0] as { peerconnection: RTCPeerConnection }).peerconnection

      // Resolve the call identifier and the per-call SFrame key that was
      // distributed via kind-20002 Nostr event BEFORE this callback fires.
      // If the key is not yet known (race condition), wait up to 3 seconds
      // for the event to arrive. If it doesn't, hang up.
      const callId = await this.#resolveCallIdFromSdp(pc)
      const keyState = await this.#awaitSFrameKey(callId, 3000)
      if (!keyState) {
        this.#emit('error', new Error('sframe_key_not_received'))
        pc.close()
        return
      }

      // Install outbound transform on every audio sender.
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind !== 'audio') return
        sender.transform = sframeWorker.buildTransform({
          direction: 'outbound',
          callId,
          senderId: this.#deviceId,
          keyId: keyState.keyId,
        })
      })

      // Install inbound transform on every audio receiver.
      // (Receivers are not yet populated here for an incoming call — we
      // hook `track` instead.)
      pc.addEventListener('track', (ev: RTCTrackEvent) => {
        const receiver = ev.receiver
        if (ev.track.kind !== 'audio') return
        receiver.transform = sframeWorker.buildTransform({
          direction: 'inbound',
          callId,
          keyId: keyState.keyId,
        })
      })

      // Run the DTLS fingerprint check in parallel.
      this.#verifyDtlsFingerprint(pc, callId).catch((err) => {
        this.#emit('error', err)
        pc.close()
      })
    })

    // ... existing session accepted/ended handlers ...
  })
}
```

**Key points:**

- The SFrame transform is installed **before** ICE finishes and before media flows. If installation races media, the unencrypted frames are dropped (the transform is not yet wired) and the media renegotiates. This is the W3C-specified behavior for `RTCRtpScriptTransform`.
- For **outgoing** calls, the flow is the same but the client constructs the call secret and publishes the kind-20002 event **before** `ua.call()`, so by the time `peerconnection` fires the key is already in the worker.
- Receivers are hooked via the `track` event rather than `pc.getReceivers()` because receivers are not yet populated at `peerconnection` time for incoming calls.
- The DTLS fingerprint verification (§5.6) runs in parallel, not blocking call setup. If it fails, it hangs up after the call has started — brief window of audio may have leaked but the SFrame layer was already active, so the leak is opaque ciphertext.

**Twilio/SignalWire adapter.** The Twilio JS Voice SDK holds the `RTCPeerConnection` privately. The SDK exposes an `mediaHandler.version.pc` internal property in recent versions (v2.9+) that lets the adapter reach into the PC. Tier 5 adds a `#withPeerConnection` helper that pulls the PC out and runs the same transform-installation logic. For SDK versions that lock the PC away, the call falls back to non-E2EE with a warning (feature-gated on `isSFrameSupported() && isTwilioPcAccessible()`).

**Vonage/Plivo/FreeSWITCH adapters.** Each adapter grows the same `#installSFrameTransforms(pc, callId)` helper and calls it at the equivalent moment in its lifecycle. The helper is extracted into `src/client/lib/webrtc/sframe-install.ts` as a pure function so all five adapters share it.

### 5.10. Tier 3 dependency mitigation

Tier 3 delivers per-device keys (each device has its own X25519 + Ed25519 keypair). Tier 5's key distribution assumes per-device recipients — "HPKE-seal to each participant *device*". If Tier 3 has not landed when Tier 5 ships, there is one identity key per user and "device" is indistinguishable from "user".

**Fallback:** The Tier 5 code uses a `resolveCallRecipients(hubId, participantUserIds): Promise<Array<{ deviceId: string; pubkey: string }>>` helper in `src/client/lib/webrtc/sframe-recipients.ts`. On Tier 3 it returns one entry per device; pre-Tier-3 it returns one entry per user with `deviceId = userId` and `pubkey = userIdentityPubkey`. The rest of the pipeline is identical.

**Consequence of the fallback:** A user logged into multiple browsers/devices before Tier 3 cannot participate in the same SFrame call from both devices simultaneously — only one will get the media. This is an acceptable pre-production constraint. The fallback is documented in the spec success criteria.

### 5.11. UI/UX changes

- **E2EE badge.** `src/client/components/call/ActiveCallBadge.tsx` (new) — displayed in the active-call overlay. Three states: `e2ee-direct` (SFrame active, DTLS fingerprint verified peer-to-peer), `e2ee-relayed` (SFrame active, Asterisk is a B2BUA so DTLS fingerprint check skipped), `not-e2ee` (caller on PSTN, G.711 transcoding, or browser does not support SFrame). Hover tooltip explains the state in the user's language (i18n keys added to all 22 locale JSONs at `public/locales/*.json` — see §5.11.1 for the full list).
- **Fallback warning banner.** `src/client/components/call/E2eeFallbackBanner.tsx` (new) — shows before the call connects when the hub policy is `preferred` and the browser/leg cannot do SFrame. Two-button modal: "Call without E2EE" / "Cancel call". The choice is remembered in per-session state, not persisted across tabs.
- **Admin setting.** `src/client/routes/admin/settings/voice-e2ee.tsx` (new) — hub admins see a single radio group `voiceCallE2eePolicy: required | preferred | off`. Default `preferred`. Persisted via the existing hub-settings API.
- **Incident code on failure.** `CryptoLabelMismatchError`, `sframe_key_not_received`, `dtls_fingerprint_mismatch`, `key_rotation_gap`, `aad_mismatch` all surface as toasts with a short incident code users can paste to support. Toast testids: `toast-sframe-error`, with a `data-incident-code` attribute for E2E tests.

**No microphone prompt changes.** SFrame does not affect `navigator.mediaDevices.getUserMedia` — the mic prompt appears the same way as today. No additional permissions required.

**Accessibility.** The E2EE badge has `aria-label` set to the full state (e.g. "End-to-end encrypted call, direct peer-to-peer connection verified") rather than just the short label. The fallback warning banner is focus-trapped and dismissible with Escape.

#### 5.11.1. Localization — 22 locales, multi-session translation workstream

**Correction of earlier drift:** previous versions of this spec and `CLAUDE.md` referenced "13 locales" and `src/client/locales/*.json`. The real locale fleet is **22 locales** living at `public/locales/*.json`:

```
am, ar, de, en, es, fa, fr, hi, ht, ko, ku, mix, my, pt, quc, ru, so, tl, tr, uk, vi, zh
```

(Amharic, Arabic, German, English, Spanish, Farsi, French, Hindi, Haitian Creole, Korean, Kurdish, Mixtec, Burmese, Portuguese, K'iche', Russian, Somali, Tagalog, Turkish, Ukrainian, Vietnamese, Chinese.)

**Translation scope** for Tier 5 is 12 keys × 22 locales = **264 individual translations**. Untranslated strings cause the CI i18n check to fail.

**Multi-session workstream structure.** Tier 5 implementation is divided into two sessions for quality purposes — context-window fatigue across 22 locales in one session degrades translation quality and invites mistranslations that volunteers speaking underrepresented languages will notice.

- **Tier 5 session A — core voice E2EE (this session):** lands all code changes, the English canonical strings for the 12 new i18n keys, and a placeholder entry in each of the other 21 locale files that falls through to English at runtime (with the existing i18n library's fallback). CI i18n check is temporarily relaxed to allow placeholder values for the 12 new keys only; a biome/lint rule catches any accidental additional placeholders.
- **Tier 5 session B — translation sweep (follow-up session):** a dedicated session that translates the 12 keys into all 21 non-English locales. The session uses the existing locale files as style references (to match formality register and existing terminology), consults native speakers where Llamenos has them available for review, and fails the CI i18n check loudly to gate merge. Recommended approach: one locale at a time with a fresh conversation context per batch of 4–6 locales to avoid cross-language bleed.

**Deliverables per session:**

- Session A ships: all code, the canonical English strings, a placeholder-only entry in each non-English locale, a relaxed CI i18n check gated on a feature flag (`ALLOW_TIER_5_I18N_PLACEHOLDERS=true` during session A only), and a `docs/i18n/TIER_5_TRANSLATION_NOTES.md` document that lists the 12 keys with context (where they appear in UI, tone, constraints like max length for a toast), intended for whoever authors session B (human or LLM).
- Session B ships: full translations, the relaxed CI flag removed, updated `docs/i18n/TIER_5_TRANSLATION_NOTES.md` marking translation status per locale, and a final sign-off commit.

**Why this split:** quality over throughput. A single 3000-line conversation doing 22 locales would produce a "close enough" translation for the less-common languages that a native speaker would flag. Two sessions with a clean boundary allow the translation session to focus on cultural and linguistic accuracy rather than alongside implementation work.

### 5.12. Test fixtures — simulated SIP bridge and simulated caller

Tier 5 introduces two new test fixtures so the entire SFrame pipeline can be exercised without a real Asterisk container:

#### 5.12.1. Simulated SIP bridge (`tests/fixtures/sim-sip-bridge.ts`)

A pure-TypeScript class that implements just enough of the ARI + SIP semantics for the sip-bridge integration tests:

```typescript
export class SimSipBridge {
  async provisionEndpoint(pubkey: string): Promise<{ username: string; password: string }>
  async deprovisionEndpoint(pubkey: string): Promise<void>

  /**
   * Inject a simulated incoming call. The "remote leg" is either another
   * SimSipBridge instance (for bridge-to-bridge tests) or a SimCaller
   * (for caller-to-volunteer tests).
   */
  async inject(params: {
    callId: string
    callerNumber: string
    remote: 'sim-caller' | SimSipBridge
    mode: 'sframe' | 'pstn'
  }): Promise<void>

  /**
   * Forward RTP bytes from one side to the other — this is the B2BUA
   * middlebox. The sim-bridge records every byte it sees so tests can
   * assert "the bridge never saw plaintext".
   */
  bridgePacket(from: 'caller' | 'volunteer', bytes: Uint8Array): Uint8Array | null
  getCapturedPackets(): Array<{ direction: 'a-to-b' | 'b-to-a'; bytes: Uint8Array; time: number }>
}
```

The bridge does not speak actual SIP or RTP — it speaks the abstract `WebRTCAdapter` event API that the client-side code consumes. Unit tests wire up `SimSipBridge` in place of the real adapter via dependency injection, run through a full call setup, and assert (a) the SFrame transforms were installed, (b) every packet `SimSipBridge.bridgePacket` saw had a valid GCM trailer, and (c) no captured packet contained Opus audio plaintext.

#### 5.12.2. Simulated caller (`tests/fixtures/sim-caller.ts`)

Represents a second WebRTC endpoint for browser-to-browser call tests:

```typescript
export class SimCaller {
  constructor(deviceId: string, hpkeKeyPair: CryptoKeyPair)

  /** Subscribe to Nostr to receive the kind-20002 key event. */
  async onSFrameKey(callback: (key: SFrameCallKey) => void): Promise<void>

  /** Produce a fake Opus frame and encrypt it with SFrame, returning the wire bytes. */
  async produceFrame(plaintext: Uint8Array, keyId: number, counter: number): Promise<Uint8Array>

  /** Verify an inbound SFrame wire frame decrypts to the expected plaintext. */
  async consumeFrame(wireBytes: Uint8Array, expectedPlaintext: Uint8Array): Promise<boolean>
}
```

SimCaller exercises the same `@shared/sframe/frame-codec.ts` module that production code uses. Tests running against a SimCaller prove SFrame round-trips work without needing a full WebRTC stack.

#### 5.12.3. Adversarial fixtures

`tests/fixtures/sim-compromised-bridge.ts` — a SimSipBridge subclass that performs specific attacks:

- `modifyFrame(position, byte)` — flip a byte in the ciphertext payload; assert decrypt fails.
- `modifyTrailer(field, value)` — flip the keyId byte; assert decrypt fails (wrong key lookup OR AAD mismatch).
- `modifyRtpHeader(field, value)` — change the SSRC or timestamp; assert decrypt fails (AAD mismatch via nonce derivation).
- `dropRandom(rate)` — drop a percentage of packets; assert the call survives but metrics record drops.
- `replay(position)` — replay an old frame; assert it is dropped (GCM tag invalid because counter is in AAD for nonce).

Each adversarial function has a corresponding test case that asserts the defense works.

## Resolved open questions (from the brief)

Decisions made during self-review brainstorming. Captured here for traceability.

1. **SFrame format — header or trailer?** **Trailer (Jitsi JFrame).** See §5.3 rationale: preserves codec headers at fixed offsets, invisible to RTP middleboxes, compatible with a future Jitsi bridge. Header overhead is 21 bytes at the end of each RTP packet.
2. **AES-GCM-128 vs 256 vs CTR+HMAC?** **AES-GCM-128.** Native WebCrypto, hardware-accelerated, Jitsi's production choice. 128-bit tag (not short-tag variants). See §5.1.
3. **G.711 fallback.** **Opus-only on SFrame contexts. No G.711 transcoding.** Caller-to-volunteer PSTN path is explicitly non-E2EE with a UI warning. §5.7.3. Documented in success criteria.
4. **SAS verification for 1:1 calls.** **Deferred to Tier 6.** Not included in Tier 5 — Tier 5's fingerprint-binding-via-Nostr (§5.6) provides transport authentication, and the short-authentication-string UI adds complexity (SAS comparison ceremonies) that is more valuable post-MLS. Tier 5 does include the underlying DTLS fingerprint capture so Tier 6 can consume it.
5. **Recording compatibility.** **Asterisk-side recording banned in the `volunteers-sframe` context.** Client-side recording-then-upload is a separate spec; Tier 5 documents the ban. §5.7.4.
6. **Key distribution channel.** **Nostr events (hub-key-encrypted, HPKE-wrapped-per-device inside).** No SIP INFO, no custom WebSocket. §5.4. Reuses the authenticated channel we already have.
7. **Call metadata retention.** Asterisk logs call start/stop/duration/participants unchanged. Encrypted audit log (Tier 0) captures `{ callId, deviceIds, keyRotations, e2eeState }` as a typed audit entry for hub admins. No plaintext content ever logged. Content retention period is governed by the existing GDPR data-lifetime setting.
8. **Browser compatibility.** **Standard `RTCRtpScriptTransform` only.** No shim for Chrome's legacy `createEncodedStreams`. Chrome shipped the standard in late 2025, so by April 2026 all mainstream browsers support it. Older browsers get a clear "not supported" banner. §5.8.
9. **Codec negotiation UX.** **Calls that need G.711 transcoding are rejected by Asterisk config (§5.7.1) rather than silently downgraded.** The caller-to-volunteer PSTN path is a separate dialplan context where G.711 is accepted and the UI warns "not E2EE". §5.7.3.
10. **Jitsi interop.** **JFrame trailer format aligns with Jitsi.** No explicit interop code ships in Tier 5, but the wire format is compatible with a future Jitsi bridge.

**New questions surfaced during self-review:**

11. **Per-call crypto worker vs shared.** **Shared singleton.** A single `sframe-worker` instance handles multiple simultaneous calls via `callId`-keyed state. Running one worker per call would waste postMessage latency and consume more memory. Bounded by the hub's maximum simultaneous call count (typically 3–5).
12. **Rotation race handling.** **Three-key grace window.** The worker keeps the previous two keys for 2 seconds after rotation to absorb in-flight frames; fourth rotation evicts the oldest. §5.5.
13. **Tier 3 dependency mitigation.** **Single-recipient-per-user fallback.** §5.10 — Tier 5 can ship without Tier 3 but the fallback limits a user to one device per call. Documented as an explicit pre-production constraint.
14. **Label versioning.** **`:v1` suffix on both new labels.** Future revisions (e.g. post-quantum SFrame keys via Tier 6) get `:v2` without breaking existing events. §5.1.
15. **DTLS fingerprint on Asterisk-mediated calls.** **Skipped in `bridged-b2bua` mode.** SFrame alone provides the confidentiality guarantee; the fingerprint check is optional additional transport auth that only makes sense for direct-peer or TURN-relayed topologies. §5.6 and §5.11's `e2ee-relayed` badge state.

## Testing

**Guiding principle:** every workstream lands with unit + API E2E + UI E2E coverage proportional to its blast radius. No workstream ships without adversarial test cases that assert the *negative* path (wrong key rejected, tampered frame rejected, forged fingerprint rejected, rotation race handled, codec mismatch refused).

### New unit tests

- `src/shared/sframe/frame-codec.test.ts`
  - `sealFrame`/`openFrame` round-trip with matching key, AAD, and counter succeeds
  - `openFrame` with tampered ciphertext byte throws `aad_mismatch`
  - `openFrame` with tampered RTP timestamp throws `aad_mismatch` (nonce derivation fails)
  - `openFrame` with tampered SSRC throws `aad_mismatch`
  - `openFrame` with tampered keyId byte throws (wrong key lookup, not AAD)
  - `openFrame` with swapped callId AAD throws
  - `openFrame` with swapped senderId AAD throws
  - `openFrame` after `openFrame` of the same counter (replay) throws — counter must be tracked by the caller
  - `parseTrailer` extracts keyId and counter from a well-formed frame
  - `parseTrailer` rejects a frame shorter than 21 bytes (trailer size)
  - Nonce construction matches Jitsi's reference vector
- `src/shared/sframe/cipher-suite.test.ts`
  - Pinned suite constant matches `AES_128_GCM_SHA256_128`
  - `deriveBaseKey(callSecret, callId, senderId)` is deterministic
  - Different `senderId` values yield different base keys
  - Different `callId` values yield different base keys
- `src/client/lib/webrtc/sframe-worker-client.test.ts` (bun:test with a mocked Worker)
  - `registerCall` posts a `registerCall` message with a generated id
  - `setSenderKey` posts the key to the worker
  - `rotateCallKey` handles multi-recipient key maps
  - `releaseCall` clears the worker state
  - `buildTransform` returns an `RTCRtpScriptTransform` instance (mocked)
  - Errors from the worker are decoded to `SFrameWorkerError` with code
- `src/client/lib/webrtc/sframe-worker.test.ts` (bun:test in a simulated worker)
  - Transform event wires up readable/writable streams
  - Outbound frame: plaintext in → sealed wire bytes out with correct trailer
  - Inbound frame: sealed bytes in → plaintext out when key is registered
  - Inbound frame with unknown keyId drops frame + increments error metric
  - Rotation keeps old key for 2 seconds then evicts
  - Fourth rotation evicts oldest key
- `src/client/lib/webrtc/sframe-install.test.ts`
  - `installSFrameTransforms(pc, callId, keyState)` installs outbound transform on every audio sender
  - Install skips video tracks (future-proof)
  - Install subscribes to `track` event for inbound receivers
  - Install fails loudly if `sframeWorker` is null (unsupported browser)
- `src/client/lib/webrtc/sframe-recipients.test.ts`
  - Pre-Tier-3 path: returns one recipient per user
  - Post-Tier-3 path: returns N recipients per user with multiple devices
  - Empty recipients array throws
- `src/client/lib/webrtc/sframe-key-distribution.test.ts`
  - `publishSFrameKey(callId, recipients)` HPKE-seals the secret once per recipient
  - HPKE seals use `LABEL_SFRAME_CALL_SECRET` as info
  - Published event shape matches `SFrameKeyEventPayloadSchema`
  - `consumeSFrameKey(event)` HPKE-opens for the local device only
  - Consume rejects events with unknown local device ID
  - Consume rejects events with malformed `hpkeEnc`/`hpkeCiphertext` hex
- `src/client/lib/webrtc/sframe-rotation.test.ts`
  - `ratchetOnJoin(currentSecret, newDeviceId)` produces a new secret deterministically
  - `freshSecretOnLeave()` returns crypto.getRandomValues output (entropy asserted via bit-set test)
  - Rotation with `keyId` gap rejects
- `src/client/lib/webrtc/feature-detect.test.ts`
  - Returns false when `RTCRtpScriptTransform` is undefined
  - Returns false when `Worker` is undefined
  - Returns true when both plus `crypto.subtle.importKey` exist
- `src/shared/schemas/nostr-events.test.ts`
  - `SFrameKeyEventPayloadSchema` accepts a valid payload
  - Rejects `keyId > 127`
  - Rejects empty `recipients` array
  - Rejects malformed hex fields
  - `DtlsBindingEventPayloadSchema` accepts and rejects analogously

### New API E2E tests

- `tests/api/sframe-key-event.spec.ts`
  - Authenticated admin publishes a kind-20002 event → server accepts and relays
  - Second participant subscribes → receives event → zod-validates the payload
  - Unauthenticated publish is rejected
  - Malformed payload is rejected at the schema layer
- `tests/api/dtls-fingerprint-event.spec.ts`
  - Publish kind-20003 → recipient verifies `bindingHash == SHA-256(fingerprint || callId)`
  - Tampered `bindingHash` → verification fails
  - Tampered `fingerprint` → verification fails
- `tests/api/voice-e2ee-policy.spec.ts`
  - Admin sets `voiceCallE2eePolicy: 'required'` → setting persists + emits hub-settings-updated event
  - Non-admin cannot set the policy → 403
  - Invalid policy value → 400
- `tests/api/sframe-call-mode.spec.ts`
  - PSTN caller call → kind-20001 event with inner `type: "call:mode"` dispatched with `mode: 'pstn'`
  - Volunteer-to-volunteer call → no `call:mode` event (SFrame is the default)
  - sip-bridge respects `sframe` Stasis argument

### New API E2E tests (bridge simulation)

- `tests/api/sim-sip-bridge.spec.ts`
  - SimSipBridge passes a complete SFrame-encoded RTP stream without modification
  - `getCapturedPackets()` shows all trailers present and valid
  - Assert no captured packet's payload bytes match the known plaintext (checking that encryption happened)
  - Adversarial: tamper with one byte → next decrypt fails
  - Adversarial: drop 5% of packets → call survives, drop count reported
  - Adversarial: replay frame → decrypt fails

### New UI E2E tests

- `tests/ui/voice-e2ee-badge.spec.ts`
  - Set up two volunteer browsers in the same hub via `bun run dev:docker`
  - Volunteer A calls Volunteer B
  - Assert `data-testid="call-e2ee-badge"` is visible
  - Assert `data-badge-state` is `e2ee-direct` (or `e2ee-relayed` if running against Asterisk)
  - End call → badge disappears
- `tests/ui/voice-e2ee-rotation.spec.ts`
  - Three volunteers, two join, one joins mid-call
  - Assert all three can hear each other after the join (use test audio beep detection)
  - One volunteer leaves → remaining two still have audio
  - Assert departed volunteer's browser cannot decrypt the post-departure frames (use a Playwright evaluate + metrics peek on the sframe worker)
- `tests/ui/voice-e2ee-fallback.spec.ts`
  - Mock `RTCRtpScriptTransform` to be undefined
  - Attempt call → fallback banner appears with testid `banner-e2ee-fallback`
  - Admin has set policy `required` → call is rejected, banner shows `policy-required`
  - Admin has set policy `preferred` → banner has "Continue without E2EE" button → click → call proceeds
- `tests/ui/voice-e2ee-dtls-mismatch.spec.ts`
  - Use Playwright route intercept to rewrite the DTLS fingerprint in the SDP answer
  - Call setup proceeds → fingerprint check detects mismatch → call hangs up
  - Toast `toast-sframe-error` appears with `data-incident-code="dtls_fingerprint_mismatch"`
- `tests/ui/voice-e2ee-admin-setting.spec.ts`
  - Admin navigates to `/admin/settings/voice-e2ee`
  - Assert radio group with three options
  - Change from `preferred` to `required` → save → reload page → assertion persists
- `tests/ui/voice-e2ee-mic-prompt.spec.ts`
  - Assert `getUserMedia` prompt still fires exactly once at call start
  - Assert prompt dismissal does not crash the SFrame worker
- `tests/ui/voice-e2ee-csp.spec.ts` *(cross-cutting — depends on Tier 0 CSP)*
  - Assert the SFrame worker URL is allowed by the current CSP `worker-src` directive
  - No CSP violation reports for SFrame worker construction

### Existing test suites — regression gate

All existing tests must continue to pass:

- `bun run typecheck` — clean; new `SFrameTransformOptions`, `SFrameWorkerRequest`, `SFrameCallKey`, etc. types type-check cleanly
- `bun run lint` — clean
- `bun run build` — clean; the SFrame worker module is a separate Rollup chunk (Vite will detect it from the `new Worker(new URL('./sframe-worker.ts', ...))` idiom)
- `bun run test:unit` — all existing + new unit tests pass
- `bunx playwright test tests/api` — all existing + new API tests pass
- `bunx playwright test tests/ui` — all existing + new UI tests pass
- `bun run test:unit tests/ui/sip-browser-calling.spec.ts` — still passes; SIP registration smoke test is unchanged

### Adversarial test design notes

The unit tests intentionally construct attack inputs:

- **Tampered ciphertext.** Flip a byte in the middle of the sealed payload; assert `openFrame` throws `aad_mismatch`. AAD is the RTP header + trailer so a single bit flip triggers the GCM tag check.
- **Tampered trailer.** Flip the keyId byte; assert decrypt fails (`unknown_key_id` if the flipped value doesn't correspond to a registered key, `aad_mismatch` if it does — both are failure).
- **Cross-call substitution.** Take a valid sealed frame from callA, replay it into callB; assert decrypt fails because `callId` is in the AAD.
- **Cross-sender substitution.** Same as cross-call but with a different senderId; fails for the same reason.
- **Replay.** Sealing frame N and then feeding it to `openFrame` twice: the first succeeds, the second fails because `counter` is derived from the trailer, not tracked internally — callers must pass a monotonic counter. The replay protection is explicit in the caller contract (the receiver keeps a per-(senderId, keyId) counter and rejects non-monotonic frames).
- **Rotation race.** Post two `rotate_leave` events in quick succession with a 0.5-second gap; assert both rotations apply and both old keys are retained for 2 seconds.
- **Key gap.** Post a rotation with `keyId: currentKeyId + 2`; assert the client refuses and hangs up.
- **Fingerprint mismatch.** Use Playwright route intercept to modify the SDP answer's `a=fingerprint:` line; assert hangup with the expected incident code.
- **Feature missing.** Stub `RTCRtpScriptTransform` to undefined; assert `isSFrameSupported()` returns false, the fallback banner appears, and policy enforcement is honored.

## Migration

**Database.** No new migrations in Tier 5. The encrypted audit log (Tier 0) already has an extensible `payload` JSONB column; new audit entry types `call_e2ee_state_change` and `call_sframe_key_rotation` are added to the discriminated union in `src/shared/schemas/audit-entries.ts`. No SQL changes.

**Nostr event schemas.** Two new kinds (`KIND_SFRAME_KEY = 20002` for SFrame key distribution, `KIND_DTLS_BINDING = 20003` for DTLS fingerprint binding) and one new sub-type on kind 20001 (`type: "call:mode"`). These are new; no migration needed — old events of these kinds cannot exist.

**Asterisk config.** `sip-bridge/asterisk-config/extensions.conf` gets the new `volunteers-sframe` context in the same commit as the endpoint-provisioner change that moves new endpoints to that context. Pre-production dev DBs are reset (`bun run dev:docker:down && bun run dev:docker`). Deployment is one Ansible playbook run to push the new config and restart Asterisk.

**coturn config.** No changes. coturn continues to use time-limited HMAC credentials. §5.6 documents this explicitly.

**Env vars.** No new env vars. The SFrame hub policy is stored in hub settings (already encrypted). Per-call keys are ephemeral, derived from `crypto.getRandomValues` at call start.

**Browser support gate.** On first load, a browser without SFrame support sees the policy-based banner. No code is downloaded or executed for SFrame beyond the feature-detect module. Bundle size impact on unsupported browsers: < 2KB (the feature-detect + banner component).

**Backward compatibility.** None. Pre-production. Every WebRTC call after this tier merges that does not fall into the caller-PSTN path must use SFrame. Any code path that would produce an "SFrame optional" silent downgrade is banned — deferred code is explicit non-SFrame (§5.7.3) with a UI warning.

**Package additions.** `package.json` gains two dependencies in the same commit (Tier 1 will land them first if Tier 1 merges before Tier 5):

```json
"@hpke/core": "^1.5.0",
"@hpke/dhkem-x25519": "^1.5.0",
"@hpke/chacha20poly1305": "^1.5.0"
```

Tier 5 treats these as present. If Tier 1 has not merged, Tier 5 adds them in its own PR with an explicit note that the integration will be collapsed into Tier 1's HPKE migration when Tier 1 lands.

**Deployment rollout.** Ansible playbook applies the new Asterisk dialplan and restarts Asterisk. Browsers pick up the new client code on next page load (service worker update + reload prompt). No server-side restart is required beyond Asterisk.

## Out of scope

Explicitly deferred. Tracked in the master doc and/or future tier specs.

- **MLS-keyed SFrame** (Tier 6). SFrame base key derived from MLS `exporter_secret` for continuous post-compromise security. Tier 5 ships with HPKE-wrapped call secrets; Tier 6 replaces the HPKE step with an MLS exporter.
- **Browser-as-renderer mode** (Tier 4). Highest-threat users whose browser holds no long-term identity. Tier 5's device recipients become MLS-tree members in that model.
- **Caller-app E2EE.** A hotline caller on a GSM phone has no crypto. No tier can change that. When Llamenos ships a caller app (future project), that app will use the same SFrame stack.
- **Video E2EE.** Llamenos is voice-only for MVP. The SFrame frame-codec is written to be codec-agnostic (the `codecHeaderLength` parameter handles VP8's 3/10-byte header the same way it handles Opus's 1 byte) so adding video is straightforward later.
- **Client-side call recording.** Recording with client-side re-encryption and upload to RustFS is a separate spec. Tier 5 documents that Asterisk-side recording is banned on `volunteers-sframe` contexts.
- **SAS verification ceremony.** Short-authentication-string UI for 1:1 calls is deferred to Tier 6 (post-MLS). The underlying DTLS fingerprint capture ships in Tier 5 so Tier 6 can consume it without changes.
- **Post-quantum SFrame keys.** Kyber-hybridized HPKE for SFrame key wrap is tracked in Tier 6 / post-quantum tier. Tier 5's label is `:v1`; the PQ version gets `:v2` without breaking anything.
- **Jitsi interop bridge.** Tier 5's wire format is JFrame-compatible but no bridge code ships. A future spec can add a SIP-to-Jitsi gateway that translates.
- **Voicemail E2EE.** Voicemail is an asynchronous storage path and has its own encryption (LABEL_VOICEMAIL_WRAP). SFrame is only a real-time RTP concept. Voicemail is out of scope for Tier 5.
- **WebAuthn PRF keying (master §8.2 wild idea).** Deriving the SFrame call secret directly from a passkey PRF salted by the call ID is a theoretically elegant pattern but requires Tier 2 (WebAuthn PRF as primary KEK). Deferred to a future tier; Tier 5 uses fresh `crypto.getRandomValues` + HPKE wrap.

## Success criteria

The spec is complete when the implementation of the accompanying plan achieves all of the following:

1. **Volunteer-to-volunteer call is E2EE.** Two Playwright-controlled browsers in the same hub, using the Asterisk provider, place a call. The sim-sip-bridge records the RTP byte stream. No captured packet's payload bytes match the known Opus frame plaintext. SFrame trailers parse correctly and match the per-frame counter.
2. **Simulated B2BUA tampering is detected.** An adversarial `SimCompromisedBridge` flips ciphertext bytes; the receiving browser's SFrame worker reports `aad_mismatch` and the frames are dropped. The call's metrics (`getMetrics(callId)`) show the drop count.
3. **Simulated DTLS fingerprint MITM is detected.** A Playwright route intercept rewrites the SDP answer's `a=fingerprint:` line; the browser hangs up with `dtls_fingerprint_mismatch`.
4. **Join/leave key rotation works.** A three-volunteer call with one joining mid-call works. The new joiner can hear the existing participants and vice versa. One leaves; the remaining two still hear each other. The departed browser, inspected via worker metrics, shows it no longer has the post-departure key.
5. **E2EE badge accurate.** The badge shows `e2ee-direct` for direct-peer 1:1 browser calls and `e2ee-relayed` for Asterisk-mediated calls. The badge shows `not-e2ee` for the caller-PSTN path with the correct explanation.
6. **Fallback banner respects hub policy.** `required` → unsupported browsers auto-reject; `preferred` → warning banner with "Continue without E2EE"; `off` → no SFrame attempted.
7. **Codec enforcement works.** A call from a client that does not offer Opus is refused by Asterisk (negotiation failure) rather than silently downgraded.
8. **Caller-PSTN path remains functional.** A simulated PSTN caller reaching a volunteer's browser works via G.711 transcoding. The UI shows the non-E2EE badge. The volunteer can still answer, take notes, and hang up.
9. **No increase in call setup latency beyond 200ms.** Measured in `tests/ui/voice-e2ee-setup-latency.spec.ts` by timestamping the moment of `connect` click vs. the moment of first media frame. Baseline is the pre-Tier-5 call flow on the same hardware.
10. **No CSP violations.** The SFrame worker loads under Tier 0's `worker-src 'self' blob:` directive; the `/api/csp-report` endpoint receives zero violations during a full call setup.
11. **All existing tests pass.** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit`, `bunx playwright test tests/api`, `bunx playwright test tests/ui` all green.
12. **Browser compatibility matrix documented.** `docs/security/VOICE_E2EE_BROWSER_MATRIX.md` enumerates supported browsers, the fallback behavior for unsupported ones, and the policy interaction. UI warning copy is reviewed against the matrix for each locale.
13. **No raw string crypto literals.** `LABEL_SFRAME_CALL_SECRET` and `LABEL_SFRAME_BASE_KEY` are in `LABEL_REGISTRY`; the Tier 0 CI grep check continues to enforce that no raw `'llamenos:sframe-*'` literals appear outside `crypto-labels.ts`.
14. **Documentation complete.** `docs/security/VOICE_E2EE.md` (new) — user-facing explanation of what the badge means, when E2EE is active, and why the caller-PSTN path cannot be E2EE. `docs/epics/epic-sframe-voice-e2ee.md` (new, or appended to epic 75) — design reference and architecture summary linking back to this spec.
15. **Hub policy i18n.** All 22 locales in `public/locales/*.json` (see §5.11.1 for the list) have translations for: `voice.e2ee.badge.direct`, `voice.e2ee.badge.relayed`, `voice.e2ee.badge.none`, `voice.e2ee.fallback.title`, `voice.e2ee.fallback.body`, `voice.e2ee.fallback.continue`, `voice.e2ee.fallback.cancel`, `voice.e2ee.error.dtls_fingerprint_mismatch`, `voice.e2ee.error.sframe_key_not_received`, `voice.e2ee.policy.required`, `voice.e2ee.policy.preferred`, `voice.e2ee.policy.off`. Untranslated strings fail the CI i18n check. Translation sweep is a separate session per §5.11.1.
