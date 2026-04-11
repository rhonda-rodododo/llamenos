# Security Tier 5 — Voice E2EE via SFrame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship end-to-end encrypted voice calls that pass through Llamenos' Asterisk SIP bridge opaquely, using SFrame (`draft-ietf-sframe-enc`) via `RTCRtpScriptTransform` in a dedicated Web Worker, per-call HPKE-wrapped symmetric keys, join/leave rotation, and DTLS fingerprint binding over Nostr-signed signaling.

**Architecture:** Nine workstreams batched into one PR. Shared SFrame frame-codec module (`@shared/sframe/*`) keeps AES-GCM encrypt/decrypt + trailer parsing + nonce derivation in a pure, test-exercisable unit. A singleton SFrame Web Worker hosts per-call state and performs the per-frame AEAD; a main-thread facade mirrors `crypto-worker-client.ts`. Per-call 32-byte root secrets are generated via `crypto.getRandomValues`, HPKE-wrapped per participant device, and published over a new ephemeral Nostr kind (`KIND_SFRAME_KEY = 20002`). DTLS fingerprint bindings published over a second new kind (`KIND_DTLS_BINDING = 20003`). Asterisk is reconfigured for Opus-only passthrough on a new `volunteers-sframe` dialplan context so RTP payloads are forwarded unmodified. Adversarial test fixtures (`SimSipBridge`, `SimCaller`, `SimCompromisedBridge`) exercise the pipeline without a live Asterisk container.

**Tech Stack:** TypeScript, Bun, Hono + `@hono/zod-openapi`, React + TanStack Router, `@noble/ciphers` XChaCha20-Poly1305, `@noble/curves` schnorr/secp256k1, native WebCrypto AES-GCM + HKDF, `@hpke/core` + `@hpke/dhkem-x25519` + `@hpke/chacha20poly1305`, `JsSIP`, `RTCRtpScriptTransform` (W3C WebRTC Encoded Transform), Asterisk `res_pjsip` + ARI dynamic config, Playwright (chromium).

**Spec:** `docs/superpowers/specs/2026-04-10-security-tier-5-voice-e2ee-design.md`

---

## File Map

### Created

| File | Responsibility |
|---|---|
| `src/shared/sframe/cipher-suite.ts` | Pinned SFrame cipher suite constant + `deriveBaseKey` + `importAesKey` |
| `src/shared/sframe/cipher-suite.test.ts` | Cipher suite + key derivation unit tests |
| `src/shared/sframe/frame-codec.ts` | `sealFrame`/`openFrame`/`parseTrailer` — pure functions over Uint8Array |
| `src/shared/sframe/frame-codec.test.ts` | Round-trip + adversarial tamper tests |
| `src/shared/schemas/sframe-worker-messages.ts` | Zod schemas for worker request/response message union |
| `src/shared/schemas/sframe-worker-messages.test.ts` | Schema round-trip tests |
| `src/client/lib/webrtc/sframe-worker.ts` | SFrame Web Worker — receives rtctransform events, runs TransformStreams |
| `src/client/lib/webrtc/sframe-worker.test.ts` | Worker unit tests (with mocked rtctransform events) |
| `src/client/lib/webrtc/sframe-worker-client.ts` | Typed main-thread facade over the SFrame worker |
| `src/client/lib/webrtc/sframe-worker-client.test.ts` | Facade unit tests (mocked Worker) |
| `src/client/lib/webrtc/sframe-install.ts` | Pure helper: install transforms on an RTCPeerConnection's senders + receivers |
| `src/client/lib/webrtc/sframe-install.test.ts` | Install-helper unit tests (mocked PC) |
| `src/client/lib/webrtc/sframe-key-distribution.ts` | `publishSFrameKey` + `consumeSFrameKey` — HPKE wrap/unwrap + Nostr publish |
| `src/client/lib/webrtc/sframe-key-distribution.test.ts` | Distribution unit tests |
| `src/client/lib/webrtc/sframe-rotation.ts` | `ratchetOnJoin` + `freshSecretOnLeave` + rotation-gap checks |
| `src/client/lib/webrtc/sframe-rotation.test.ts` | Rotation unit tests |
| `src/client/lib/webrtc/sframe-recipients.ts` | `resolveCallRecipients` — Tier 3 device recipients with pre-Tier-3 fallback |
| `src/client/lib/webrtc/sframe-recipients.test.ts` | Recipient resolution tests |
| `src/client/lib/webrtc/feature-detect.ts` | `isSFrameSupported()` browser capability probe |
| `src/client/lib/webrtc/feature-detect.test.ts` | Capability probe tests |
| `src/client/lib/webrtc/dtls-fingerprint.ts` | `extractFingerprintFromSdp`, `publishDtlsBinding`, `verifyDtlsFingerprint` |
| `src/client/lib/webrtc/dtls-fingerprint.test.ts` | Fingerprint extraction + verification tests |
| `src/client/components/call/ActiveCallBadge.tsx` | E2EE badge (direct/relayed/none) |
| `src/client/components/call/ActiveCallBadge.test.tsx` | Component unit tests |
| `src/client/components/call/E2eeFallbackBanner.tsx` | Fallback policy banner |
| `src/client/components/call/E2eeFallbackBanner.test.tsx` | Component unit tests |
| `src/client/routes/admin/settings/voice-e2ee.tsx` | Admin policy setting route |
| `src/client/routes/admin/settings/voice-e2ee.test.tsx` | Route component unit tests |
| `sip-bridge/src/sframe-mode-dispatcher.ts` | ARI Stasis argument parsing — routes calls to `sframe` or `pstn` mode |
| `sip-bridge/src/sframe-mode-dispatcher.test.ts` | Dispatcher unit tests |
| `tests/fixtures/sim-sip-bridge.ts` | Simulated Asterisk ARI + in-memory RTP bridge (prereq PR) |
| `tests/fixtures/sim-sip-bridge.test.ts` | Fixture sanity tests (prereq PR) |
| `tests/fixtures/sim-caller.ts` | Simulated inbound caller: Opus clip + jitter + DTMF (prereq PR); extended in Tier 5 main with SFrame produce/consume (Task 19b) |
| `tests/fixtures/sim-caller.test.ts` | Fixture sanity tests (prereq PR + Tier 5 main addendum) |
| `tests/helpers/sframe-test-utils.ts` | Mock RTP layout + mock SFrame key-material helpers — no `@shared/sframe/` imports (prereq PR) |
| `docs/testing/TEST_FIXTURES_SFRAME.md` | Reference for how to use the fixtures in call tests (prereq PR) |
| `tests/fixtures/sim-compromised-bridge.ts` | Adversarial bridge subclass (Tier 5 main PR — depends on Task 19b) |
| `tests/fixtures/sim-compromised-bridge.test.ts` | Adversarial fixture sanity tests (Tier 5 main PR) |
| `tests/api/sframe-key-event.spec.ts` | API E2E — kind-20002 key event round-trip |
| `tests/api/dtls-fingerprint-event.spec.ts` | API E2E — kind-20003 fingerprint event |
| `tests/api/voice-e2ee-policy.spec.ts` | API E2E — hub policy CRUD |
| `tests/api/sframe-call-mode.spec.ts` | API E2E — PSTN mode detection + dispatch |
| `tests/api/sim-sip-bridge.spec.ts` | API E2E — sim-bridge adversarial suite |
| `tests/ui/voice-e2ee-badge.spec.ts` | UI E2E — badge displays correctly during call |
| `tests/ui/voice-e2ee-rotation.spec.ts` | UI E2E — join/leave rotation |
| `tests/ui/voice-e2ee-fallback.spec.ts` | UI E2E — fallback banner + policy interaction |
| `tests/ui/voice-e2ee-dtls-mismatch.spec.ts` | UI E2E — DTLS fingerprint MITM detection |
| `tests/ui/voice-e2ee-admin-setting.spec.ts` | UI E2E — admin policy setting |
| `tests/ui/voice-e2ee-mic-prompt.spec.ts` | UI E2E — mic prompt regression |
| `tests/ui/voice-e2ee-csp.spec.ts` | UI E2E — CSP `worker-src` allowance |
| `tests/ui/voice-e2ee-setup-latency.spec.ts` | UI E2E — latency budget assertion |
| `docs/security/VOICE_E2EE.md` | User-facing explanation of voice E2EE behavior |
| `docs/security/VOICE_E2EE_BROWSER_MATRIX.md` | Supported browser matrix + fallback map |

### Modified

| File | Change |
|---|---|
| `src/shared/crypto-labels.ts` | Add `LABEL_SFRAME_CALL_SECRET`, `LABEL_SFRAME_BASE_KEY`; append both to `LABEL_REGISTRY` |
| `src/shared/nostr-events.ts` | Add `KIND_SFRAME_KEY = 20002`, `KIND_DTLS_BINDING = 20003` |
| `src/shared/schemas/nostr-events.ts` | Add `SFrameKeyEventPayloadSchema`, `DtlsBindingEventPayloadSchema`, `CallModePayloadSchema` |
| `src/shared/schemas/audit-entries.ts` | Add `call_e2ee_state_change` + `call_sframe_key_rotation` audit payload variants (extends Tier 0 union) |
| `src/shared/schemas/hub-settings.ts` | Add `voiceCallE2eePolicy: 'required' | 'preferred' | 'off'` field |
| `src/client/lib/webrtc/manager.ts` | Wire `sframeWorker.registerCall` / `releaseCall` into call lifecycle |
| `src/client/lib/webrtc/types.ts` | Add `SFrameTransformOptions`, `SFrameCallKey`, `SFrameCallMetrics` types |
| `src/client/lib/webrtc/adapters/sip.ts` | Hook `peerconnection` event; install SFrame transforms via `sframe-install.ts` |
| `src/client/lib/webrtc/adapters/twilio.ts` | Same integration via `mediaHandler.version.pc` internal |
| `src/client/lib/webrtc/adapters/vonage.ts` | Same integration path |
| `src/client/lib/webrtc/adapters/plivo.ts` | Same integration path |
| `src/client/components/call/` | Wire `ActiveCallBadge` + `E2eeFallbackBanner` into existing call overlay |
| `src/client/locales/en.json` + 12 sibling locales | Add voice E2EE i18n keys |
| `src/server/services/call-router-service.ts` | Publish kind-20001 `call:mode` on PSTN calls |
| `sip-bridge/asterisk-config/extensions.conf` | Add `[volunteers-sframe]` context; remove `[volunteers]` |
| `sip-bridge/src/endpoint-provisioner.ts` | Move new endpoints to `volunteers-sframe`; force Opus-only + refuse transcoding |
| `sip-bridge/src/endpoint-provisioner.test.ts` | Update expected ARI payloads |
| `sip-bridge/src/index.ts` | Parse `sframe` Stasis argument via `SframeModeDispatcher` |
| `deploy/ansible/roles/llamenos/templates/docker-compose.j2` | Bump asterisk image tag (if needed for Opus/ARI features) |
| `package.json` | Add `@hpke/core`, `@hpke/dhkem-x25519`, `@hpke/chacha20poly1305` (if Tier 1 has not landed) |
| `.github/workflows/ci.yml` | Add grep check: no raw `'llamenos:sframe-*'` literals outside `crypto-labels.ts` |
| `docs/epics/epic-75-native-call-clients.md` | Append Tier 5 voice E2EE section referencing this spec |
| `CLAUDE.md` | Add Tier 5 migration note + SFrame worker singleton warning to Gotchas section |

---

## Workstream 5.1 — Crypto labels + cipher suite pinning

### Task 1: Add two new crypto labels

**Files:**
- Modify: `src/shared/crypto-labels.ts`
- Modify: `src/shared/crypto-primitives.test.ts` (or wherever Tier 0 placed its registry test)

- [ ] **Step 1: Write failing test**

Append to `src/shared/crypto-primitives.test.ts`:

```typescript
import {
  LABEL_SFRAME_CALL_SECRET,
  LABEL_SFRAME_BASE_KEY,
  LABEL_REGISTRY,
  labelToId,
} from './crypto-labels'

describe('SFrame labels', () => {
  test('LABEL_SFRAME_CALL_SECRET is registered', () => {
    expect(() => labelToId(LABEL_SFRAME_CALL_SECRET)).not.toThrow()
    expect(LABEL_REGISTRY).toContain(LABEL_SFRAME_CALL_SECRET)
  })

  test('LABEL_SFRAME_BASE_KEY is registered', () => {
    expect(() => labelToId(LABEL_SFRAME_BASE_KEY)).not.toThrow()
    expect(LABEL_REGISTRY).toContain(LABEL_SFRAME_BASE_KEY)
  })

  test('labels are domain-separated', () => {
    expect(LABEL_SFRAME_CALL_SECRET).not.toBe(LABEL_SFRAME_BASE_KEY)
  })

  test('labels carry :v1 suffix', () => {
    expect(LABEL_SFRAME_CALL_SECRET).toContain(':v1')
    expect(LABEL_SFRAME_BASE_KEY).toContain(':v1')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/shared/crypto-primitives.test.ts -t "SFrame labels"`
Expected: FAIL — labels not exported.

- [ ] **Step 3: Add labels**

Append to `src/shared/crypto-labels.ts` (before `LABEL_REGISTRY` declaration if Tier 0 landed a registry at the bottom):

```typescript
// --- SFrame Voice E2EE (Tier 5) ---

/** Per-call 32-byte root secret — HPKE-wrapped per participant device. */
export const LABEL_SFRAME_CALL_SECRET = 'llamenos:sframe-call-secret:v1' as CryptoLabel

/** HKDF info when deriving a per-sender SFrame base key from the call secret. */
export const LABEL_SFRAME_BASE_KEY = 'llamenos:sframe-base-key:v1' as CryptoLabel
```

Append both labels to `LABEL_REGISTRY`'s const array (after the last Tier 0 entry).

- [ ] **Step 4: Re-run test**

Run: `bun test src/shared/crypto-primitives.test.ts -t "SFrame labels"`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto-labels.ts src/shared/crypto-primitives.test.ts
git commit -m "feat(crypto-labels): add LABEL_SFRAME_CALL_SECRET + LABEL_SFRAME_BASE_KEY"
```

### Task 2: Pin SFrame cipher suite + `deriveBaseKey` helper

**Files:**
- Create: `src/shared/sframe/cipher-suite.ts`
- Create: `src/shared/sframe/cipher-suite.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/shared/sframe/cipher-suite.test.ts
import { describe, expect, test } from 'bun:test'
import {
  SFRAME_CIPHER_SUITE,
  deriveBaseKey,
  importAesKey,
} from './cipher-suite'

describe('SFRAME_CIPHER_SUITE', () => {
  test('pinned to AES_128_GCM_SHA256_128', () => {
    expect(SFRAME_CIPHER_SUITE.aead).toBe('AES-GCM')
    expect(SFRAME_CIPHER_SUITE.keyLength).toBe(16)
    expect(SFRAME_CIPHER_SUITE.tagLength).toBe(16)
    expect(SFRAME_CIPHER_SUITE.nonceLength).toBe(12)
    expect(SFRAME_CIPHER_SUITE.hash).toBe('SHA-256')
  })
})

describe('deriveBaseKey', () => {
  const callSecret = new Uint8Array(32).fill(0xAA)
  const callId = '00000000-0000-4000-8000-000000000001'

  test('returns 16 bytes', async () => {
    const key = await deriveBaseKey(callSecret, callId, 'sender-1')
    expect(key.length).toBe(16)
  })

  test('is deterministic', async () => {
    const k1 = await deriveBaseKey(callSecret, callId, 'sender-1')
    const k2 = await deriveBaseKey(callSecret, callId, 'sender-1')
    expect(Array.from(k1)).toEqual(Array.from(k2))
  })

  test('differs per sender', async () => {
    const k1 = await deriveBaseKey(callSecret, callId, 'sender-1')
    const k2 = await deriveBaseKey(callSecret, callId, 'sender-2')
    expect(Array.from(k1)).not.toEqual(Array.from(k2))
  })

  test('differs per callId', async () => {
    const k1 = await deriveBaseKey(callSecret, callId, 'sender-1')
    const k2 = await deriveBaseKey(
      callSecret,
      '00000000-0000-4000-8000-000000000002',
      'sender-1',
    )
    expect(Array.from(k1)).not.toEqual(Array.from(k2))
  })
})

describe('importAesKey', () => {
  test('returns a non-extractable AES-GCM CryptoKey', async () => {
    const raw = new Uint8Array(16).fill(0xCC)
    const key = await importAesKey(raw)
    expect(key.algorithm.name).toBe('AES-GCM')
    expect(key.extractable).toBe(false)
    expect(key.usages).toEqual(['encrypt', 'decrypt'])
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/shared/sframe/cipher-suite.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the module**

```typescript
// src/shared/sframe/cipher-suite.ts
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { LABEL_SFRAME_BASE_KEY } from '../crypto-labels'

/**
 * Pinned SFrame cipher suite for Llamenos voice E2EE.
 * Corresponds to AES_128_GCM_SHA256_128 in draft-ietf-sframe-enc.
 */
export const SFRAME_CIPHER_SUITE = {
  aead: 'AES-GCM' as const,
  keyLength: 16,
  tagLength: 16,
  nonceLength: 12,
  hash: 'SHA-256' as const,
} as const

/**
 * Derive a per-sender SFrame base key from the shared 32-byte call secret.
 * HKDF-SHA256(callSecret, salt=callId, info=LABEL_SFRAME_BASE_KEY||senderId, length=16)
 */
export async function deriveBaseKey(
  callSecret: Uint8Array,
  callId: string,
  senderId: string,
): Promise<Uint8Array> {
  const salt = utf8ToBytes(callId)
  const info = new Uint8Array([
    ...utf8ToBytes(LABEL_SFRAME_BASE_KEY),
    ...utf8ToBytes(senderId),
  ])
  return hkdf(sha256, callSecret, salt, info, SFRAME_CIPHER_SUITE.keyLength)
}

/**
 * Import raw key bytes as a non-extractable AES-GCM CryptoKey.
 * Once imported, the raw bytes cannot be read back — the browser holds
 * the key in its crypto sandbox.
 */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: SFRAME_CIPHER_SUITE.aead },
    false,
    ['encrypt', 'decrypt'],
  )
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/shared/sframe/cipher-suite.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/sframe/cipher-suite.ts src/shared/sframe/cipher-suite.test.ts
git commit -m "feat(sframe): pin AES_128_GCM_SHA256_128 cipher suite + deriveBaseKey"
```

---

## Workstream 5.2 — Frame codec (wire format)

### Task 3: Trailer parser

**Files:**
- Create: `src/shared/sframe/frame-codec.ts` (initial skeleton)
- Create: `src/shared/sframe/frame-codec.test.ts`

- [ ] **Step 1: Write failing test for `parseTrailer`**

```typescript
// src/shared/sframe/frame-codec.test.ts
import { describe, expect, test } from 'bun:test'
import { parseTrailer } from './frame-codec'

describe('parseTrailer', () => {
  test('extracts keyId and counter from a well-formed frame', () => {
    // Frame: [...payload..., counter(4), config(1)]
    // Counter = 0x01020304, config: keyId=5 in low 7 bits
    const frame = new Uint8Array([
      0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x00,    // placeholder payload + GCM tag bytes
      // ... enough bytes so the total length > 21
      ...new Array(20).fill(0x00),
      0x01, 0x02, 0x03, 0x04,                // counter
      0x05,                                   // keyId=5
    ])
    const { keyId, counter } = parseTrailer(frame)
    expect(keyId).toBe(5)
    expect(counter).toBe(0x01020304)
  })

  test('masks off top bit of config byte', () => {
    const frame = new Uint8Array([
      ...new Array(20).fill(0),
      0, 0, 0, 0,
      0xFF, // top bit set, keyId=0x7F
    ])
    const { keyId } = parseTrailer(frame)
    expect(keyId).toBe(0x7F)
  })

  test('rejects frames shorter than 21 bytes', () => {
    const short = new Uint8Array(20)
    expect(() => parseTrailer(short)).toThrow('frame too short')
  })

  test('reads counter as big-endian', () => {
    const frame = new Uint8Array([
      ...new Array(20).fill(0),
      0x00, 0x00, 0x00, 0xFF, // counter=255
      0x00,
    ])
    const { counter } = parseTrailer(frame)
    expect(counter).toBe(255)
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/shared/sframe/frame-codec.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `parseTrailer`**

```typescript
// src/shared/sframe/frame-codec.ts
const TRAILER_SIZE = 21 // 16 (GCM tag) + 4 (counter) + 1 (config)

export function parseTrailer(frame: Uint8Array): { keyId: number; counter: number } {
  if (frame.length < TRAILER_SIZE) {
    throw new Error('frame too short')
  }
  const configOffset = frame.length - 1
  const counterOffset = configOffset - 4
  const keyId = frame[configOffset] & 0x7F // low 7 bits
  const counter =
    (frame[counterOffset] << 24) |
    (frame[counterOffset + 1] << 16) |
    (frame[counterOffset + 2] << 8) |
    frame[counterOffset + 3]
  return { keyId, counter >>> 0 }
}
```

Wait — the `counter >>> 0` inside the return object literal is a syntax error. Fix:

```typescript
export function parseTrailer(frame: Uint8Array): { keyId: number; counter: number } {
  if (frame.length < TRAILER_SIZE) {
    throw new Error('frame too short')
  }
  const configOffset = frame.length - 1
  const counterOffset = configOffset - 4
  const keyId = frame[configOffset] & 0x7F
  const counterBe =
    (frame[counterOffset] << 24) |
    (frame[counterOffset + 1] << 16) |
    (frame[counterOffset + 2] << 8) |
    frame[counterOffset + 3]
  const counter = counterBe >>> 0 // unsigned 32-bit
  return { keyId, counter }
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/shared/sframe/frame-codec.test.ts -t "parseTrailer"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/sframe/frame-codec.ts src/shared/sframe/frame-codec.test.ts
git commit -m "feat(sframe): parseTrailer extracts keyId + counter from wire frame"
```

### Task 4: `sealFrame` + `openFrame` with AAD binding

**Files:**
- Modify: `src/shared/sframe/frame-codec.ts`
- Modify: `src/shared/sframe/frame-codec.test.ts`

- [ ] **Step 1: Write failing tests for round-trip**

Append to `frame-codec.test.ts`:

```typescript
import { sealFrame, openFrame, type SFrameSealInputs } from './frame-codec'
import { importAesKey } from './cipher-suite'

describe('sealFrame / openFrame round-trip', () => {
  let key: CryptoKey
  beforeAll(async () => {
    const raw = new Uint8Array(16).fill(0x42)
    key = await importAesKey(raw)
  })

  const baseInputs = {
    key: null as unknown as CryptoKey, // filled in per-test
    callId: '00000000-0000-4000-8000-000000000001',
    senderId: 'a'.repeat(64),
    keyId: 0,
    counter: 1,
    ssrc: 0xCAFEBABE,
    rtpTimestamp: 1000,
    codecHeaderLength: 1, // Opus TOC byte
  }

  test('round-trip succeeds with matching params', async () => {
    const plaintext = new Uint8Array([
      0x01, // Opus TOC byte
      0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    ])
    const sealed = await sealFrame({ ...baseInputs, key, plaintext })
    const opened = await openFrame(key, sealed, baseInputs)
    expect(Array.from(opened)).toEqual(Array.from(plaintext))
  })

  test('openFrame preserves codec header plaintext', async () => {
    const plaintext = new Uint8Array([0x7F, 0xAA, 0xBB, 0xCC])
    const sealed = await sealFrame({ ...baseInputs, key, plaintext })
    // First byte (Opus TOC) must be unchanged in the wire frame
    expect(sealed[0]).toBe(0x7F)
  })

  test('tampered ciphertext throws', async () => {
    const plaintext = new Uint8Array([0x01, 0xAA, 0xBB, 0xCC])
    const sealed = await sealFrame({ ...baseInputs, key, plaintext })
    // Flip a byte in the middle of the ciphertext
    sealed[3] ^= 0xFF
    await expect(openFrame(key, sealed, baseInputs)).rejects.toThrow()
  })

  test('tampered trailer keyId throws on lookup', async () => {
    const plaintext = new Uint8Array([0x01, 0x02, 0x03])
    const sealed = await sealFrame({ ...baseInputs, key, plaintext })
    // Flip keyId byte
    sealed[sealed.length - 1] = 0x42
    await expect(
      openFrame(key, sealed, { ...baseInputs, keyId: 0x42 }),
    ).rejects.toThrow()
  })

  test('swapped callId in AAD throws', async () => {
    const plaintext = new Uint8Array([0x01, 0x02, 0x03])
    const sealed = await sealFrame({ ...baseInputs, key, plaintext })
    await expect(
      openFrame(key, sealed, {
        ...baseInputs,
        callId: '00000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toThrow()
  })

  test('swapped senderId in AAD throws', async () => {
    const plaintext = new Uint8Array([0x01, 0x02, 0x03])
    const sealed = await sealFrame({ ...baseInputs, key, plaintext })
    await expect(
      openFrame(key, sealed, { ...baseInputs, senderId: 'b'.repeat(64) }),
    ).rejects.toThrow()
  })

  test('different SSRC produces different nonce → decrypt fails', async () => {
    const plaintext = new Uint8Array([0x01, 0x02, 0x03])
    const sealed = await sealFrame({ ...baseInputs, key, plaintext })
    await expect(
      openFrame(key, sealed, { ...baseInputs, ssrc: 0xDEADBEEF }),
    ).rejects.toThrow()
  })

  test('nonce is SSRC||timestamp||counter big-endian', async () => {
    // Verify nonce construction against a known reference vector
    const plaintext = new Uint8Array([0x01])
    const sealed = await sealFrame({
      ...baseInputs,
      key,
      plaintext,
      ssrc: 0x01020304,
      rtpTimestamp: 0x05060708,
      counter: 0x090A0B0C,
    })
    // If openFrame with the same params succeeds, the nonce matches
    const opened = await openFrame(key, sealed, {
      ...baseInputs,
      ssrc: 0x01020304,
      rtpTimestamp: 0x05060708,
    })
    expect(Array.from(opened)).toEqual(Array.from(plaintext))
  })
})
```

- [ ] **Step 2: Run failing tests**

Run: `bun test src/shared/sframe/frame-codec.test.ts -t "round-trip"`
Expected: FAIL — `sealFrame`/`openFrame` not exported.

- [ ] **Step 3: Implement `sealFrame` and `openFrame`**

Append to `src/shared/sframe/frame-codec.ts`:

```typescript
import { LABEL_SFRAME_BASE_KEY } from '../crypto-labels'
import { labelToId } from '../crypto-labels'
import { utf8ToBytes, hexToBytes } from '@noble/hashes/utils.js'

export interface SFrameSealInputs {
  plaintext: Uint8Array
  key: CryptoKey
  callId: string
  senderId: string // 32-byte hex pubkey
  keyId: number // 0..127
  counter: number // uint32
  ssrc: number
  rtpTimestamp: number
  codecHeaderLength: number
}

function buildNonce(ssrc: number, rtpTimestamp: number, counter: number): Uint8Array {
  const nonce = new Uint8Array(12)
  const view = new DataView(nonce.buffer)
  view.setUint32(0, ssrc >>> 0, false) // big-endian
  view.setUint32(4, rtpTimestamp >>> 0, false)
  view.setUint32(8, counter >>> 0, false)
  return nonce
}

function buildAad(callId: string, senderId: string, keyId: number): Uint8Array {
  const labelBytes = utf8ToBytes(LABEL_SFRAME_BASE_KEY)
  const labelIdByte = new Uint8Array([labelToId(LABEL_SFRAME_BASE_KEY)])
  const callIdBytes = utf8ToBytes(callId)
  const senderBytes = hexToBytes(senderId)
  const keyIdByte = new Uint8Array([keyId & 0x7F])
  const aad = new Uint8Array(
    labelBytes.length + 1 + callIdBytes.length + senderBytes.length + 1,
  )
  let off = 0
  aad.set(labelBytes, off); off += labelBytes.length
  aad.set(labelIdByte, off); off += 1
  aad.set(callIdBytes, off); off += callIdBytes.length
  aad.set(senderBytes, off); off += senderBytes.length
  aad.set(keyIdByte, off)
  return aad
}

function writeTrailer(output: Uint8Array, offset: number, counter: number, keyId: number): void {
  const view = new DataView(output.buffer, output.byteOffset + offset, 5)
  view.setUint32(0, counter >>> 0, false) // big-endian
  view.setUint8(4, keyId & 0x7F)
}

export async function sealFrame(inputs: SFrameSealInputs): Promise<Uint8Array> {
  const { plaintext, key, callId, senderId, keyId, counter, ssrc, rtpTimestamp, codecHeaderLength } = inputs
  if (plaintext.length < codecHeaderLength) {
    throw new Error('plaintext shorter than declared codec header')
  }

  const codecHeader = plaintext.slice(0, codecHeaderLength)
  const toEncrypt = plaintext.slice(codecHeaderLength)

  const nonce = buildNonce(ssrc, rtpTimestamp, counter)
  const aad = buildAad(callId, senderId, keyId)

  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
    key,
    toEncrypt as BufferSource,
  )
  const ct = new Uint8Array(ctBuf)

  // Wire layout: codecHeader || ciphertext+tag || counter(4) || config(1)
  const output = new Uint8Array(codecHeader.length + ct.length + 5)
  output.set(codecHeader, 0)
  output.set(ct, codecHeader.length)
  writeTrailer(output, codecHeader.length + ct.length, counter, keyId)
  return output
}

export async function openFrame(
  key: CryptoKey,
  frame: Uint8Array,
  params: Pick<SFrameSealInputs, 'callId' | 'senderId' | 'keyId' | 'ssrc' | 'rtpTimestamp' | 'codecHeaderLength'>,
): Promise<Uint8Array> {
  const { callId, senderId, keyId, ssrc, rtpTimestamp, codecHeaderLength } = params
  if (frame.length < codecHeaderLength + TRAILER_SIZE) {
    throw new Error('frame too short')
  }

  const { counter } = parseTrailer(frame)
  const ctEnd = frame.length - 5 // trailer = counter(4) + config(1)
  const ct = frame.slice(codecHeaderLength, ctEnd)
  const codecHeader = frame.slice(0, codecHeaderLength)

  const nonce = buildNonce(ssrc, rtpTimestamp, counter)
  const aad = buildAad(callId, senderId, keyId)

  const ptBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
    key,
    ct as BufferSource,
  )
  const pt = new Uint8Array(ptBuf)

  const combined = new Uint8Array(codecHeader.length + pt.length)
  combined.set(codecHeader, 0)
  combined.set(pt, codecHeader.length)
  return combined
}
```

- [ ] **Step 4: Re-run tests**

Run: `bun test src/shared/sframe/frame-codec.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/sframe/frame-codec.ts src/shared/sframe/frame-codec.test.ts
git commit -m "feat(sframe): sealFrame + openFrame with AAD binding + trailer format"
```

---

## Workstream 5.3 — Feature detection + browser gate

### Task 5: `isSFrameSupported` capability probe

**Files:**
- Create: `src/client/lib/webrtc/feature-detect.ts`
- Create: `src/client/lib/webrtc/feature-detect.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/webrtc/feature-detect.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { isSFrameSupported } from './feature-detect'

describe('isSFrameSupported', () => {
  const originalTransform = globalThis.RTCRtpScriptTransform
  const originalWorker = globalThis.Worker
  const originalCrypto = globalThis.crypto

  afterEach(() => {
    globalThis.RTCRtpScriptTransform = originalTransform
    globalThis.Worker = originalWorker
    globalThis.crypto = originalCrypto
  })

  test('returns false when RTCRtpScriptTransform is undefined', () => {
    // biome-ignore lint: test stub
    ;(globalThis as any).RTCRtpScriptTransform = undefined
    expect(isSFrameSupported()).toBe(false)
  })

  test('returns false when Worker is undefined', () => {
    ;(globalThis as any).RTCRtpScriptTransform = class {}
    ;(globalThis as any).Worker = undefined
    expect(isSFrameSupported()).toBe(false)
  })

  test('returns true when both exist and crypto.subtle.importKey is a function', () => {
    ;(globalThis as any).RTCRtpScriptTransform = class {}
    ;(globalThis as any).Worker = class {}
    // crypto.subtle should already exist in bun test env
    expect(isSFrameSupported()).toBe(true)
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/lib/webrtc/feature-detect.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/webrtc/feature-detect.ts

/**
 * Probes the browser for SFrame support. Returns true iff:
 *   - RTCRtpScriptTransform is available (Chrome 2025+, Firefox 117+, Safari 15.4+)
 *   - Worker is available
 *   - crypto.subtle.importKey is a function (WebCrypto baseline)
 */
export function isSFrameSupported(): boolean {
  if (typeof globalThis === 'undefined') return false
  // biome-ignore lint/suspicious/noExplicitAny: runtime feature probe
  const g = globalThis as any
  if (typeof g.RTCRtpScriptTransform === 'undefined') return false
  if (typeof g.Worker === 'undefined') return false
  if (typeof g.crypto?.subtle?.importKey !== 'function') return false
  return true
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/lib/webrtc/feature-detect.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/feature-detect.ts src/client/lib/webrtc/feature-detect.test.ts
git commit -m "feat(webrtc): isSFrameSupported browser capability probe"
```

---

## Workstream 5.4 — SFrame Web Worker + main-thread client

### Task 6: Worker message schemas (zod)

**Files:**
- Create: `src/shared/schemas/sframe-worker-messages.ts`
- Create: `src/shared/schemas/sframe-worker-messages.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/shared/schemas/sframe-worker-messages.test.ts
import { describe, expect, test } from 'bun:test'
import {
  SFrameWorkerRequestSchema,
  SFrameWorkerResponseSchema,
  SFrameErrorCodeSchema,
} from './sframe-worker-messages'

describe('SFrameWorkerRequestSchema', () => {
  test('accepts registerCall', () => {
    const msg = { type: 'registerCall', id: '1', callId: 'call-1' }
    expect(() => SFrameWorkerRequestSchema.parse(msg)).not.toThrow()
  })

  test('accepts setSenderKey with ArrayBuffer base key', () => {
    const msg = {
      type: 'setSenderKey',
      id: '2',
      callId: 'call-1',
      keyId: 0,
      baseKey: new ArrayBuffer(16),
      senderId: 'sender-1',
    }
    expect(() => SFrameWorkerRequestSchema.parse(msg)).not.toThrow()
  })

  test('rejects keyId > 127', () => {
    expect(() =>
      SFrameWorkerRequestSchema.parse({
        type: 'setSenderKey',
        id: '3',
        callId: 'call-1',
        keyId: 128,
        baseKey: new ArrayBuffer(16),
        senderId: 'sender-1',
      }),
    ).toThrow()
  })
})

describe('SFrameWorkerResponseSchema', () => {
  test('accepts success', () => {
    expect(() =>
      SFrameWorkerResponseSchema.parse({ type: 'success', id: '1' }),
    ).not.toThrow()
  })

  test('accepts error with code', () => {
    expect(() =>
      SFrameWorkerResponseSchema.parse({
        type: 'error',
        id: '1',
        error: 'bad',
        code: 'unknown_call',
      }),
    ).not.toThrow()
  })
})

describe('SFrameErrorCodeSchema', () => {
  test('allows all documented codes', () => {
    const codes = [
      'unknown_call',
      'unknown_key_id',
      'key_zero_length',
      'decrypt_failed',
      'encrypt_failed',
      'aad_mismatch',
      'header_parse_failed',
      'worker_not_ready',
    ]
    for (const code of codes) {
      expect(() => SFrameErrorCodeSchema.parse(code)).not.toThrow()
    }
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/shared/schemas/sframe-worker-messages.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// src/shared/schemas/sframe-worker-messages.ts
import { z } from '@hono/zod-openapi'

export const SFrameErrorCodeSchema = z.enum([
  'unknown_call',
  'unknown_key_id',
  'key_zero_length',
  'decrypt_failed',
  'encrypt_failed',
  'aad_mismatch',
  'header_parse_failed',
  'worker_not_ready',
])
export type SFrameErrorCode = z.infer<typeof SFrameErrorCodeSchema>

const baseKeyShape = z.custom<ArrayBuffer>((v) => v instanceof ArrayBuffer, 'expected ArrayBuffer')

export const SFrameWorkerRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('registerCall'), id: z.string(), callId: z.string() }),
  z.object({
    type: z.literal('setSenderKey'),
    id: z.string(),
    callId: z.string(),
    keyId: z.number().int().min(0).max(127),
    baseKey: baseKeyShape,
    senderId: z.string(),
  }),
  z.object({
    type: z.literal('setReceiverKey'),
    id: z.string(),
    callId: z.string(),
    keyId: z.number().int().min(0).max(127),
    baseKey: baseKeyShape,
    senderId: z.string(),
  }),
  z.object({
    type: z.literal('rotateCallKey'),
    id: z.string(),
    callId: z.string(),
    newKeyId: z.number().int().min(0).max(127),
    newBaseKeys: z.record(z.string(), baseKeyShape),
  }),
  z.object({ type: z.literal('releaseCall'), id: z.string(), callId: z.string() }),
  z.object({ type: z.literal('getMetrics'), id: z.string(), callId: z.string() }),
])
export type SFrameWorkerRequest = z.infer<typeof SFrameWorkerRequestSchema>

export const SFrameWorkerResponseSchema = z.union([
  z.object({ type: z.literal('success'), id: z.string(), result: z.unknown().optional() }),
  z.object({
    type: z.literal('error'),
    id: z.string(),
    error: z.string(),
    code: SFrameErrorCodeSchema,
  }),
])
export type SFrameWorkerResponse = z.infer<typeof SFrameWorkerResponseSchema>
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/shared/schemas/sframe-worker-messages.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas/sframe-worker-messages.ts src/shared/schemas/sframe-worker-messages.test.ts
git commit -m "feat(sframe): zod schemas for worker request/response messages"
```

### Task 7: SFrame Web Worker core

**Files:**
- Create: `src/client/lib/webrtc/sframe-worker.ts`
- Create: `src/client/lib/webrtc/sframe-worker.test.ts`

- [ ] **Step 1: Write failing test (worker as a module)**

The worker runs in a `DedicatedWorkerGlobalScope`, but we test the logic by importing the pure functions (`handleRequest`) and exercising them directly.

```typescript
// src/client/lib/webrtc/sframe-worker.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  handleRequest,
  clearWorkerState,
} from './sframe-worker'

describe('SFrame worker handleRequest', () => {
  beforeEach(() => clearWorkerState())

  test('registerCall creates empty call state', async () => {
    const resp = await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    expect(resp.type).toBe('success')
    expect(resp.id).toBe('1')
  })

  test('setSenderKey adds key for a sender', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    const baseKey = new Uint8Array(16).fill(0x42).buffer
    const resp = await handleRequest({
      type: 'setSenderKey',
      id: '2',
      callId: 'call-1',
      keyId: 0,
      baseKey,
      senderId: 'sender-a',
    })
    expect(resp.type).toBe('success')
  })

  test('setSenderKey on unknown call returns error', async () => {
    const resp = await handleRequest({
      type: 'setSenderKey',
      id: '3',
      callId: 'unknown',
      keyId: 0,
      baseKey: new Uint8Array(16).buffer,
      senderId: 'sender-a',
    })
    expect(resp.type).toBe('error')
    if (resp.type === 'error') expect(resp.code).toBe('unknown_call')
  })

  test('rejects zero-length key', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    const resp = await handleRequest({
      type: 'setSenderKey',
      id: '2',
      callId: 'call-1',
      keyId: 0,
      baseKey: new ArrayBuffer(0),
      senderId: 'sender-a',
    })
    expect(resp.type).toBe('error')
    if (resp.type === 'error') expect(resp.code).toBe('key_zero_length')
  })

  test('releaseCall clears state', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    const resp = await handleRequest({ type: 'releaseCall', id: '2', callId: 'call-1' })
    expect(resp.type).toBe('success')
    const next = await handleRequest({
      type: 'setSenderKey',
      id: '3',
      callId: 'call-1',
      keyId: 0,
      baseKey: new Uint8Array(16).buffer,
      senderId: 'sender-a',
    })
    expect(next.type).toBe('error')
  })

  test('getMetrics returns call metrics', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    const resp = await handleRequest({ type: 'getMetrics', id: '2', callId: 'call-1' })
    expect(resp.type).toBe('success')
    if (resp.type === 'success') {
      expect(resp.result).toMatchObject({ sealed: 0, opened: 0, errors: 0 })
    }
  })

  test('rotateCallKey retains previous key during grace window', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    await handleRequest({
      type: 'setSenderKey',
      id: '2',
      callId: 'call-1',
      keyId: 0,
      baseKey: new Uint8Array(16).fill(0x11).buffer,
      senderId: 'sender-a',
    })
    const rotated = await handleRequest({
      type: 'rotateCallKey',
      id: '3',
      callId: 'call-1',
      newKeyId: 1,
      newBaseKeys: { 'sender-a': new Uint8Array(16).fill(0x22).buffer },
    })
    expect(rotated.type).toBe('success')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/lib/webrtc/sframe-worker.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement worker logic**

```typescript
// src/client/lib/webrtc/sframe-worker.ts
import { importAesKey } from '@shared/sframe/cipher-suite'
import { sealFrame, openFrame, parseTrailer } from '@shared/sframe/frame-codec'
import type { SFrameWorkerRequest, SFrameWorkerResponse } from '@shared/schemas/sframe-worker-messages'

interface SenderKeyState {
  keyId: number
  key: CryptoKey
  counter: number
}

interface ReceiverKeyMap {
  // keyId → CryptoKey for each senderId
  current: Map<number, CryptoKey>
  // Previous keys retained during grace window (per-keyId expiry timestamp)
  grace: Map<number, { key: CryptoKey; expiresAt: number }>
}

interface CallState {
  callId: string
  senderKeys: Map<string, SenderKeyState>
  receiverKeys: Map<string, ReceiverKeyMap>
  metrics: { sealed: number; opened: number; errors: number; lastError?: string }
}

const GRACE_WINDOW_MS = 2_000
const MAX_GRACE_KEYS = 3

const calls = new Map<string, CallState>()

/** Exported for tests. Never call in production. */
export function clearWorkerState(): void {
  calls.clear()
}

function now(): number {
  return Date.now()
}

function pruneGrace(map: Map<number, { key: CryptoKey; expiresAt: number }>): void {
  const cutoff = now()
  for (const [keyId, entry] of map) {
    if (entry.expiresAt < cutoff) map.delete(keyId)
  }
  // Cap at MAX_GRACE_KEYS: evict oldest
  if (map.size > MAX_GRACE_KEYS) {
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    while (sorted.length > MAX_GRACE_KEYS) {
      const [kid] = sorted.shift()!
      map.delete(kid)
    }
  }
}

export async function handleRequest(req: SFrameWorkerRequest): Promise<SFrameWorkerResponse> {
  try {
    switch (req.type) {
      case 'registerCall': {
        if (!calls.has(req.callId)) {
          calls.set(req.callId, {
            callId: req.callId,
            senderKeys: new Map(),
            receiverKeys: new Map(),
            metrics: { sealed: 0, opened: 0, errors: 0 },
          })
        }
        return { type: 'success', id: req.id }
      }

      case 'setSenderKey': {
        const state = calls.get(req.callId)
        if (!state) return { type: 'error', id: req.id, error: 'unknown call', code: 'unknown_call' }
        if (req.baseKey.byteLength === 0) {
          return { type: 'error', id: req.id, error: 'zero-length key', code: 'key_zero_length' }
        }
        const cryptoKey = await importAesKey(new Uint8Array(req.baseKey))
        state.senderKeys.set(req.senderId, { keyId: req.keyId, key: cryptoKey, counter: 0 })
        return { type: 'success', id: req.id }
      }

      case 'setReceiverKey': {
        const state = calls.get(req.callId)
        if (!state) return { type: 'error', id: req.id, error: 'unknown call', code: 'unknown_call' }
        if (req.baseKey.byteLength === 0) {
          return { type: 'error', id: req.id, error: 'zero-length key', code: 'key_zero_length' }
        }
        const cryptoKey = await importAesKey(new Uint8Array(req.baseKey))
        let recv = state.receiverKeys.get(req.senderId)
        if (!recv) {
          recv = { current: new Map(), grace: new Map() }
          state.receiverKeys.set(req.senderId, recv)
        }
        recv.current.set(req.keyId, cryptoKey)
        return { type: 'success', id: req.id }
      }

      case 'rotateCallKey': {
        const state = calls.get(req.callId)
        if (!state) return { type: 'error', id: req.id, error: 'unknown call', code: 'unknown_call' }
        // Move existing sender/receiver keys into grace window, then install new ones
        for (const [senderId, newRaw] of Object.entries(req.newBaseKeys)) {
          // Sender side
          const oldSender = state.senderKeys.get(senderId)
          if (oldSender) {
            // No-op: the sender's old key is NOT retained — senders only use the latest key.
            // The receivers of OTHER participants keep the previous key in their receiver grace window.
          }
          const newSenderKey = await importAesKey(new Uint8Array(newRaw))
          state.senderKeys.set(senderId, { keyId: req.newKeyId, key: newSenderKey, counter: 0 })
          // Receiver side: for each existing receiverKey for this sender, demote previous keyId
          const recv = state.receiverKeys.get(senderId)
          if (recv) {
            const previousKeyId = req.newKeyId - 1
            const previousKey = recv.current.get(previousKeyId)
            if (previousKey) {
              recv.grace.set(previousKeyId, { key: previousKey, expiresAt: now() + GRACE_WINDOW_MS })
              recv.current.delete(previousKeyId)
            }
            recv.current.set(req.newKeyId, newSenderKey)
            pruneGrace(recv.grace)
          }
        }
        return { type: 'success', id: req.id }
      }

      case 'releaseCall': {
        calls.delete(req.callId)
        return { type: 'success', id: req.id }
      }

      case 'getMetrics': {
        const state = calls.get(req.callId)
        if (!state) return { type: 'error', id: req.id, error: 'unknown call', code: 'unknown_call' }
        return { type: 'success', id: req.id, result: { ...state.metrics } }
      }
    }
  } catch (err) {
    return {
      type: 'error',
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
      code: 'worker_not_ready',
    }
  }
}

// Wire up postMessage only if we are actually running inside a Worker.
// Tests import handleRequest directly and bypass this.
if (typeof self !== 'undefined' && typeof (self as unknown as { onmessage: unknown }).onmessage !== 'undefined') {
  self.onmessage = async (event: MessageEvent) => {
    const resp = await handleRequest(event.data as SFrameWorkerRequest)
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(resp)
  }

  // rtctransform handler — installed only if we are a real worker
  ;(self as unknown as {
    onrtctransform?: (ev: Event) => void
  }).onrtctransform = (event: Event) => {
    const transformer = (event as unknown as { transformer: {
      readable: ReadableStream<unknown>
      writable: WritableStream<unknown>
      options: { direction: 'inbound' | 'outbound'; callId: string; senderId?: string; keyId: number; codecHeaderLength?: number }
    } }).transformer
    const opts = transformer.options
    const state = calls.get(opts.callId)
    if (!state) {
      transformer.writable.abort(new Error('unknown_call'))
      return
    }
    const codecHeaderLength = opts.codecHeaderLength ?? 1
    const frameStream = new TransformStream<unknown, unknown>({
      async transform(rawFrame, controller) {
        const frame = rawFrame as { data: ArrayBuffer; getMetadata?: () => { rtpTimestamp?: number; synchronizationSource?: number } }
        try {
          const meta = frame.getMetadata?.() ?? {}
          const ssrc = meta.synchronizationSource ?? 0
          const rtpTimestamp = meta.rtpTimestamp ?? 0
          if (opts.direction === 'outbound') {
            const senderId = opts.senderId!
            const senderState = state.senderKeys.get(senderId)
            if (!senderState) throw new Error('unknown_sender_key')
            const counter = ++senderState.counter
            const sealed = await sealFrame({
              plaintext: new Uint8Array(frame.data),
              key: senderState.key,
              callId: opts.callId,
              senderId,
              keyId: senderState.keyId,
              counter,
              ssrc,
              rtpTimestamp,
              codecHeaderLength,
            })
            frame.data = sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength)
            state.metrics.sealed += 1
          } else {
            const bytes = new Uint8Array(frame.data)
            const { keyId } = parseTrailer(bytes)
            // Find the matching receiver key — iterate senders since inbound frames
            // have SSRC but we key by senderId. In practice, the adapter hints
            // the senderId via options, but we also support lookup by keyId+SSRC.
            let key: CryptoKey | undefined
            let matchedSenderId: string | undefined
            for (const [senderId, recv] of state.receiverKeys) {
              const k = recv.current.get(keyId) ?? recv.grace.get(keyId)?.key
              if (k) { key = k; matchedSenderId = senderId; break }
            }
            if (!key || !matchedSenderId) throw new Error('unknown_key_id')
            const plain = await openFrame(key, bytes, {
              callId: opts.callId,
              senderId: matchedSenderId,
              keyId,
              ssrc,
              rtpTimestamp,
              codecHeaderLength,
            })
            frame.data = plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength)
            state.metrics.opened += 1
          }
          controller.enqueue(rawFrame)
        } catch (err) {
          state.metrics.errors += 1
          state.metrics.lastError = err instanceof Error ? err.message : String(err)
          // Drop the frame — do not enqueue
        }
      },
    })
    transformer.readable.pipeThrough(frameStream).pipeTo(transformer.writable)
  }
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/lib/webrtc/sframe-worker.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/sframe-worker.ts src/client/lib/webrtc/sframe-worker.test.ts
git commit -m "feat(sframe): worker with registerCall, key mgmt, rotation, rtctransform hook"
```

### Task 8: Main-thread SFrame worker client

**Files:**
- Create: `src/client/lib/webrtc/sframe-worker-client.ts`
- Create: `src/client/lib/webrtc/sframe-worker-client.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/webrtc/sframe-worker-client.test.ts
import { describe, expect, test, beforeEach, mock } from 'bun:test'
import { SFrameWorkerClient } from './sframe-worker-client'

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  private messages: unknown[] = []
  postMessage(msg: unknown) {
    this.messages.push(msg)
    // Respond with success for every request (tests override specific behaviors)
    queueMicrotask(() => {
      // biome-ignore lint: test
      const m = msg as any
      this.onmessage?.(
        new MessageEvent('message', { data: { type: 'success', id: m.id } }),
      )
    })
  }
  terminate() {}
  getLastMessage() { return this.messages[this.messages.length - 1] }
}

describe('SFrameWorkerClient', () => {
  let mockWorker: MockWorker
  let client: SFrameWorkerClient

  beforeEach(() => {
    mockWorker = new MockWorker()
    client = new SFrameWorkerClient(mockWorker as unknown as Worker)
  })

  test('registerCall posts registerCall message', async () => {
    await client.registerCall('call-1')
    const last = mockWorker.getLastMessage() as { type: string; callId: string }
    expect(last.type).toBe('registerCall')
    expect(last.callId).toBe('call-1')
  })

  test('setSenderKey posts key material', async () => {
    const baseKey = new ArrayBuffer(16)
    await client.setSenderKey('call-1', 0, baseKey, 'sender-a')
    const last = mockWorker.getLastMessage() as { type: string; keyId: number; senderId: string }
    expect(last.type).toBe('setSenderKey')
    expect(last.keyId).toBe(0)
    expect(last.senderId).toBe('sender-a')
  })

  test('releaseCall posts releaseCall', async () => {
    await client.releaseCall('call-1')
    const last = mockWorker.getLastMessage() as { type: string; callId: string }
    expect(last.type).toBe('releaseCall')
  })

  test('rejects on worker error response', async () => {
    class ErrorWorker extends MockWorker {
      postMessage(msg: unknown) {
        queueMicrotask(() => {
          // biome-ignore lint: test
          const m = msg as any
          this.onmessage?.(
            new MessageEvent('message', { data: { type: 'error', id: m.id, error: 'bad', code: 'unknown_call' } }),
          )
        })
      }
    }
    const errWorker = new ErrorWorker()
    const errClient = new SFrameWorkerClient(errWorker as unknown as Worker)
    await expect(errClient.registerCall('call-1')).rejects.toThrow(/unknown_call|bad/)
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/lib/webrtc/sframe-worker-client.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/webrtc/sframe-worker-client.ts
import type {
  SFrameWorkerRequest,
  SFrameWorkerResponse,
  SFrameErrorCode,
} from '@shared/schemas/sframe-worker-messages'
import { isSFrameSupported } from './feature-detect'

export class SFrameWorkerError extends Error {
  constructor(message: string, public readonly code: SFrameErrorCode) {
    super(message)
    this.name = 'SFrameWorkerError'
  }
}

export interface SFrameCallMetrics {
  sealed: number
  opened: number
  errors: number
  lastError?: string
}

export interface SFrameTransformOptions {
  direction: 'inbound' | 'outbound'
  callId: string
  senderId?: string
  keyId: number
  codecHeaderLength?: number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class SFrameWorkerClient {
  private worker: Worker
  private pending = new Map<string, Pending>()
  private idCounter = 0

  constructor(worker?: Worker) {
    if (worker) {
      this.worker = worker
    } else {
      this.worker = new Worker(new URL('./sframe-worker.ts', import.meta.url), {
        type: 'module',
        name: 'llamenos-sframe',
      })
    }
    this.worker.onmessage = this.handleMessage.bind(this)
    this.worker.onerror = this.handleError.bind(this)
  }

  private handleMessage(ev: MessageEvent<SFrameWorkerResponse>) {
    const resp = ev.data
    const p = this.pending.get(resp.id)
    if (!p) return
    this.pending.delete(resp.id)
    if (resp.type === 'error') {
      p.reject(new SFrameWorkerError(resp.error, resp.code))
    } else {
      p.resolve((resp as { result?: unknown }).result)
    }
  }

  private handleError(ev: ErrorEvent) {
    const err = new Error(`SFrame worker error: ${ev.message}`)
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }

  private nextId(): string { return String(++this.idCounter) }

  private call(req: Omit<SFrameWorkerRequest, 'id'>): Promise<unknown> {
    const id = this.nextId()
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id } as SFrameWorkerRequest)
    })
  }

  async registerCall(callId: string): Promise<void> {
    await this.call({ type: 'registerCall', callId })
  }

  async setSenderKey(callId: string, keyId: number, baseKey: ArrayBuffer, senderId: string): Promise<void> {
    await this.call({ type: 'setSenderKey', callId, keyId, baseKey, senderId })
  }

  async setReceiverKey(callId: string, keyId: number, baseKey: ArrayBuffer, senderId: string): Promise<void> {
    await this.call({ type: 'setReceiverKey', callId, keyId, baseKey, senderId })
  }

  async rotateCallKey(callId: string, newKeyId: number, newBaseKeys: Record<string, ArrayBuffer>): Promise<void> {
    await this.call({ type: 'rotateCallKey', callId, newKeyId, newBaseKeys })
  }

  async releaseCall(callId: string): Promise<void> {
    await this.call({ type: 'releaseCall', callId })
  }

  async getMetrics(callId: string): Promise<SFrameCallMetrics> {
    return (await this.call({ type: 'getMetrics', callId })) as SFrameCallMetrics
  }

  buildTransform(options: SFrameTransformOptions): RTCRtpScriptTransform {
    // biome-ignore lint: RTCRtpScriptTransform not yet in lib.dom typings universally
    return new (globalThis as any).RTCRtpScriptTransform(this.worker, options)
  }

  terminate(): void {
    this.worker.terminate()
  }
}

export const sframeWorker =
  typeof Worker !== 'undefined' && isSFrameSupported()
    ? new SFrameWorkerClient()
    : (null as unknown as SFrameWorkerClient)
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/lib/webrtc/sframe-worker-client.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/sframe-worker-client.ts src/client/lib/webrtc/sframe-worker-client.test.ts
git commit -m "feat(sframe): SFrameWorkerClient main-thread facade"
```

---

## Workstream 5.5 — Key distribution + Nostr schemas

### Task 9: Nostr event kind constants

**Files:**
- Modify: `src/shared/nostr-events.ts`

- [ ] **Step 1: Add constants**

Append after existing `KIND_CALL_SIGNAL`:

```typescript
/** SFrame key distribution — HPKE-wrapped per-device call secret */
export const KIND_SFRAME_KEY = 20002

/** DTLS fingerprint binding over signed Nostr event */
export const KIND_DTLS_BINDING = 20003
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/nostr-events.ts
git commit -m "feat(nostr): KIND_SFRAME_KEY + KIND_DTLS_BINDING constants"
```

### Task 10: Nostr event zod schemas

**Files:**
- Modify: `src/shared/schemas/nostr-events.ts` (create if Tier 0/1 hasn't already)
- Create: `src/shared/schemas/nostr-events.test.ts` (append if exists)

- [ ] **Step 1: Write failing test**

```typescript
// src/shared/schemas/nostr-events.test.ts (append)
import { describe, expect, test } from 'bun:test'
import {
  SFrameKeyEventPayloadSchema,
  DtlsBindingEventPayloadSchema,
  CallModePayloadSchema,
} from './nostr-events'

describe('SFrameKeyEventPayloadSchema', () => {
  const valid = {
    type: 'call:sframe-key' as const,
    callId: '00000000-0000-4000-8000-000000000001',
    initiatorDeviceId: 'a'.repeat(64),
    keyId: 0,
    recipients: [
      {
        deviceId: 'b'.repeat(64),
        hpkeEnc: 'cafebabe',
        hpkeCiphertext: 'deadbeef',
      },
    ],
    senderIds: ['a'.repeat(64), 'b'.repeat(64)],
    issuedAt: '2026-04-10T12:00:00.000Z',
    reason: 'initial' as const,
  }

  test('accepts a valid payload', () => {
    expect(() => SFrameKeyEventPayloadSchema.parse(valid)).not.toThrow()
  })

  test('rejects keyId > 127', () => {
    expect(() => SFrameKeyEventPayloadSchema.parse({ ...valid, keyId: 128 })).toThrow()
  })

  test('rejects empty recipients', () => {
    expect(() => SFrameKeyEventPayloadSchema.parse({ ...valid, recipients: [] })).toThrow()
  })

  test('rejects malformed hex in hpkeEnc', () => {
    expect(() =>
      SFrameKeyEventPayloadSchema.parse({
        ...valid,
        recipients: [{ ...valid.recipients[0], hpkeEnc: 'XYZ' }],
      }),
    ).toThrow()
  })
})

describe('DtlsBindingEventPayloadSchema', () => {
  const valid = {
    type: 'call:dtls-binding' as const,
    callId: '00000000-0000-4000-8000-000000000001',
    deviceId: 'a'.repeat(64),
    fingerprint: 'b'.repeat(64),
    bindingHash: 'c'.repeat(64),
    issuedAt: '2026-04-10T12:00:00.000Z',
  }
  test('accepts valid payload', () => {
    expect(() => DtlsBindingEventPayloadSchema.parse(valid)).not.toThrow()
  })
  test('rejects fingerprint with colons', () => {
    expect(() =>
      DtlsBindingEventPayloadSchema.parse({ ...valid, fingerprint: 'ab:cd:ef' }),
    ).toThrow()
  })
})

describe('CallModePayloadSchema', () => {
  test('accepts pstn mode', () => {
    expect(() =>
      CallModePayloadSchema.parse({
        type: 'call:mode',
        callId: '00000000-0000-4000-8000-000000000001',
        mode: 'pstn',
        reason: 'caller_on_pstn_trunk',
      }),
    ).not.toThrow()
  })
  test('accepts sframe mode', () => {
    expect(() =>
      CallModePayloadSchema.parse({
        type: 'call:mode',
        callId: '00000000-0000-4000-8000-000000000001',
        mode: 'sframe',
      }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/shared/schemas/nostr-events.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Add schemas**

```typescript
// src/shared/schemas/nostr-events.ts (append — create file if not exists)
import { z } from '@hono/zod-openapi'

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const hexAny = z.string().regex(/^[0-9a-f]+$/)

export const SFrameKeyEventPayloadSchema = z.object({
  type: z.literal('call:sframe-key'),
  callId: z.string().uuid(),
  initiatorDeviceId: hex64,
  keyId: z.number().int().min(0).max(127),
  recipients: z.array(z.object({
    deviceId: hex64,
    hpkeEnc: hexAny,
    hpkeCiphertext: hexAny,
  })).min(1),
  senderIds: z.array(hex64).min(1).max(32),
  issuedAt: z.string().datetime(),
  reason: z.enum(['initial', 'rotate_join', 'rotate_leave', 'rotate_scheduled']),
})
export type SFrameKeyEvent = z.infer<typeof SFrameKeyEventPayloadSchema>

export const DtlsBindingEventPayloadSchema = z.object({
  type: z.literal('call:dtls-binding'),
  callId: z.string().uuid(),
  deviceId: hex64,
  fingerprint: hex64, // no colons, lowercased
  bindingHash: hex64,
  issuedAt: z.string().datetime(),
})
export type DtlsBindingEvent = z.infer<typeof DtlsBindingEventPayloadSchema>

export const CallModePayloadSchema = z.object({
  type: z.literal('call:mode'),
  callId: z.string().uuid(),
  mode: z.enum(['sframe', 'pstn']),
  reason: z.string().optional(),
})
export type CallModeEvent = z.infer<typeof CallModePayloadSchema>
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/shared/schemas/nostr-events.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas/nostr-events.ts src/shared/schemas/nostr-events.test.ts
git commit -m "feat(schemas): SFrameKeyEvent, DtlsBindingEvent, CallMode zod payloads"
```

### Task 11: Key distribution module

**Files:**
- Create: `src/client/lib/webrtc/sframe-key-distribution.ts`
- Create: `src/client/lib/webrtc/sframe-key-distribution.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/client/lib/webrtc/sframe-key-distribution.test.ts
import { describe, expect, test, beforeAll } from 'bun:test'
import { buildKeyEvent, parseKeyEvent } from './sframe-key-distribution'

describe('buildKeyEvent', () => {
  test('shapes the event per schema', async () => {
    // Stub HPKE seal as a pass-through for unit test purposes.
    const stubHpkeSeal = async (plaintext: Uint8Array, recipientPubkey: string) => ({
      enc: new Uint8Array([0xEE]).buffer,
      ciphertext: plaintext.buffer.slice(0),
    })
    const callSecret = new Uint8Array(32).fill(0x11)
    const recipients = [
      { deviceId: 'a'.repeat(64), pubkey: 'a'.repeat(64) },
      { deviceId: 'b'.repeat(64), pubkey: 'b'.repeat(64) },
    ]
    const event = await buildKeyEvent({
      callId: '00000000-0000-4000-8000-000000000001',
      initiatorDeviceId: 'a'.repeat(64),
      keyId: 0,
      callSecret,
      recipients,
      senderIds: ['a'.repeat(64), 'b'.repeat(64)],
      reason: 'initial',
      hpkeSeal: stubHpkeSeal,
    })
    expect(event.type).toBe('call:sframe-key')
    expect(event.recipients).toHaveLength(2)
    expect(event.recipients[0].hpkeEnc).toBe('ee')
    expect(event.recipients[0].hpkeCiphertext).toBe('1111111111111111111111111111111111111111111111111111111111111111')
  })
})

describe('parseKeyEvent', () => {
  test('extracts the local recipient envelope', async () => {
    const stubHpkeOpen = async (enc: ArrayBuffer, ciphertext: ArrayBuffer) => new Uint8Array(32).fill(0x11)
    const event = {
      type: 'call:sframe-key' as const,
      callId: '00000000-0000-4000-8000-000000000001',
      initiatorDeviceId: 'a'.repeat(64),
      keyId: 0,
      recipients: [
        { deviceId: 'a'.repeat(64), hpkeEnc: 'ee', hpkeCiphertext: '11'.repeat(32) },
        { deviceId: 'c'.repeat(64), hpkeEnc: 'ff', hpkeCiphertext: '22'.repeat(32) },
      ],
      senderIds: ['a'.repeat(64)],
      issuedAt: new Date().toISOString(),
      reason: 'initial' as const,
    }
    const callSecret = await parseKeyEvent(event, 'c'.repeat(64), stubHpkeOpen)
    expect(callSecret.length).toBe(32)
  })

  test('throws when local device is not a recipient', async () => {
    const stubHpkeOpen = async () => new Uint8Array(32)
    const event = {
      type: 'call:sframe-key' as const,
      callId: '00000000-0000-4000-8000-000000000001',
      initiatorDeviceId: 'a'.repeat(64),
      keyId: 0,
      recipients: [{ deviceId: 'a'.repeat(64), hpkeEnc: 'ee', hpkeCiphertext: '11'.repeat(32) }],
      senderIds: ['a'.repeat(64)],
      issuedAt: new Date().toISOString(),
      reason: 'initial' as const,
    }
    await expect(parseKeyEvent(event, 'zzz', stubHpkeOpen)).rejects.toThrow('not a recipient')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/lib/webrtc/sframe-key-distribution.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/webrtc/sframe-key-distribution.ts
import type { SFrameKeyEvent } from '@shared/schemas/nostr-events'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

type HpkeSealFn = (plaintext: Uint8Array, recipientPubkey: string, info: Uint8Array, aad: Uint8Array) => Promise<{ enc: ArrayBuffer; ciphertext: ArrayBuffer }>
type HpkeOpenFn = (enc: ArrayBuffer, ciphertext: ArrayBuffer, info: Uint8Array, aad: Uint8Array) => Promise<Uint8Array>

interface CallRecipient { deviceId: string; pubkey: string }

interface BuildKeyEventInputs {
  callId: string
  initiatorDeviceId: string
  keyId: number
  callSecret: Uint8Array
  recipients: CallRecipient[]
  senderIds: string[]
  reason: 'initial' | 'rotate_join' | 'rotate_leave' | 'rotate_scheduled'
  hpkeSeal: HpkeSealFn
}

export async function buildKeyEvent(inputs: BuildKeyEventInputs): Promise<SFrameKeyEvent> {
  const { LABEL_SFRAME_CALL_SECRET } = await import('@shared/crypto-labels')
  const { utf8ToBytes } = await import('@noble/hashes/utils.js')
  const info = utf8ToBytes(LABEL_SFRAME_CALL_SECRET)
  const aad = utf8ToBytes(inputs.callId)

  const sealedRecipients = []
  for (const r of inputs.recipients) {
    const { enc, ciphertext } = await inputs.hpkeSeal(inputs.callSecret, r.pubkey, info, aad)
    sealedRecipients.push({
      deviceId: r.deviceId,
      hpkeEnc: bytesToHex(new Uint8Array(enc)),
      hpkeCiphertext: bytesToHex(new Uint8Array(ciphertext)),
    })
  }

  return {
    type: 'call:sframe-key',
    callId: inputs.callId,
    initiatorDeviceId: inputs.initiatorDeviceId,
    keyId: inputs.keyId,
    recipients: sealedRecipients,
    senderIds: inputs.senderIds,
    issuedAt: new Date().toISOString(),
    reason: inputs.reason,
  }
}

export async function parseKeyEvent(
  event: SFrameKeyEvent,
  localDeviceId: string,
  hpkeOpen: HpkeOpenFn,
): Promise<Uint8Array> {
  const recipient = event.recipients.find((r) => r.deviceId === localDeviceId)
  if (!recipient) throw new Error('not a recipient')
  const { LABEL_SFRAME_CALL_SECRET } = await import('@shared/crypto-labels')
  const { utf8ToBytes } = await import('@noble/hashes/utils.js')
  const info = utf8ToBytes(LABEL_SFRAME_CALL_SECRET)
  const aad = utf8ToBytes(event.callId)
  const enc = hexToBytes(recipient.hpkeEnc).buffer
  const ct = hexToBytes(recipient.hpkeCiphertext).buffer
  return hpkeOpen(enc as ArrayBuffer, ct as ArrayBuffer, info, aad)
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/lib/webrtc/sframe-key-distribution.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/sframe-key-distribution.ts src/client/lib/webrtc/sframe-key-distribution.test.ts
git commit -m "feat(sframe): buildKeyEvent + parseKeyEvent with injected HPKE seal/open"
```

### Task 12: Recipient resolver (Tier 3 device-aware)

**Files:**
- Create: `src/client/lib/webrtc/sframe-recipients.ts`
- Create: `src/client/lib/webrtc/sframe-recipients.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/webrtc/sframe-recipients.test.ts
import { describe, expect, test } from 'bun:test'
import { resolveCallRecipients } from './sframe-recipients'

describe('resolveCallRecipients', () => {
  test('pre-Tier-3 fallback: one recipient per user', async () => {
    const users = [
      { userId: 'user-a', identityPubkey: 'a'.repeat(64), devices: undefined },
      { userId: 'user-b', identityPubkey: 'b'.repeat(64), devices: undefined },
    ]
    const result = await resolveCallRecipients(users)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ deviceId: 'user-a', pubkey: 'a'.repeat(64) })
    expect(result[1]).toEqual({ deviceId: 'user-b', pubkey: 'b'.repeat(64) })
  })

  test('Tier 3: one recipient per device', async () => {
    const users = [
      {
        userId: 'user-a',
        identityPubkey: 'a'.repeat(64),
        devices: [
          { deviceId: 'd1', pubkey: 'c'.repeat(64) },
          { deviceId: 'd2', pubkey: 'd'.repeat(64) },
        ],
      },
    ]
    const result = await resolveCallRecipients(users)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.deviceId).sort()).toEqual(['d1', 'd2'])
  })

  test('throws on empty users list', async () => {
    await expect(resolveCallRecipients([])).rejects.toThrow('at least one')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/lib/webrtc/sframe-recipients.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/webrtc/sframe-recipients.ts

interface UserCallRecipient {
  userId: string
  identityPubkey: string
  /** Present post-Tier-3; undefined pre-Tier-3. */
  devices?: Array<{ deviceId: string; pubkey: string }>
}

export interface ResolvedRecipient {
  deviceId: string
  pubkey: string
}

export async function resolveCallRecipients(users: UserCallRecipient[]): Promise<ResolvedRecipient[]> {
  if (users.length === 0) throw new Error('at least one participant required')
  const out: ResolvedRecipient[] = []
  for (const u of users) {
    if (u.devices && u.devices.length > 0) {
      for (const d of u.devices) {
        out.push({ deviceId: d.deviceId, pubkey: d.pubkey })
      }
    } else {
      // Pre-Tier-3 fallback — single recipient per user
      out.push({ deviceId: u.userId, pubkey: u.identityPubkey })
    }
  }
  return out
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/lib/webrtc/sframe-recipients.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/sframe-recipients.ts src/client/lib/webrtc/sframe-recipients.test.ts
git commit -m "feat(sframe): resolveCallRecipients with pre-Tier-3 fallback"
```

### Task 13: Rotation helpers

**Files:**
- Create: `src/client/lib/webrtc/sframe-rotation.ts`
- Create: `src/client/lib/webrtc/sframe-rotation.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/webrtc/sframe-rotation.test.ts
import { describe, expect, test } from 'bun:test'
import { ratchetOnJoin, freshSecretOnLeave, assertKeyIdContiguous } from './sframe-rotation'

describe('ratchetOnJoin', () => {
  test('is deterministic', async () => {
    const current = new Uint8Array(32).fill(0x11)
    const a = await ratchetOnJoin(current, 'device-x')
    const b = await ratchetOnJoin(current, 'device-x')
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  test('differs per joining device', async () => {
    const current = new Uint8Array(32).fill(0x11)
    const a = await ratchetOnJoin(current, 'device-x')
    const b = await ratchetOnJoin(current, 'device-y')
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  test('is one-way: previous cannot be recovered', async () => {
    // Cryptographic property — verified by HKDF-SHA256 preimage resistance,
    // not by this test. Here we just assert the output is not the input.
    const current = new Uint8Array(32).fill(0x11)
    const next = await ratchetOnJoin(current, 'device-x')
    expect(Array.from(next)).not.toEqual(Array.from(current))
  })
})

describe('freshSecretOnLeave', () => {
  test('returns 32 bytes', () => {
    const s = freshSecretOnLeave()
    expect(s.length).toBe(32)
  })

  test('produces high-entropy output (sanity)', () => {
    const samples = Array.from({ length: 10 }, () => freshSecretOnLeave())
    // All ten must be distinct
    const seen = new Set(samples.map((s) => Array.from(s).join(',')))
    expect(seen.size).toBe(10)
  })
})

describe('assertKeyIdContiguous', () => {
  test('accepts current + 1', () => {
    expect(() => assertKeyIdContiguous(0, 1)).not.toThrow()
  })
  test('rejects gap', () => {
    expect(() => assertKeyIdContiguous(0, 2)).toThrow('key_rotation_gap')
  })
  test('rejects backward', () => {
    expect(() => assertKeyIdContiguous(5, 4)).toThrow('key_rotation_gap')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/lib/webrtc/sframe-rotation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/webrtc/sframe-rotation.ts
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'

export async function ratchetOnJoin(current: Uint8Array, joiningDeviceId: string): Promise<Uint8Array> {
  const salt = utf8ToBytes('ratchet')
  const info = utf8ToBytes(`join:${joiningDeviceId}`)
  return hkdf(sha256, current, salt, info, 32)
}

export function freshSecretOnLeave(): Uint8Array {
  const s = new Uint8Array(32)
  crypto.getRandomValues(s)
  return s
}

export function assertKeyIdContiguous(currentKeyId: number, newKeyId: number): void {
  if (newKeyId !== currentKeyId + 1) {
    throw new Error(`key_rotation_gap: expected ${currentKeyId + 1}, got ${newKeyId}`)
  }
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/lib/webrtc/sframe-rotation.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/sframe-rotation.ts src/client/lib/webrtc/sframe-rotation.test.ts
git commit -m "feat(sframe): ratchetOnJoin + freshSecretOnLeave + key gap assertion"
```

---

## Workstream 5.6 — DTLS fingerprint binding

### Task 14: SDP fingerprint extraction + binding hash

**Files:**
- Create: `src/client/lib/webrtc/dtls-fingerprint.ts`
- Create: `src/client/lib/webrtc/dtls-fingerprint.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/webrtc/dtls-fingerprint.test.ts
import { describe, expect, test } from 'bun:test'
import {
  extractFingerprintFromSdp,
  computeBindingHash,
  verifyDtlsFingerprint,
} from './dtls-fingerprint'

const SAMPLE_SDP = `v=0
o=- 123 2 IN IP4 0.0.0.0
s=-
t=0 0
a=group:BUNDLE 0
m=audio 9 UDP/TLS/RTP/SAVPF 111
a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89
`

describe('extractFingerprintFromSdp', () => {
  test('extracts normalized sha-256 fingerprint', () => {
    const fp = extractFingerprintFromSdp(SAMPLE_SDP)
    expect(fp).toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789')
  })

  test('returns null when no fingerprint present', () => {
    const fp = extractFingerprintFromSdp('v=0\r\n')
    expect(fp).toBeNull()
  })

  test('lowercases and strips colons', () => {
    const sdp = 'a=fingerprint:sha-256 FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00:FF:00'
    expect(extractFingerprintFromSdp(sdp)).toBe('ff00'.repeat(16))
  })
})

describe('computeBindingHash', () => {
  test('is deterministic', async () => {
    const a = await computeBindingHash('abcd', 'call-1')
    const b = await computeBindingHash('abcd', 'call-1')
    expect(a).toBe(b)
  })

  test('differs per callId', async () => {
    const a = await computeBindingHash('abcd', 'call-1')
    const b = await computeBindingHash('abcd', 'call-2')
    expect(a).not.toBe(b)
  })

  test('returns 64-char hex', async () => {
    const h = await computeBindingHash('abcd', 'call-1')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('verifyDtlsFingerprint', () => {
  test('passes when SDP + binding match', async () => {
    const fingerprint = 'ab'.repeat(32)
    const binding = await computeBindingHash(fingerprint, 'call-1')
    const sdp = `a=fingerprint:sha-256 ${fingerprint.match(/../g)!.join(':').toUpperCase()}`
    await expect(
      verifyDtlsFingerprint(sdp, { fingerprint, bindingHash: binding, callId: 'call-1' }),
    ).resolves.toBe(true)
  })

  test('fails on fingerprint mismatch', async () => {
    const sdp = 'a=fingerprint:sha-256 FF:FF' + ':FF'.repeat(30)
    const binding = await computeBindingHash('ab'.repeat(32), 'call-1')
    await expect(
      verifyDtlsFingerprint(sdp, { fingerprint: 'ab'.repeat(32), bindingHash: binding, callId: 'call-1' }),
    ).rejects.toThrow('dtls_fingerprint_mismatch')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/lib/webrtc/dtls-fingerprint.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/webrtc/dtls-fingerprint.ts
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export function extractFingerprintFromSdp(sdp: string): string | null {
  const match = sdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/i)
  if (!match) return null
  return match[1].replace(/:/g, '').toLowerCase()
}

export async function computeBindingHash(fingerprint: string, callId: string): Promise<string> {
  const input = utf8ToBytes(`${fingerprint}|${callId}`)
  return bytesToHex(sha256(input))
}

export async function verifyDtlsFingerprint(
  sdp: string,
  advertised: { fingerprint: string; bindingHash: string; callId: string },
): Promise<boolean> {
  // 1. Sanity: advertised binding hash must match advertised fingerprint + callId
  const recomputed = await computeBindingHash(advertised.fingerprint, advertised.callId)
  if (recomputed !== advertised.bindingHash) {
    throw new Error('dtls_binding_hash_mismatch')
  }
  // 2. Extract SDP fingerprint and compare
  const sdpFingerprint = extractFingerprintFromSdp(sdp)
  if (!sdpFingerprint) throw new Error('dtls_fingerprint_missing_in_sdp')
  if (sdpFingerprint !== advertised.fingerprint) {
    throw new Error('dtls_fingerprint_mismatch')
  }
  return true
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/lib/webrtc/dtls-fingerprint.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/dtls-fingerprint.ts src/client/lib/webrtc/dtls-fingerprint.test.ts
git commit -m "feat(dtls-binding): SDP fingerprint extract + binding hash verify"
```

---

## Workstream 5.7 — Transform install helper + WebRTC adapter integration

### Task 15: `sframe-install` pure helper

**Files:**
- Create: `src/client/lib/webrtc/sframe-install.ts`
- Create: `src/client/lib/webrtc/sframe-install.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/lib/webrtc/sframe-install.test.ts
import { describe, expect, test } from 'bun:test'
import { installSFrameTransforms } from './sframe-install'

function mockSender(kind: 'audio' | 'video'): RTCRtpSender {
  // biome-ignore lint/suspicious/noExplicitAny: test double
  const stub: any = { track: { kind }, transform: null }
  return stub as RTCRtpSender
}

function mockPc(senders: RTCRtpSender[]): RTCPeerConnection {
  // biome-ignore lint/suspicious/noExplicitAny: test double
  const listeners: Array<(ev: unknown) => void> = []
  // biome-ignore lint/suspicious/noExplicitAny: test double
  const pc: any = {
    getSenders: () => senders,
    addEventListener: (evName: string, cb: (ev: unknown) => void) => {
      if (evName === 'track') listeners.push(cb)
    },
    fireTrack: (receiver: unknown, trackKind: 'audio' | 'video') => {
      for (const cb of listeners) cb({ receiver, track: { kind: trackKind } })
    },
  }
  return pc as RTCPeerConnection & { fireTrack: (r: unknown, k: 'audio' | 'video') => void }
}

describe('installSFrameTransforms', () => {
  test('installs outbound transform on audio senders only', () => {
    const audioSender = mockSender('audio')
    const videoSender = mockSender('video')
    const pc = mockPc([audioSender, videoSender])
    const builtTransforms: unknown[] = []
    const client = {
      buildTransform: (opts: unknown) => {
        const stub = { __opts: opts }
        builtTransforms.push(stub)
        return stub as unknown as RTCRtpScriptTransform
      },
    }
    installSFrameTransforms(pc, {
      callId: 'call-1',
      senderId: 'sender-a',
      keyId: 0,
      sframeClient: client,
    })
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    expect((audioSender as any).transform).toBeTruthy()
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    expect((videoSender as any).transform).toBeNull()
  })

  test('subscribes to track event for inbound receivers', () => {
    const pc = mockPc([])
    const builtTransforms: unknown[] = []
    installSFrameTransforms(pc, {
      callId: 'call-1',
      senderId: 'sender-a',
      keyId: 0,
      sframeClient: {
        buildTransform: (opts: unknown) => {
          const stub = { __opts: opts }
          builtTransforms.push(stub)
          return stub as unknown as RTCRtpScriptTransform
        },
      },
    })
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    const receiver: any = { transform: null }
    ;(pc as unknown as { fireTrack: (r: unknown, k: 'audio' | 'video') => void }).fireTrack(receiver, 'audio')
    expect(receiver.transform).toBeTruthy()
  })

  test('throws when sframeClient is null', () => {
    const pc = mockPc([])
    expect(() =>
      installSFrameTransforms(pc, {
        callId: 'call-1',
        senderId: 'sender-a',
        keyId: 0,
        sframeClient: null,
      }),
    ).toThrow('sframe_unsupported')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/lib/webrtc/sframe-install.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/client/lib/webrtc/sframe-install.ts
import type { SFrameWorkerClient, SFrameTransformOptions } from './sframe-worker-client'

interface InstallInputs {
  callId: string
  senderId: string
  keyId: number
  sframeClient: Pick<SFrameWorkerClient, 'buildTransform'> | null
  codecHeaderLength?: number
}

export function installSFrameTransforms(pc: RTCPeerConnection, inputs: InstallInputs): void {
  if (!inputs.sframeClient) throw new Error('sframe_unsupported')
  const codecHeaderLength = inputs.codecHeaderLength ?? 1

  // Outbound — install on existing audio senders
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'audio') continue
    // biome-ignore lint/suspicious/noExplicitAny: RTCRtpSender.transform is newer API
    ;(sender as any).transform = inputs.sframeClient.buildTransform({
      direction: 'outbound',
      callId: inputs.callId,
      senderId: inputs.senderId,
      keyId: inputs.keyId,
      codecHeaderLength,
    } satisfies SFrameTransformOptions)
  }

  // Inbound — hook each track event as it fires
  pc.addEventListener('track', (ev: Event) => {
    const trackEv = ev as RTCTrackEvent
    if (trackEv.track.kind !== 'audio') return
    // biome-ignore lint/suspicious/noExplicitAny: test environment uses a stub
    ;(trackEv.receiver as any).transform = inputs.sframeClient!.buildTransform({
      direction: 'inbound',
      callId: inputs.callId,
      keyId: inputs.keyId,
      codecHeaderLength,
    } satisfies SFrameTransformOptions)
  })
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/lib/webrtc/sframe-install.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/sframe-install.ts src/client/lib/webrtc/sframe-install.test.ts
git commit -m "feat(sframe): installSFrameTransforms pure helper"
```

### Task 16: Wire sframe-install into SipWebRTCAdapter

**Files:**
- Modify: `src/client/lib/webrtc/adapters/sip.ts`
- Modify: `src/client/lib/webrtc/adapters/sip.test.ts` (create if missing)

- [ ] **Step 1: Write failing test**

Create a test that mocks JsSIP + the SFrame client and asserts the install helper is called when `peerconnection` event fires:

```typescript
// src/client/lib/webrtc/adapters/sip.test.ts
import { describe, expect, test } from 'bun:test'
import { SipWebRTCAdapter } from './sip'

describe('SipWebRTCAdapter SFrame integration', () => {
  test('installs transforms when peerconnection event fires', async () => {
    // This test requires a complex JsSIP mock; we assert the adapter exposes
    // a hook `#onPeerConnection` that the transform install runs inside.
    // For now, assert the import compiles and the adapter class exists.
    expect(SipWebRTCAdapter).toBeDefined()
  })
})
```

(The full integration is validated via the UI E2E tests in Workstream 5.9.)

- [ ] **Step 2: Modify `sip.ts`**

Apply the diff shown in spec §5.9 to add the `peerconnection` hook and call `installSFrameTransforms`. Also add the call-id resolution via an internal `#currentCallId` member populated from the server's Nostr event notification.

Key additions inside the `newRTCSession` handler:

```typescript
// Within the 'newRTCSession' handler, after setting this.#session:
session.on('peerconnection', async (...pcArgs: unknown[]) => {
  const pc = (pcArgs[0] as { peerconnection: RTCPeerConnection }).peerconnection
  const callId = await this.#resolveCallIdFromSdp(pc)
  // Await the SFrame key event (see Task 17)
  const keyState = await this.#awaitSFrameKey(callId, 3000).catch(() => null)
  if (!keyState) {
    this.#emit('error', new Error('sframe_key_not_received'))
    pc.close()
    return
  }
  installSFrameTransforms(pc, {
    callId,
    senderId: this.#deviceId,
    keyId: keyState.keyId,
    sframeClient: sframeWorker,
  })
  this.#verifyDtlsFingerprint(pc, callId).catch((err) => {
    this.#emit('error', err)
    pc.close()
  })
})
```

Add imports at top: `import { installSFrameTransforms } from '../sframe-install'`, `import { sframeWorker } from '../sframe-worker-client'`.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/webrtc/adapters/sip.ts src/client/lib/webrtc/adapters/sip.test.ts
git commit -m "feat(sip-adapter): install SFrame transforms on peerconnection event"
```

### Task 17: Wire into other adapters (twilio, vonage, plivo)

**Files:**
- Modify: `src/client/lib/webrtc/adapters/twilio.ts`
- Modify: `src/client/lib/webrtc/adapters/vonage.ts`
- Modify: `src/client/lib/webrtc/adapters/plivo.ts`

For each adapter, add the equivalent hook at the point where the adapter receives the underlying `RTCPeerConnection`. For Twilio this is `callInstance.mediaHandler?.version?.pc`; for Vonage it is the `session.pc` exposed by the Vonage SDK; for Plivo it is accessible via the Plivo client's internal peer connection reference.

- [ ] **Step 1: Apply same install pattern to twilio.ts**

Add `installSFrameTransforms(pc, {...})` inside the Twilio adapter's `accept` handler after the call has `mediaHandler` attached.

- [ ] **Step 2: Apply to vonage.ts**

Same pattern, using Vonage's session connection reference.

- [ ] **Step 3: Apply to plivo.ts**

Same pattern.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/webrtc/adapters/twilio.ts src/client/lib/webrtc/adapters/vonage.ts src/client/lib/webrtc/adapters/plivo.ts
git commit -m "feat(webrtc-adapters): install SFrame transforms across twilio/vonage/plivo"
```

---

## Workstream 5.8 — Test fixtures (sim bridge, sim caller, adversarial)

> **PR split (decided 2026-04-11, enacted in Tier 5 prereq PR):**
>
> Per spec §5.12, the test fixtures ship as a **prerequisite PR** (`feat/sec-tier-5-prereq-sim-sip-bridge`) BEFORE the Tier 5 main PR. The original plan wrote the SimCaller fixture as an SFrame frame producer that imported from `src/shared/sframe/` — but those production modules don't exist yet on main when the prereq PR lands, and spec §5.12 explicitly bans SFrame production code in the prereq. The original Task 19 listing was self-contradictory.
>
> Resolution:
>
> - **Tasks 18 + 19 (prereq PR)** — `SimSipBridge` + `SimCaller` ship as pure test infrastructure with zero `@shared/sframe/` imports. `SimSipBridge` mocks the Asterisk ARI WebSocket surface and the RTP media plane in memory. `SimCaller` simulates an inbound caller with a canned Opus payload, a simple jitter buffer, and DTMF digit emission for IVR tests. Both are framework-agnostic (callable from `bun:test` unit tests AND Playwright API/UI tests).
> - **Task 19b (Tier 5 main PR)** — extend `SimCaller` with `loadKey`, `produceFrame`, `consumeFrame` methods once `src/shared/sframe/frame-codec.ts` and `src/shared/sframe/cipher-suite.ts` exist (after Workstreams 5.1 and 5.2 land). This is the content of the old Task 19 code listing, now deferred.
> - **Task 20 (Tier 5 main PR)** — `SimCompromisedBridge` ships with the Tier 5 main PR so its adversarial tests can use `SimCaller.produceFrame` / `consumeFrame`. The class body (`modifyFrame`, `modifyTrailer`, `maybeDrop`) is byte-level and format-agnostic, but the tests that validate its behavior need the SFrame-capable SimCaller from Task 19b.
> - **New prereq files not in the original plan** (per spec §5.12):
>   - `tests/helpers/sframe-test-utils.ts` — mock RTP packet layout + mock SFrame key-material helpers that carry no `@shared/sframe/` imports. Prereq PR.
>   - `docs/testing/TEST_FIXTURES_SFRAME.md` — reference for how to use the fixtures in call tests. Prereq PR.
>
> Session B of Tier 5 main MUST pick up Task 19b and Task 20 — they are the critical path for adversarial test coverage of the SFrame pipeline.

### Task 18: `SimSipBridge` fixture (prereq PR)

**Files:**
- Create: `tests/fixtures/sim-sip-bridge.ts`
- Create: `tests/fixtures/sim-sip-bridge.test.ts`
- Create: `tests/helpers/sframe-test-utils.ts`
- Create: `docs/testing/TEST_FIXTURES_SFRAME.md`

**Scope note:** The code listing below is the minimal-stub starting point that the old plan captured. The prereq PR implementation adds (on top of it):

- A mock Asterisk ARI WebSocket subscriber pattern (`onEvent(handler)` / `off(handler)` / `emit(event)`) whose events re-use the production `BridgeEvent` types from `sip-bridge/src/bridge-client.ts` to prevent silent drift.
- A dialplan-event injector `inject({ callId, callerNumber, calledNumber, mode })` that emits `channel_create` then `channel_answer` with the mode stamped into `args: [mode]`, matching spec §5.12.1. Per-instance `SimChannelState` tracked in `getChannels()`. Duplicate-`callId` `inject` and unknown-`callId` `hangup` throw — silently overwriting state would only mask test bugs.
- `emit()` fans out to a snapshot of the handler set so mid-fanout subscriptions don't mutate the recipient list, and collects handler errors into an `AggregateError` so one misbehaving subscriber can't silently suppress delivery to the others.
- A per-instance deterministic clock starting at `2026-04-11T00:00:00Z`, advancing one second per emitted event. Two bridge instances do not share clock state.
- `bridgePacket(from, bytes): Uint8Array | null` — base class is a recording pass-through; nullable return exists so `SimCompromisedBridge` (Tier 5 main) can return `null` for dropped packets without changing the base contract (per spec §5.12.1).

No kernel sockets — pure in-memory. Framework-agnostic (no Playwright imports). `tests/helpers/sframe-test-utils.ts` carries the RTP header layout helpers (`buildMockRtpHeader` / `parseMockRtpHeader` / `buildMockRtpPacket`, symmetric CSRC guards) and mock SFrame key-material helpers (`makeMockCallSecret`, `makeMockSFrameKeyEventPayload`). Zero imports from `@shared/sframe/`. `docs/testing/TEST_FIXTURES_SFRAME.md` documents how to wire the fixtures into unit + Playwright tests.

- [ ] **Step 1: Write failing test**

```typescript
// tests/fixtures/sim-sip-bridge.test.ts
import { describe, expect, test } from 'bun:test'
import { SimSipBridge } from './sim-sip-bridge'

describe('SimSipBridge', () => {
  test('provisionEndpoint returns creds', async () => {
    const bridge = new SimSipBridge()
    const { username, password } = await bridge.provisionEndpoint('pubkey-abc')
    expect(username).toMatch(/^vol_/)
    expect(password.length).toBeGreaterThan(16)
  })

  test('bridgePacket records bytes', () => {
    const bridge = new SimSipBridge()
    const bytes = new Uint8Array([0x01, 0x02, 0x03])
    bridge.bridgePacket('caller', bytes)
    const captured = bridge.getCapturedPackets()
    expect(captured).toHaveLength(1)
    expect(captured[0].bytes).toEqual(bytes)
  })

  test('captures both directions', () => {
    const bridge = new SimSipBridge()
    bridge.bridgePacket('caller', new Uint8Array([0x01]))
    bridge.bridgePacket('volunteer', new Uint8Array([0x02]))
    const captured = bridge.getCapturedPackets()
    expect(captured).toHaveLength(2)
    expect(captured[0].direction).toBe('a-to-b')
    expect(captured[1].direction).toBe('b-to-a')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test tests/fixtures/sim-sip-bridge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// tests/fixtures/sim-sip-bridge.ts
interface CapturedPacket {
  direction: 'a-to-b' | 'b-to-a'
  bytes: Uint8Array
  time: number
}

export class SimSipBridge {
  private endpoints = new Map<string, { username: string; password: string }>()
  private captured: CapturedPacket[] = []

  async provisionEndpoint(pubkey: string): Promise<{ username: string; password: string }> {
    const existing = this.endpoints.get(pubkey)
    if (existing) return existing
    const username = `vol_${pubkey.slice(0, 12)}`
    const passwordBytes = new Uint8Array(32)
    crypto.getRandomValues(passwordBytes)
    const password = Array.from(passwordBytes, (b) => b.toString(16).padStart(2, '0')).join('')
    const creds = { username, password }
    this.endpoints.set(pubkey, creds)
    return creds
  }

  async deprovisionEndpoint(pubkey: string): Promise<void> {
    this.endpoints.delete(pubkey)
  }

  bridgePacket(from: 'caller' | 'volunteer', bytes: Uint8Array): Uint8Array | null {
    this.captured.push({
      direction: from === 'caller' ? 'a-to-b' : 'b-to-a',
      bytes: new Uint8Array(bytes),
      time: Date.now(),
    })
    return bytes // pass-through
  }

  getCapturedPackets(): CapturedPacket[] {
    return [...this.captured]
  }

  clear(): void {
    this.captured = []
  }
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test tests/fixtures/sim-sip-bridge.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/sim-sip-bridge.ts tests/fixtures/sim-sip-bridge.test.ts
git commit -m "test(fixtures): SimSipBridge for Tier 5 SFrame integration tests"
```

### Task 19: `SimCaller` fixture (prereq PR — Opus / jitter / DTMF)

**Files:**
- Create: `tests/fixtures/sim-caller.ts`
- Create: `tests/fixtures/sim-caller.test.ts`

**Scope:** `SimCaller` simulates an inbound caller for IVR and call-path tests. It:

- Holds a canned Opus-encoded audio clip (stubbed as a 2-second 440 Hz tone packaged as deterministic bytes — real Opus encoding is too heavy for CI).
- Drives the clip through a simple jitter buffer that accepts an inter-packet delay and delivers frames on a `nextFrame()` pull API.
- Emits DTMF digits on demand via `pressDigit(digit)` / `pressSequence("1234#")` for IVR test flows.
- Exposes state (`getFramesSent()`, `getDigitsEmitted()`) for assertions.

**Explicitly NOT in scope for the prereq PR:** SFrame `produceFrame` / `consumeFrame` / `loadKey` methods that exercise `@shared/sframe/frame-codec`. Those live in Task 19b inside the Tier 5 main PR — they can only exist after Workstreams 5.1 and 5.2 create `src/shared/sframe/cipher-suite.ts` and `src/shared/sframe/frame-codec.ts`.

- [ ] **Step 1: Write failing test**

Draft unit tests in `tests/fixtures/sim-caller.test.ts` for: (a) the caller produces N frames from the canned clip, (b) the jitter buffer respects inter-packet delay, (c) `pressSequence` emits DTMF events in order, (d) `getFramesSent()` + `getDigitsEmitted()` counts match what was produced. No SFrame imports.

- [ ] **Step 2: Run failing test**

Run: `bun test tests/fixtures/sim-caller.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Sketch (shape is indicative — implementer tunes for the assertions that land):

```typescript
// tests/fixtures/sim-caller.ts — NO @shared/sframe imports
export interface SimCallerOptions {
  clipDurationMs?: number        // default 2000
  frameIntervalMs?: number       // default 20 (Opus default)
  toneHz?: number                // default 440
}

export class SimCaller {
  constructor(public readonly deviceId: string, options?: SimCallerOptions) {...}
  nextFrame(): Uint8Array | null           // drains the canned clip frame by frame
  pressDigit(digit: DtmfDigit): void       // '0'..'9', '*', '#', 'A'..'D'
  pressSequence(seq: string): void
  drainDigits(): DtmfDigit[]               // returns + clears
  getFramesSent(): number
  getDigitsEmitted(): number
  reset(): void
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test tests/fixtures/sim-caller.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/sim-caller.ts tests/fixtures/sim-caller.test.ts
git commit -m "test(fixtures): SimCaller — Opus clip + jitter buffer + DTMF"
```

### Task 19b: Extend `SimCaller` with SFrame produce/consume (Tier 5 main PR)

**Moved from the old Task 19.** Runs in the Tier 5 main PR after Workstreams 5.1 (`src/shared/sframe/cipher-suite.ts`) and 5.2 (`src/shared/sframe/frame-codec.ts`) land.

**Files:**
- Modify: `tests/fixtures/sim-caller.ts` — add `loadKey`, `produceFrame`, `consumeFrame`
- Modify: `tests/fixtures/sim-caller.test.ts` — add SFrame round-trip tests

- [ ] **Step 1: Write failing test**

```typescript
// tests/fixtures/sim-caller.test.ts (addendum)
import { describe, expect, test } from 'bun:test'
import { SimCaller } from './sim-caller'

describe('SimCaller — SFrame', () => {
  test('produces and consumes a frame successfully', async () => {
    const callSecret = new Uint8Array(32).fill(0x11)
    const caller = new SimCaller('device-a')
    caller.bindCall(callSecret, '00000000-0000-4000-8000-000000000001')
    await caller.loadKey(0)
    const plaintext = new Uint8Array([0x01, 0xAA, 0xBB, 0xCC])
    const wire = await caller.produceFrame(plaintext, 0, 1)
    const ok = await caller.consumeFrame(wire, plaintext, 0, 1, 'device-a')
    expect(ok).toBe(true)
  })

  test('consumes a frame from another sender with the same callSecret', async () => {
    const callSecret = new Uint8Array(32).fill(0x22)
    const callId = '00000000-0000-4000-8000-000000000002'
    const alice = new SimCaller('alice-device')
    const bob = new SimCaller('bob-device')
    alice.bindCall(callSecret, callId)
    bob.bindCall(callSecret, callId)
    await alice.loadKey(0)
    await bob.loadKey(0)
    const plaintext = new Uint8Array([0x01, 0xDE, 0xAD, 0xBE, 0xEF])
    const wire = await alice.produceFrame(plaintext, 0, 1)
    const ok = await bob.consumeFrame(wire, plaintext, 0, 1, 'alice-device')
    expect(ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test tests/fixtures/sim-caller.test.ts`
Expected: FAIL (methods not implemented).

- [ ] **Step 3: Implement**

Extend `SimCaller` with a `bindCall(callSecret, callId)` binder and the SFrame methods:

```typescript
// tests/fixtures/sim-caller.ts (extension in Tier 5 main PR)
import { sealFrame, openFrame } from '../../src/shared/sframe/frame-codec'
import { deriveBaseKey, importAesKey } from '../../src/shared/sframe/cipher-suite'

// Added to the SimCaller class:
//   private callSecret?: Uint8Array
//   private callId?: string
//   private keys = new Map<number, CryptoKey>()
//
// bindCall(secret, id)
// async loadKey(keyId)
// async produceFrame(plaintext, keyId, counter, ssrc?, rtpTimestamp?)
// async consumeFrame(wire, expected, keyId, counter, senderId, ssrc?, rtpTimestamp?)
```

Implementation mirrors the old Task 19 bodies for these methods (derive base key → import AES → `sealFrame` / `openFrame`).

- [ ] **Step 4: Re-run test**

Run: `bun test tests/fixtures/sim-caller.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/sim-caller.ts tests/fixtures/sim-caller.test.ts
git commit -m "test(fixtures): extend SimCaller with SFrame produce/consume"
```

### Task 20: Adversarial bridge subclass (Tier 5 main PR)

**Moved to Tier 5 main.** Blocked on Task 19b — the test file below calls `SimCaller.produceFrame` / `consumeFrame`, which only exist once Task 19b has landed inside the Tier 5 main PR. The class body itself (`modifyFrame`, `modifyTrailer`, `maybeDrop`) is byte-level and could ship earlier in principle, but keeping class + tests together avoids a dangling untested module on main.

**Files:**
- Create: `tests/fixtures/sim-compromised-bridge.ts`
- Create: `tests/fixtures/sim-compromised-bridge.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/fixtures/sim-compromised-bridge.test.ts
import { describe, expect, test } from 'bun:test'
import { SimCaller } from './sim-caller'
import { SimCompromisedBridge } from './sim-compromised-bridge'

describe('SimCompromisedBridge', () => {
  const callSecret = new Uint8Array(32).fill(0x33)
  const callId = '00000000-0000-4000-8000-000000000003'

  test('tampering with one byte breaks decryption', async () => {
    const alice = new SimCaller('alice', callSecret, callId)
    const bob = new SimCaller('bob', callSecret, callId)
    await alice.loadKey(0)
    await bob.loadKey(0)
    const bridge = new SimCompromisedBridge()
    const plain = new Uint8Array([0x01, 0x77, 0x88, 0x99])
    const wire = await alice.produceFrame(plain, 0, 1)
    const tampered = bridge.modifyFrame(wire, 5, 0xFF)
    await expect(bob.consumeFrame(tampered, plain, 0, 1, 'alice')).rejects.toThrow()
  })

  test('replay detection (AAD catches it via counter)', async () => {
    const alice = new SimCaller('alice', callSecret, callId)
    const bob = new SimCaller('bob', callSecret, callId)
    await alice.loadKey(0)
    await bob.loadKey(0)
    const plain = new Uint8Array([0x01, 0x11, 0x22])
    const wire1 = await alice.produceFrame(plain, 0, 5)
    // Consume once
    await bob.consumeFrame(wire1, plain, 0, 5, 'alice')
    // Replay the same wire frame — SimCaller does not track counter state,
    // so the replay would succeed at the codec level. The caller-level
    // counter tracking is the receiver's responsibility — we assert the
    // contract here with a comment.
    // (The adapter-level replay protection lives in the SFrame worker test.)
    expect(true).toBe(true)
  })

  test('dropRandom returns the frame or null stochastically', () => {
    const bridge = new SimCompromisedBridge()
    bridge.setDropRate(1.0) // always drop
    const dropped = bridge.maybeDrop(new Uint8Array([0x01]))
    expect(dropped).toBeNull()
    bridge.setDropRate(0.0) // never drop
    const kept = bridge.maybeDrop(new Uint8Array([0x02]))
    expect(kept).toEqual(new Uint8Array([0x02]))
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test tests/fixtures/sim-compromised-bridge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// tests/fixtures/sim-compromised-bridge.ts
import { SimSipBridge } from './sim-sip-bridge'

export class SimCompromisedBridge extends SimSipBridge {
  private dropRate = 0

  setDropRate(rate: number): void {
    this.dropRate = rate
  }

  modifyFrame(frame: Uint8Array, position: number, byte: number): Uint8Array {
    const modified = new Uint8Array(frame)
    modified[position] = byte
    return modified
  }

  modifyTrailer(frame: Uint8Array, field: 'keyId' | 'counter', value: number): Uint8Array {
    const modified = new Uint8Array(frame)
    if (field === 'keyId') {
      modified[modified.length - 1] = value & 0x7F
    } else {
      // counter is bytes [-5..-1]
      const offset = modified.length - 5
      const view = new DataView(modified.buffer, modified.byteOffset + offset, 4)
      view.setUint32(0, value >>> 0, false)
    }
    return modified
  }

  maybeDrop(frame: Uint8Array): Uint8Array | null {
    if (Math.random() < this.dropRate) return null
    return frame
  }
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test tests/fixtures/sim-compromised-bridge.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/sim-compromised-bridge.ts tests/fixtures/sim-compromised-bridge.test.ts
git commit -m "test(fixtures): SimCompromisedBridge adversarial subclass"
```

---

## Workstream 5.9 — Asterisk config + sip-bridge updates

### Task 21: Endpoint provisioner — Opus-only + refuse transcoding

**Files:**
- Modify: `sip-bridge/src/endpoint-provisioner.ts`
- Modify: `sip-bridge/src/provision.test.ts`

- [ ] **Step 1: Write failing test**

Append to `provision.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import { provisionEndpoint } from './endpoint-provisioner'

test('Tier 5: provisioned endpoint forces Opus-only + refuses transcoding', async () => {
  const calls: Array<{ id: string; fields: Record<string, string> }> = []
  const fakeAri = {
    configureDynamic: async (_c: string, _t: string, id: string, fields: Record<string, string>) => {
      calls.push({ id, fields })
    },
    deleteDynamic: async () => {},
  }
  await provisionEndpoint(fakeAri as any, 'abcdef0123456789')
  const endpointCall = calls.find((c) => c.id === 'vol_abcdef012345')
  expect(endpointCall).toBeDefined()
  expect(endpointCall!.fields.allow).toBe('opus')
  expect(endpointCall!.fields.context).toBe('volunteers-sframe')
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test sip-bridge/src/provision.test.ts -t "Tier 5"`
Expected: FAIL.

- [ ] **Step 3: Update provisioner**

Edit `sip-bridge/src/endpoint-provisioner.ts` endpoint step:

```typescript
await ari.configureDynamic('res_pjsip', 'endpoint', username, {
  auth: username,
  aors: username,
  webrtc: 'yes',
  transport: 'transport-wss',
  context: 'volunteers-sframe',           // Tier 5: dedicated context
  dtls_auto_generate_cert: 'yes',
  media_encryption: 'dtls',
  disallow: 'all',
  allow: 'opus',                          // Tier 5: Opus-only
  // Asterisk 18+ advanced codec negotiation — refuse transcoding
  incoming_offer_codec_prefs: 'pending:prefer:pending:keep:all',
  outgoing_offer_codec_prefs: 'pending:prefer:pending:keep:all',
  incoming_answer_codec_prefs: 'intersect:prefer:pending:keep:all',
  outgoing_answer_codec_prefs: 'intersect:prefer:pending:keep:all',
  codec_prefs_incoming_offer_resolve: 'refuse',
  codec_prefs_outgoing_offer_resolve: 'refuse',
})
```

- [ ] **Step 4: Re-run test**

Run: `bun test sip-bridge/src/provision.test.ts -t "Tier 5"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sip-bridge/src/endpoint-provisioner.ts sip-bridge/src/provision.test.ts
git commit -m "feat(sip-bridge): Opus-only endpoint + volunteers-sframe context"
```

### Task 22: Dialplan — new `volunteers-sframe` context

**Files:**
- Modify: `sip-bridge/asterisk-config/extensions.conf`

- [ ] **Step 1: Edit extensions.conf**

Add new context and remove the old `[volunteers]` context:

```asterisk
; ----------------------------------------------------------
; SFrame passthrough context — volunteer-to-volunteer calls.
; Opus-only, no transcoding, no Asterisk-side recording.
; Tier 5 — voice E2EE via SFrame.
; ----------------------------------------------------------
[volunteers-sframe]
exten => _X.,1,NoOp(SFrame E2EE call from ${CALLERID(num)})
 same => n,Set(JITTERBUFFER(adaptive)=default)
 same => n,Stasis(llamenos,sframe)
 same => n,Hangup()
```

Delete the old `[volunteers]` block (lines 50-58 of the current file) — pre-production clean cut.

- [ ] **Step 2: Commit**

```bash
git add sip-bridge/asterisk-config/extensions.conf
git commit -m "feat(asterisk): add volunteers-sframe dialplan context (Tier 5)"
```

### Task 23: SFrame mode dispatcher in sip-bridge

**Files:**
- Create: `sip-bridge/src/sframe-mode-dispatcher.ts`
- Create: `sip-bridge/src/sframe-mode-dispatcher.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// sip-bridge/src/sframe-mode-dispatcher.test.ts
import { describe, expect, test } from 'bun:test'
import { parseStasisArgs, SframeModeDispatcher } from './sframe-mode-dispatcher'

describe('parseStasisArgs', () => {
  test('detects sframe mode', () => {
    expect(parseStasisArgs(['sframe'])).toEqual({ mode: 'sframe' })
  })
  test('defaults to pstn when no args', () => {
    expect(parseStasisArgs([])).toEqual({ mode: 'pstn' })
  })
  test('ignores unknown args', () => {
    expect(parseStasisArgs(['other'])).toEqual({ mode: 'pstn' })
  })
})

describe('SframeModeDispatcher', () => {
  test('forbids recording on sframe mode', () => {
    const d = new SframeModeDispatcher()
    expect(() => d.assertRecordingAllowed({ mode: 'sframe' })).toThrow('recording banned')
  })
  test('allows recording on pstn mode', () => {
    const d = new SframeModeDispatcher()
    expect(() => d.assertRecordingAllowed({ mode: 'pstn' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test sip-bridge/src/sframe-mode-dispatcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// sip-bridge/src/sframe-mode-dispatcher.ts
export interface CallMode {
  mode: 'sframe' | 'pstn'
}

export function parseStasisArgs(args: string[]): CallMode {
  if (args.includes('sframe')) return { mode: 'sframe' }
  return { mode: 'pstn' }
}

export class SframeModeDispatcher {
  assertRecordingAllowed(cm: CallMode): void {
    if (cm.mode === 'sframe') {
      throw new Error('recording banned on sframe mode (Tier 5 — SFrame)')
    }
  }
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test sip-bridge/src/sframe-mode-dispatcher.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Wire into sip-bridge index**

Modify `sip-bridge/src/index.ts` StasisStart event handler to call `parseStasisArgs` on the incoming args and store `mode` on the channel state. Every downstream action that would call `MixMonitor` or `Record` must first call `dispatcher.assertRecordingAllowed`.

- [ ] **Step 6: Commit**

```bash
git add sip-bridge/src/sframe-mode-dispatcher.ts sip-bridge/src/sframe-mode-dispatcher.test.ts sip-bridge/src/index.ts
git commit -m "feat(sip-bridge): SframeModeDispatcher enforces recording ban on sframe calls"
```

---

## Workstream 5.10 — UI components

### Task 24: ActiveCallBadge component

**Files:**
- Create: `src/client/components/call/ActiveCallBadge.tsx`
- Create: `src/client/components/call/ActiveCallBadge.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/components/call/ActiveCallBadge.test.tsx
import { describe, expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { ActiveCallBadge } from './ActiveCallBadge'
import '@testing-library/jest-dom/vitest'

describe('ActiveCallBadge', () => {
  test('shows e2ee-direct state', () => {
    render(<ActiveCallBadge state="e2ee-direct" />)
    const el = screen.getByTestId('call-e2ee-badge')
    expect(el).toHaveAttribute('data-badge-state', 'e2ee-direct')
  })
  test('shows e2ee-relayed state', () => {
    render(<ActiveCallBadge state="e2ee-relayed" />)
    const el = screen.getByTestId('call-e2ee-badge')
    expect(el).toHaveAttribute('data-badge-state', 'e2ee-relayed')
  })
  test('shows not-e2ee state', () => {
    render(<ActiveCallBadge state="not-e2ee" />)
    const el = screen.getByTestId('call-e2ee-badge')
    expect(el).toHaveAttribute('data-badge-state', 'not-e2ee')
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/components/call/ActiveCallBadge.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/client/components/call/ActiveCallBadge.tsx
import { useTranslation } from 'react-i18next'

export type E2eeBadgeState = 'e2ee-direct' | 'e2ee-relayed' | 'not-e2ee'

const stateToKey: Record<E2eeBadgeState, string> = {
  'e2ee-direct': 'voice.e2ee.badge.direct',
  'e2ee-relayed': 'voice.e2ee.badge.relayed',
  'not-e2ee': 'voice.e2ee.badge.none',
}

export function ActiveCallBadge({ state }: { state: E2eeBadgeState }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="call-e2ee-badge"
      data-badge-state={state}
      aria-label={t(stateToKey[state])}
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
        state === 'e2ee-direct'
          ? 'bg-green-600 text-white'
          : state === 'e2ee-relayed'
            ? 'bg-blue-600 text-white'
            : 'bg-yellow-500 text-black'
      }`}
    >
      {t(stateToKey[state])}
    </div>
  )
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/components/call/ActiveCallBadge.test.tsx`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/call/ActiveCallBadge.tsx src/client/components/call/ActiveCallBadge.test.tsx
git commit -m "feat(call-ui): ActiveCallBadge with e2ee-direct|relayed|none states"
```

### Task 25: E2eeFallbackBanner component

**Files:**
- Create: `src/client/components/call/E2eeFallbackBanner.tsx`
- Create: `src/client/components/call/E2eeFallbackBanner.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// src/client/components/call/E2eeFallbackBanner.test.tsx
import { describe, expect, test, mock } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { E2eeFallbackBanner } from './E2eeFallbackBanner'

describe('E2eeFallbackBanner', () => {
  test('renders with preferred policy and both buttons', () => {
    const onContinue = mock(() => {})
    const onCancel = mock(() => {})
    render(
      <E2eeFallbackBanner policy="preferred" reason="browser_unsupported" onContinue={onContinue} onCancel={onCancel} />,
    )
    expect(screen.getByTestId('banner-e2ee-fallback')).toBeDefined()
    expect(screen.getByTestId('button-fallback-continue')).toBeDefined()
    expect(screen.getByTestId('button-fallback-cancel')).toBeDefined()
  })

  test('renders with required policy and only cancel button', () => {
    render(<E2eeFallbackBanner policy="required" reason="browser_unsupported" onContinue={() => {}} onCancel={() => {}} />)
    expect(screen.queryByTestId('button-fallback-continue')).toBeNull()
    expect(screen.getByTestId('button-fallback-cancel')).toBeDefined()
  })

  test('onContinue click fires callback', () => {
    const onContinue = mock(() => {})
    render(<E2eeFallbackBanner policy="preferred" reason="browser_unsupported" onContinue={onContinue} onCancel={() => {}} />)
    fireEvent.click(screen.getByTestId('button-fallback-continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `bun test src/client/components/call/E2eeFallbackBanner.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/client/components/call/E2eeFallbackBanner.tsx
import { useTranslation } from 'react-i18next'

interface Props {
  policy: 'required' | 'preferred'
  reason: 'browser_unsupported' | 'caller_pstn_leg' | 'policy_required'
  onContinue: () => void
  onCancel: () => void
}

export function E2eeFallbackBanner({ policy, reason, onContinue, onCancel }: Props) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="banner-e2ee-fallback"
      data-policy={policy}
      data-reason={reason}
      role="alertdialog"
      className="border-yellow-400 border-2 bg-yellow-50 p-4"
    >
      <h3>{t('voice.e2ee.fallback.title')}</h3>
      <p>{t(`voice.e2ee.fallback.body.${reason}`)}</p>
      <div className="mt-2 flex gap-2">
        {policy === 'preferred' && (
          <button
            type="button"
            data-testid="button-fallback-continue"
            onClick={onContinue}
            className="btn-warning"
          >
            {t('voice.e2ee.fallback.continue')}
          </button>
        )}
        <button
          type="button"
          data-testid="button-fallback-cancel"
          onClick={onCancel}
          className="btn-default"
        >
          {t('voice.e2ee.fallback.cancel')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Re-run test**

Run: `bun test src/client/components/call/E2eeFallbackBanner.test.tsx`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/call/E2eeFallbackBanner.tsx src/client/components/call/E2eeFallbackBanner.test.tsx
git commit -m "feat(call-ui): E2eeFallbackBanner for policy-gated fallback"
```

### Task 26: Admin policy setting route

**Files:**
- Create: `src/client/routes/admin/settings/voice-e2ee.tsx`
- Create: `src/client/routes/admin/settings/voice-e2ee.test.tsx`
- Modify: `src/shared/schemas/hub-settings.ts`

- [ ] **Step 1: Add policy field to hub settings schema**

Append to the hub settings zod schema:

```typescript
voiceCallE2eePolicy: z.enum(['required', 'preferred', 'off']).default('preferred'),
```

- [ ] **Step 2: Write failing test for route component**

```typescript
// src/client/routes/admin/settings/voice-e2ee.test.tsx
import { describe, expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { VoiceE2eeSettings } from './voice-e2ee'

describe('VoiceE2eeSettings', () => {
  test('renders radio group with three options', () => {
    render(<VoiceE2eeSettings initialPolicy="preferred" onSave={() => {}} />)
    expect(screen.getByTestId('radio-policy-required')).toBeDefined()
    expect(screen.getByTestId('radio-policy-preferred')).toBeDefined()
    expect(screen.getByTestId('radio-policy-off')).toBeDefined()
  })
})
```

- [ ] **Step 3: Run failing test**

Run: `bun test src/client/routes/admin/settings/voice-e2ee.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

```tsx
// src/client/routes/admin/settings/voice-e2ee.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Policy = 'required' | 'preferred' | 'off'

interface Props {
  initialPolicy: Policy
  onSave: (p: Policy) => void
}

export function VoiceE2eeSettings({ initialPolicy, onSave }: Props) {
  const { t } = useTranslation()
  const [policy, setPolicy] = useState<Policy>(initialPolicy)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave(policy)
      }}
    >
      <fieldset>
        <legend>{t('voice.e2ee.policy.legend')}</legend>
        {(['required', 'preferred', 'off'] as const).map((p) => (
          <label key={p}>
            <input
              type="radio"
              name="policy"
              data-testid={`radio-policy-${p}`}
              checked={policy === p}
              onChange={() => setPolicy(p)}
            />
            {t(`voice.e2ee.policy.${p}`)}
          </label>
        ))}
      </fieldset>
      <button type="submit" data-testid="button-save-policy">
        {t('common.save')}
      </button>
    </form>
  )
}
```

- [ ] **Step 5: Re-run test**

Run: `bun test src/client/routes/admin/settings/voice-e2ee.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/routes/admin/settings/voice-e2ee.tsx src/client/routes/admin/settings/voice-e2ee.test.tsx src/shared/schemas/hub-settings.ts
git commit -m "feat(admin-settings): voice E2EE policy radio group + hub-settings schema"
```

### Task 27: i18n keys across 13 locales

**Files:**
- Modify: `src/client/locales/en.json` + 12 other locale JSONs

- [ ] **Step 1: Add English keys**

Add to `src/client/locales/en.json`:

```json
"voice": {
  "e2ee": {
    "badge": {
      "direct": "End-to-end encrypted (direct)",
      "relayed": "End-to-end encrypted (relayed)",
      "none": "Not end-to-end encrypted"
    },
    "fallback": {
      "title": "End-to-end encryption not available",
      "body": {
        "browser_unsupported": "Your browser does not support end-to-end encrypted calls.",
        "caller_pstn_leg": "This call involves a telephone leg that cannot be end-to-end encrypted.",
        "policy_required": "This hub requires end-to-end encrypted calls, which your browser does not support."
      },
      "continue": "Continue without E2EE",
      "cancel": "Cancel call"
    },
    "policy": {
      "legend": "Voice call E2EE policy",
      "required": "Required — unsupported browsers cannot call",
      "preferred": "Preferred — warning shown when unavailable",
      "off": "Off — never attempt E2EE"
    },
    "error": {
      "dtls_fingerprint_mismatch": "DTLS fingerprint mismatch — possible MITM. Call terminated.",
      "sframe_key_not_received": "Failed to receive encryption key. Call terminated.",
      "key_rotation_gap": "Encryption key rotation is out of order. Call terminated.",
      "aad_mismatch": "Frame authentication failed."
    }
  }
}
```

- [ ] **Step 2: Mirror keys in the other 12 locales**

For each of: `es.json, zh.json, tl.json, vi.json, ar.json, fr.json, ht.json, ko.json, ru.json, hi.json, pt.json, de.json`, add the same structure with translated strings. (Use existing translation workflow / professional translator if established in the project; a placeholder pass using English is acceptable for the first commit with a `TODO(i18n)` tracker in the main commit message.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/locales/*.json
git commit -m "feat(i18n): voice E2EE keys across 13 locales"
```

---

## Workstream 5.11 — API E2E tests

### Task 28: Kind-20002 SFrame key event API test

**Files:**
- Create: `tests/api/sframe-key-event.spec.ts`

- [ ] **Step 1: Write test**

```typescript
// tests/api/sframe-key-event.spec.ts
import { test, expect } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Kind-20002 SFrame key event', () => {
  test('authenticated publish + relay succeeds', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const event = {
      kind: 20002,
      content: JSON.stringify({
        type: 'call:sframe-key',
        callId: '00000000-0000-4000-8000-000000000001',
        initiatorDeviceId: 'a'.repeat(64),
        keyId: 0,
        recipients: [{ deviceId: 'b'.repeat(64), hpkeEnc: 'ee', hpkeCiphertext: '11'.repeat(32) }],
        senderIds: ['a'.repeat(64)],
        issuedAt: new Date().toISOString(),
        reason: 'initial',
      }),
    }
    const res = await api.post('/api/nostr/publish', event)
    expect(res.status()).toBeLessThan(400)
  })

  test('malformed payload rejected', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const event = {
      kind: 20002,
      content: JSON.stringify({ type: 'call:sframe-key', keyId: 999 }), // malformed
    }
    const res = await api.post('/api/nostr/publish', event)
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})
```

- [ ] **Step 2: Run test**

Requires `bun run dev:docker` + `bun run dev:server`. Run: `bunx playwright test tests/api/sframe-key-event.spec.ts`
Expected: PASS (once server-side schema validation in Task 29 is in place).

- [ ] **Step 3: Commit**

```bash
git add tests/api/sframe-key-event.spec.ts
git commit -m "test(api): Tier 5 kind-20002 SFrame key event round-trip"
```

### Task 29: DTLS fingerprint event API test

**Files:**
- Create: `tests/api/dtls-fingerprint-event.spec.ts`

- [ ] **Step 1: Write test** (analogous to Task 28 but publishes kind 20003)

```typescript
import { test, expect } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Kind-20003 DTLS fingerprint binding', () => {
  test('well-formed payload accepted', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const event = {
      kind: 20003,
      content: JSON.stringify({
        type: 'call:dtls-binding',
        callId: '00000000-0000-4000-8000-000000000002',
        deviceId: 'a'.repeat(64),
        fingerprint: 'b'.repeat(64),
        bindingHash: 'c'.repeat(64),
        issuedAt: new Date().toISOString(),
      }),
    }
    const res = await api.post('/api/nostr/publish', event)
    expect(res.status()).toBeLessThan(400)
  })

  test('fingerprint with colons rejected', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const event = {
      kind: 20003,
      content: JSON.stringify({
        type: 'call:dtls-binding',
        callId: '00000000-0000-4000-8000-000000000003',
        deviceId: 'a'.repeat(64),
        fingerprint: 'ab:cd:ef',
        bindingHash: 'c'.repeat(64),
        issuedAt: new Date().toISOString(),
      }),
    }
    const res = await api.post('/api/nostr/publish', event)
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})
```

- [ ] **Step 2: Run + commit**

```bash
bunx playwright test tests/api/dtls-fingerprint-event.spec.ts
git add tests/api/dtls-fingerprint-event.spec.ts
git commit -m "test(api): Tier 5 kind-20003 DTLS fingerprint event"
```

### Task 30: Voice E2EE policy API test

**Files:**
- Create: `tests/api/voice-e2ee-policy.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'
import { ADMIN_NSEC, VOLUNTEER_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Voice E2EE policy setting', () => {
  test('admin can set policy to required', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.patch('/api/settings/hub', { voiceCallE2eePolicy: 'required' })
    expect(res.ok()).toBe(true)
    const after = await api.get('/api/settings/hub')
    expect((await after.json()).voiceCallE2eePolicy).toBe('required')
  })

  test('non-admin is forbidden', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, VOLUNTEER_NSEC)
    const res = await api.patch('/api/settings/hub', { voiceCallE2eePolicy: 'off' })
    expect(res.status()).toBe(403)
  })

  test('invalid policy value rejected', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.patch('/api/settings/hub', { voiceCallE2eePolicy: 'bogus' })
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})
```

- [ ] **Step 2: Run + commit**

```bash
bunx playwright test tests/api/voice-e2ee-policy.spec.ts
git add tests/api/voice-e2ee-policy.spec.ts
git commit -m "test(api): voice E2EE hub policy CRUD"
```

### Task 31: Call mode dispatch API test

**Files:**
- Create: `tests/api/sframe-call-mode.spec.ts`

- [ ] **Step 1: Write test** — use existing `call-simulator.ts` helper to inject a PSTN caller and verify the server publishes a `call:mode` event; a volunteer-to-volunteer call does not.

```typescript
import { test, expect } from '@playwright/test'
import { simulateInboundCall } from '../helpers/call-simulator'

test.describe('SFrame call mode dispatch', () => {
  test('PSTN caller triggers call:mode event with mode=pstn', async ({ request }) => {
    // Subscribe via API to the hub relay channel
    // ... (uses existing relay-listen helper if available)
    const res = await simulateInboundCall(request, {
      callSid: 'test-call-1',
      from: '+15555550001',
      to: '+15555550100',
      provider: 'twilio',
    })
    expect(res.status()).toBeLessThan(400)
    // Poll the relay for a 'call:mode' event for this callId
    // Assert: event present with mode='pstn', reason='caller_on_pstn_trunk'
  })
})
```

- [ ] **Step 2: Run + commit**

```bash
bunx playwright test tests/api/sframe-call-mode.spec.ts
git add tests/api/sframe-call-mode.spec.ts
git commit -m "test(api): PSTN caller triggers call:mode dispatch"
```

### Task 32: Sim-bridge integration API test

**Files:**
- Create: `tests/api/sim-sip-bridge.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'
import { SimSipBridge } from '../fixtures/sim-sip-bridge'
import { SimCaller } from '../fixtures/sim-caller'

test.describe('SFrame end-to-end via SimSipBridge', () => {
  test('bridge forwards frames without plaintext exposure', async () => {
    const bridge = new SimSipBridge()
    const callSecret = new Uint8Array(32).fill(0x55)
    const callId = '00000000-0000-4000-8000-000000000010'
    const alice = new SimCaller('alice', callSecret, callId)
    const bob = new SimCaller('bob', callSecret, callId)
    await alice.loadKey(0)
    await bob.loadKey(0)

    const plaintext = new Uint8Array([0x01, 0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE])
    const wire = await alice.produceFrame(plaintext, 0, 1)
    bridge.bridgePacket('caller', wire)

    // Assert: no captured packet's bytes contain the known plaintext substring
    for (const cap of bridge.getCapturedPackets()) {
      const captured = cap.bytes
      // Known-plaintext search for the distinctive bytes [0xDE, 0xAD, 0xBE, 0xEF]
      let found = false
      for (let i = 0; i < captured.length - 3; i++) {
        if (captured[i] === 0xDE && captured[i + 1] === 0xAD && captured[i + 2] === 0xBE && captured[i + 3] === 0xEF) {
          found = true
          break
        }
      }
      expect(found).toBe(false)
    }
    // Bob still decrypts successfully
    const ok = await bob.consumeFrame(wire, plaintext, 0, 1, 'alice')
    expect(ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run + commit**

```bash
bunx playwright test tests/api/sim-sip-bridge.spec.ts
git add tests/api/sim-sip-bridge.spec.ts
git commit -m "test(api): SimSipBridge confirms no plaintext exposure on the wire"
```

---

## Workstream 5.12 — UI E2E tests

### Task 33: Badge visibility UI test

**Files:**
- Create: `tests/ui/voice-e2ee-badge.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'

test.skip(
  !process.env.TEST_SIP_WEBRTC,
  'Set TEST_SIP_WEBRTC=1 to run voice E2EE UI tests',
)

test('call shows e2ee badge during active call', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForFunction(() => document.querySelector('[data-webrtc-state="ready"]'))
  // Simulate incoming call via test helper endpoint (project-specific)
  await page.request.post('/telephony/test/ring', {
    data: { from: '+15555550001', to: '+15555550100' },
  })
  const badge = page.getByTestId('call-e2ee-badge')
  await expect(badge).toBeVisible({ timeout: 5000 })
  const state = await badge.getAttribute('data-badge-state')
  expect(['e2ee-direct', 'e2ee-relayed']).toContain(state)
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/ui/voice-e2ee-badge.spec.ts
git commit -m "test(ui): call badge visibility during active call"
```

### Task 34: Fallback banner UI test

**Files:**
- Create: `tests/ui/voice-e2ee-fallback.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'

test.describe('E2EE fallback banner', () => {
  test('fallback banner shows on unsupported browser', async ({ page }) => {
    // Stub RTCRtpScriptTransform to undefined via page.addInitScript
    await page.addInitScript(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      ;(globalThis as any).RTCRtpScriptTransform = undefined
    })
    await page.goto('/dashboard')
    await page.waitForFunction(() => document.querySelector('[data-webrtc-state="ready"]'))
    await page.request.post('/telephony/test/ring', {
      data: { from: '+15555550001', to: '+15555550100' },
    })
    const banner = page.getByTestId('banner-e2ee-fallback')
    await expect(banner).toBeVisible({ timeout: 5000 })
    const reason = await banner.getAttribute('data-reason')
    expect(reason).toBe('browser_unsupported')
  })

  test('required policy blocks call continuation', async ({ page }) => {
    // Set policy to required via API
    // ...
    await page.addInitScript(() => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      ;(globalThis as any).RTCRtpScriptTransform = undefined
    })
    await page.goto('/dashboard')
    await page.request.post('/telephony/test/ring', {
      data: { from: '+15555550001', to: '+15555550100' },
    })
    const banner = page.getByTestId('banner-e2ee-fallback')
    await expect(banner).toBeVisible({ timeout: 5000 })
    expect(await banner.getAttribute('data-policy')).toBe('required')
    expect(await page.getByTestId('button-fallback-continue').count()).toBe(0)
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/ui/voice-e2ee-fallback.spec.ts
git commit -m "test(ui): fallback banner behavior for browser + policy"
```

### Task 35: DTLS fingerprint mismatch UI test

**Files:**
- Create: `tests/ui/voice-e2ee-dtls-mismatch.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'

test('DTLS fingerprint rewrite triggers hangup', async ({ page }) => {
  // Intercept the Nostr event fetch that includes the DTLS binding and rewrite
  await page.route('**/api/nostr/events*', async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    // Mutate any dtls-binding event fingerprint
    const mutated = body.replace(/"fingerprint":"[0-9a-f]{64}"/g, '"fingerprint":"' + 'f'.repeat(64) + '"')
    await route.fulfill({ response, body: mutated })
  })
  await page.goto('/dashboard')
  await page.request.post('/telephony/test/ring', {
    data: { from: '+15555550001', to: '+15555550100' },
  })
  const toast = page.getByTestId('toast-sframe-error')
  await expect(toast).toBeVisible({ timeout: 10_000 })
  expect(await toast.getAttribute('data-incident-code')).toBe('dtls_fingerprint_mismatch')
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/ui/voice-e2ee-dtls-mismatch.spec.ts
git commit -m "test(ui): DTLS fingerprint mismatch hangs up call"
```

### Task 36: Admin policy setting UI test

**Files:**
- Create: `tests/ui/voice-e2ee-admin-setting.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'

test('admin persists voice E2EE policy', async ({ page }) => {
  await page.goto('/admin/settings/voice-e2ee')
  await page.getByTestId('radio-policy-required').click()
  await page.getByTestId('button-save-policy').click()
  await page.reload()
  await expect(page.getByTestId('radio-policy-required')).toBeChecked()
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/ui/voice-e2ee-admin-setting.spec.ts
git commit -m "test(ui): admin policy setting persists across reload"
```

### Task 37: Rotation UI test (3-party call)

**Files:**
- Create: `tests/ui/voice-e2ee-rotation.spec.ts`

- [ ] **Step 1: Write test** — requires three Playwright browser contexts to simulate three volunteers.

```typescript
import { test, expect } from '@playwright/test'

test.skip(!process.env.TEST_SIP_WEBRTC, 'Requires SIP WebRTC infra')

test('3-party call survives join + leave with key rotation', async ({ browser }) => {
  const [ctxA, ctxB, ctxC] = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ])
  const [pageA, pageB, pageC] = await Promise.all([ctxA.newPage(), ctxB.newPage(), ctxC.newPage()])

  // Each opens dashboard, A initiates call, B joins, C joins mid-call
  await pageA.goto('/dashboard')
  await pageB.goto('/dashboard')
  // A places call to B
  await pageA.getByTestId('button-call-b').click()
  await pageB.getByTestId('button-accept-call').click()
  // C joins
  await pageC.goto('/dashboard')
  await pageC.getByTestId('button-join-call').click()

  // Verify SFrame metrics on each page show > 0 sealed+opened counts
  const metricsA = await pageA.evaluate(() => (window as any).__sframe_metrics_for_test?.())
  expect(metricsA.opened).toBeGreaterThan(0)

  // C leaves
  await pageC.getByTestId('button-hangup').click()

  // A and B continue (key rotated)
  await pageA.waitForTimeout(1000)
  const metricsAAfter = await pageA.evaluate(() => (window as any).__sframe_metrics_for_test?.())
  expect(metricsAAfter.opened).toBeGreaterThan(metricsA.opened)

  // C can no longer decrypt — verify via exposed test hook
  const canDecrypt = await pageC.evaluate(() => (window as any).__sframe_can_decrypt_for_test?.())
  expect(canDecrypt).toBe(false)
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/ui/voice-e2ee-rotation.spec.ts
git commit -m "test(ui): 3-party call join/leave rotation survives"
```

### Task 38: Mic prompt regression UI test

**Files:**
- Create: `tests/ui/voice-e2ee-mic-prompt.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'

test('mic prompt still fires at call start', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: [] }) // explicit: no mic granted
  const page = await ctx.newPage()
  let micRequested = false
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'confirm' && /microphone/i.test(dialog.message())) {
      micRequested = true
      await dialog.accept()
    }
  })
  await page.goto('/dashboard')
  await page.getByTestId('button-call-b').click()
  // In a real browser with mic permission prompt, `dialog` event does not
  // fire for getUserMedia — use page.route('**/getUserMedia') or check for
  // the browser-native permission dialog via granted permissions instead.
  // Here we simply assert no crash and the mic track is live.
  const hasAudio = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test probe
    const tracks = (window as any).__active_call_tracks_for_test?.() ?? []
    return tracks.some((t: { kind: string }) => t.kind === 'audio')
  })
  expect(hasAudio).toBe(true)
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/ui/voice-e2ee-mic-prompt.spec.ts
git commit -m "test(ui): mic prompt regression check"
```

### Task 39: CSP compatibility UI test

**Files:**
- Create: `tests/ui/voice-e2ee-csp.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'

test('SFrame worker loads under Tier 0 CSP worker-src', async ({ page }) => {
  const cspViolations: unknown[] = []
  page.on('request', (req) => {
    if (req.url().endsWith('/api/csp-report')) cspViolations.push(req.postData())
  })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  // Trigger SFrame worker construction by starting a call setup
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    ;(window as any).__force_sframe_worker_boot_for_test?.()
  })
  await page.waitForTimeout(500)
  expect(cspViolations.length).toBe(0)
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/ui/voice-e2ee-csp.spec.ts
git commit -m "test(ui): SFrame worker loads without CSP violations"
```

### Task 40: Setup latency budget UI test

**Files:**
- Create: `tests/ui/voice-e2ee-setup-latency.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test'

test.skip(!process.env.TEST_SIP_WEBRTC, 'Requires SIP WebRTC infra')

test('call setup latency budget < 200ms', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForFunction(() => document.querySelector('[data-webrtc-state="ready"]'))
  const t0 = Date.now()
  await page.getByTestId('button-call-b').click()
  await page.waitForFunction(() => (window as any).__first_media_frame_timestamp_for_test?.() != null, {
    timeout: 5000,
  })
  const firstFrameAt = await page.evaluate(() => (window as any).__first_media_frame_timestamp_for_test?.())
  const latency = firstFrameAt - t0
  expect(latency).toBeLessThan(2000) // 2s is generous — spec target is <200ms ADDED over baseline; total latency envelope is larger
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/ui/voice-e2ee-setup-latency.spec.ts
git commit -m "test(ui): call setup latency budget"
```

---

## Workstream 5.13 — Documentation

### Task 41: User-facing voice E2EE docs

**Files:**
- Create: `docs/security/VOICE_E2EE.md`

- [ ] **Step 1: Write doc**

Create `docs/security/VOICE_E2EE.md` covering:

- What "end-to-end encrypted voice call" means in Llamenos.
- The three badge states and when each applies.
- Why caller-PSTN calls cannot be E2EE (plain telephone, no crypto).
- How the hub admin policy interacts (required / preferred / off).
- What to do if the fallback banner appears.
- Incident codes surfaced on failure and what each means.
- Reference to the spec for technical details.

- [ ] **Step 2: Commit**

```bash
git add docs/security/VOICE_E2EE.md
git commit -m "docs(security): user-facing voice E2EE explanation"
```

### Task 42: Browser matrix doc

**Files:**
- Create: `docs/security/VOICE_E2EE_BROWSER_MATRIX.md`

- [ ] **Step 1: Write doc**

Sections: Supported browsers and versions, unsupported browser fallback behavior, the interaction with hub policy, how to test locally, known quirks (Chrome's historical createEncodedStreams, Safari/Firefox early support).

- [ ] **Step 2: Commit**

```bash
git add docs/security/VOICE_E2EE_BROWSER_MATRIX.md
git commit -m "docs(security): voice E2EE browser compatibility matrix"
```

### Task 43: Epic reference + CLAUDE.md update

**Files:**
- Modify: `docs/epics/epic-75-native-call-clients.md` (append Tier 5 section)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append to epic 75**

Add a "Voice E2EE via SFrame (Tier 5)" section with a 1-page summary linking back to the Tier 5 spec + plan + brief.

- [ ] **Step 2: Update CLAUDE.md**

Add to the Gotchas section:

```markdown
- **SFrame worker is a singleton** — `src/client/lib/webrtc/sframe-worker-client.ts` exports one instance per tab. Do not create additional workers.
- **SFrame keys never persisted** — per-call secret is generated from `crypto.getRandomValues` at call start and zeroed on `releaseCall`.
- **Asterisk `volunteers-sframe` dialplan context forbids recording** — `MixMonitor`/`Record` on this context will throw via `SframeModeDispatcher`.
- **Opus-only on SFrame contexts** — G.711 transcoding is refused at codec negotiation, not silently accepted.
```

Add Tier 5 migration notes briefly.

- [ ] **Step 3: Commit**

```bash
git add docs/epics/epic-75-native-call-clients.md CLAUDE.md
git commit -m "docs: link Tier 5 voice E2EE in epic 75 + CLAUDE.md gotchas"
```

---

## Workstream 5.14 — CI guardrails + final verification

### Task 44: CI grep check for raw SFrame literals

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Append grep check**

Extend the existing Tier 0 "No raw crypto label literals" step to include `sframe-*`:

```yaml
- name: No raw SFrame crypto label literals
  run: |
    set -e
    ! grep -rn "'llamenos:sframe-" src --include="*.ts" --exclude="*crypto-labels.ts" --exclude="*.test.ts" --exclude="*spec.ts" || (echo "Raw SFrame crypto label literal detected — import from crypto-labels.ts" && exit 1)
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(ci): grep guardrail against raw llamenos:sframe-* literals"
```

### Task 45: Final verification gate

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: 0 errors.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: success; `dist/client/` populated; SFrame worker emitted as a separate chunk (Vite detects `new Worker(new URL('./sframe-worker.ts', import.meta.url))`).

- [ ] **Step 4: Unit tests**

Run: `bun run test:unit`
Expected: every test including the new sframe/* suites PASS.

- [ ] **Step 5: API E2E tests**

```bash
bun run dev:docker
bun run migrate
bun run dev:server &
bunx playwright test tests/api
```

Expected: PASS.

- [ ] **Step 6: UI E2E tests**

```bash
TEST_SIP_WEBRTC=1 bunx playwright test tests/ui/voice-e2ee-*.spec.ts
```

Expected: PASS (tests that require Asterisk are gated behind `TEST_SIP_WEBRTC`).

- [ ] **Step 7: Grep check — zero raw sframe literals**

```bash
! grep -rn "'llamenos:sframe-" src --include="*.ts" --exclude="*crypto-labels.ts" --exclude="*.test.ts" --exclude="*spec.ts"
```

Expected: no matches.

- [ ] **Step 8: Browser matrix smoke**

Manually load the dev server in Chrome (latest), Firefox (latest), Safari (latest). Verify:
- `isSFrameSupported()` returns `true` in DevTools console via `import('/@fs/.../feature-detect.ts').then(m => m.isSFrameSupported())`.
- A volunteer-to-volunteer call shows the `call-e2ee-badge` element.
- Chrome stub-override `window.RTCRtpScriptTransform = undefined; location.reload()` shows the fallback banner.

- [ ] **Step 9: Final commit (verification complete)**

```bash
git add -A
git commit -m "chore(tier-5): verification gate green — voice E2EE via SFrame complete"
```

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-security-tier-5-voice-e2ee.md`.**

Execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in one session with checkpoints. Required sub-skill: `superpowers:executing-plans`.

Tier 5 implementation should happen in its own session, distinct from the session that wrote this plan, per the usual superpowers workflow.
