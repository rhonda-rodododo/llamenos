# SFrame test fixtures

Reference for the in-memory test fixtures that simulate the Asterisk
SIP bridge and a second WebRTC endpoint without requiring a real PBX,
real RTP sockets, or a real browser. These fixtures let unit tests and
Playwright API/UI tests drive the Tier 5 SFrame call pipeline end-to-end
in CI.

**Ships:** Tier 5 prerequisite PR (`feat/sec-tier-5-prereq-sim-sip-bridge`).

**Related spec:** `docs/superpowers/specs/2026-04-10-security-tier-5-voice-e2ee-design.md` §5.12.
**Related plan:** `docs/superpowers/plans/2026-04-10-security-tier-5-voice-e2ee.md` Workstream 5.8.

## Files

| File | Role |
|---|---|
| `tests/fixtures/sim-sip-bridge.ts` | Simulated Asterisk ARI event bus + in-memory RTP media plane. |
| `tests/fixtures/sim-caller.ts` | Simulated inbound caller — canned Opus clip + jitter buffer + DTMF. |
| `tests/helpers/sframe-test-utils.ts` | Mock RTP header layout + mock SFrame key-material helpers. |

All three are framework-agnostic (no Playwright imports) and carry zero imports from `src/shared/sframe/`. They can be called from `bun:test` unit tests AND from Playwright API/UI tests.

## Scope split with Tier 5 main

The prerequisite PR intentionally ships **no SFrame production code**. The fixtures here establish shape, state tracking, and deterministic stub payloads — not cipher-suite operations.

Tier 5 main PR extends these fixtures in-place:

- **Task 19b** (Tier 5 main) adds `bindCall` / `loadKey` / `produceFrame` / `consumeFrame` to `SimCaller`, wired to `@shared/sframe/frame-codec` + `@shared/sframe/cipher-suite` once those production modules exist.
- **Task 20** (Tier 5 main) adds `tests/fixtures/sim-compromised-bridge.ts`, an adversarial `SimSipBridge` subclass that tampers with ciphertext/trailer bytes, drops packets, and replays frames. Its tests depend on `SimCaller.produceFrame` from Task 19b.

Tier 3 and Tier 4 call-path tests that only need a fake PBX (no SFrame crypto) can reuse `SimSipBridge` + `SimCaller` immediately from the prerequisite PR — that is the cross-tier motivation for landing them separately.

## SimSipBridge

```ts
import { SimSipBridge } from 'tests/fixtures/sim-sip-bridge'

const bridge = new SimSipBridge()

// Endpoint provisioning — mimics ARI endpoints.post
const { username, password } = await bridge.provisionEndpoint('vol-pubkey-1')

// Subscribe to ARI events
bridge.onEvent((event) => {
  if (event.type === 'channel_create') console.log(event.channelId)
})

// Inject an inbound call — emits channel_create + channel_answer
await bridge.inject({
  callId: 'call-123',
  callerNumber: '+15551111',
  calledNumber: '+15552222',
  mode: 'sframe', // or 'pstn'
})

// Bridge RTP packets (B2BUA pass-through). The bridge records every
// byte it sees so tests can assert "the bridge never saw plaintext".
bridge.bridgePacket('caller', rtpBytes)
const captured = bridge.getCapturedPackets()

// Hangup
await bridge.hangup('call-123', 16, 'NORMAL_CLEARING')
```

### Assertions this fixture enables

- **RTP bytes flowed bidirectionally** — check `getCapturedPackets()` for both `a-to-b` and `b-to-a` directions.
- **The bridge saw only ciphertext** (Tier 5) — iterate `getCapturedPackets()` and assert none of the payload bytes match the known plaintext clip from `SimCaller`.
- **Dialplan stasis args routed the call** — assert `channel_create.args` contains `"sframe"` or `"pstn"` to verify the Tier 5 dispatcher.
- **Endpoint provisioning is idempotent** — provisioning the same pubkey twice returns the same creds.

## SimCaller

```ts
import { SimCaller } from 'tests/fixtures/sim-caller'

const caller = new SimCaller('device-a', {
  clipDurationMs: 2000,
  frameIntervalMs: 20,
  toneHz: 440,
})

// Drain the canned clip frame-by-frame
let frame = caller.nextFrame()
while (frame !== null) {
  // push into bridge.bridgePacket(...)
  frame = caller.nextFrame()
}

// Jitter buffer
caller.setJitter(5) // ±5ms around the 20ms interval
const delay = caller.nextFrameDelayMs() // 15..25ms

// DTMF for IVR tests
caller.pressSequence('1234#')
const digits = caller.drainDigits() // ['1', '2', '3', '4', '#']

// Lifecycle
caller.reset()
```

### Canned clip details

The clip is a **stub** — not real Opus encoding. Each 20ms "frame" is a
16-byte deterministic payload with a `0xfc` header sentinel, the tone
frequency in bytes 1–2, the frame index in bytes 3–6, and a deterministic
fill for the rest. Tests that need real Opus encoding should wait for
Tier 5 main and use a production Opus encoder behind a feature flag.

The stub is deliberate: real Opus encoding via `@huggingface/transformers`
or a native bindings library is too heavy for CI, and the SFrame layer
under test doesn't care about codec correctness — only about per-frame
byte length, ordering, and the ability to check "was this payload
encrypted?"

## sframe-test-utils helpers

```ts
import {
  buildMockRtpHeader,
  buildMockRtpPacket,
  parseMockRtpHeader,
  makeMockCallSecret,
  makeMockSFrameKeyEventPayload,
} from 'tests/helpers/sframe-test-utils'

// Build a RTP packet with a specific SSRC + timestamp
const packet = buildMockRtpPacket(
  {
    version: 2,
    padding: false,
    extension: false,
    csrcCount: 0,
    marker: false,
    payloadType: 111,
    sequenceNumber: 42,
    timestamp: 0xdeadbeef,
    ssrc: 0xcafebabe,
  },
  payload,
)

// Mock a 32-byte "call secret" for fixture plumbing tests
const secret = makeMockCallSecret(1)

// Mock a kind-20002 key event body
const event = makeMockSFrameKeyEventPayload(
  'call-1',
  0,
  'device-a',
  ['device-b', 'device-c'],
)
```

These helpers are intentionally dumb: they produce bytes with the right
shape so call-path tests can assert over packet positions, but they do
not run real crypto. Tests that need real HPKE sealing or SFrame AEAD
use the real modules from `src/shared/sframe/` once Tier 5 main lands.

## Headless CI notes

- **No kernel sockets.** Fixtures simulate RTP in memory as `Uint8Array` pass-through through `SimSipBridge.bridgePacket`. Nothing binds to a UDP port.
- **No browser.** Fixtures are pure TypeScript modules. `SimCaller` holds clip state as arrays; `SimSipBridge` is a plain class. Neither touches `RTCPeerConnection`, `AudioContext`, or any Web APIs.
- **Deterministic time.** `SimSipBridge` stamps events with a monotonic deterministic clock starting from `2026-04-11T00:00:00Z` so tests can assert over timestamps.
- **No network calls.** No `fetch`, no WebSocket connections, no Nostr relay. Event delivery is a synchronous in-process subscriber list.
