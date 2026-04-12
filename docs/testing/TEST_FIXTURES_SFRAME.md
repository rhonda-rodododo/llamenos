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

## Codec-agnostic design

These fixtures are deliberately codec-agnostic: they establish shape, state tracking, and deterministic stub payloads without exercising any cipher suite. Tests that only need a fake PBX or a fake inbound caller (Tier 3/4 call-path tests, IVR regression tests, dialplan dispatch tests) use these fixtures directly. Tests that need genuine SFrame round-trips extend the fixtures at their call sites — typically by importing `@shared/sframe/frame-codec` alongside `SimCaller` and seal/open frames through `SimSipBridge.bridgePacket`.

An adversarial subclass (`SimCompromisedBridge`) that tampers with ciphertext/trailer bytes, drops packets, and replays frames lives alongside the Tier 5 SFrame code path and depends on the SFrame-capable caller path — see the Tier 5 plan's Workstream 5.8 for the dependency notes.

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
- **The bridge saw only ciphertext** (Tier 5) — `CapturedPacket.bytes` is typed as `CiphertextBytes | PlaintextBytes` (Task 19d), so the "bridge never saw plaintext" assertion is expressible as a compile-time brand check instead of a byte-pattern sniff. Hand the bridge a `CiphertextBytes` from `SimCaller.produceFrame`; any use site that tries to narrow `captured.bytes` to `PlaintextBytes` without a runtime predicate is rejected by `tsc`.
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
fill for the rest. See `FRAME_STUB_HEADER` and `FRAME_STUB_PAYLOAD_LEN`
in `tests/fixtures/sim-caller.ts` for the canonical constants.

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
- **Deterministic time.** Each `SimSipBridge` instance stamps events with a monotonic per-instance deterministic clock starting at `2026-04-11T00:00:00Z` and advancing one second per emitted event — event N gets timestamp `2026-04-11T00:00:NZ` and rolls into the next minute after 60 events. Two bridge instances do not share clock state, so per-test `beforeEach` fixtures see identical timestamps.
- **No network calls.** No `fetch`, no WebSocket connections, no Nostr relay. Event delivery is a synchronous in-process subscriber list.
