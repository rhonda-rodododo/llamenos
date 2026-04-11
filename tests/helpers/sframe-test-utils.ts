/**
 * sframe-test-utils — shared helpers for tests that exercise the SFrame
 * call pipeline fixtures (`tests/fixtures/sim-sip-bridge.ts` +
 * `tests/fixtures/sim-caller.ts`).
 *
 * **Scope:** mock RTP packet layout + mock SFrame key-material helpers
 * that carry NO imports from `src/shared/sframe/`. Those production
 * modules do not exist on main until Tier 5 Workstreams 5.1 + 5.2 land;
 * this helper intentionally stays standalone so it can ship in the Tier
 * 5 prerequisite PR without pulling production code forward.
 *
 * When the real `frame-codec.ts` lands in Tier 5 main, tests that need
 * genuine SFrame round-trips use that module directly — not the mock
 * builders here. The mocks in this file are only for tests that assert
 * over packet shape, event payloads, or fixture plumbing without
 * exercising the cipher suite.
 *
 * Related: Tier 5 spec §5.12, Tier 5 plan Workstream 5.8 header note.
 */

// ---- Mock RTP packet layout ----

export interface MockRtpHeaderFields {
  version: number
  padding: boolean
  extension: boolean
  csrcCount: number
  marker: boolean
  payloadType: number
  sequenceNumber: number
  timestamp: number
  ssrc: number
}

export const MOCK_RTP_HEADER_BYTES = 12

/**
 * Build a 12-byte RTP header with no CSRCs. Matches RFC 3550 layout so
 * tests can assert over the byte positions used by the real SFrame code
 * path, without having to import it.
 */
export function buildMockRtpHeader(fields: MockRtpHeaderFields): Uint8Array {
  if (fields.csrcCount !== 0) {
    throw new Error('buildMockRtpHeader: CSRC support not implemented in the mock')
  }
  const header = new Uint8Array(MOCK_RTP_HEADER_BYTES)
  header[0] =
    ((fields.version & 0x3) << 6) |
    ((fields.padding ? 1 : 0) << 5) |
    ((fields.extension ? 1 : 0) << 4) |
    (fields.csrcCount & 0xf)
  header[1] = ((fields.marker ? 1 : 0) << 7) | (fields.payloadType & 0x7f)
  header[2] = (fields.sequenceNumber >>> 8) & 0xff
  header[3] = fields.sequenceNumber & 0xff
  header[4] = (fields.timestamp >>> 24) & 0xff
  header[5] = (fields.timestamp >>> 16) & 0xff
  header[6] = (fields.timestamp >>> 8) & 0xff
  header[7] = fields.timestamp & 0xff
  header[8] = (fields.ssrc >>> 24) & 0xff
  header[9] = (fields.ssrc >>> 16) & 0xff
  header[10] = (fields.ssrc >>> 8) & 0xff
  header[11] = fields.ssrc & 0xff
  return header
}

export function parseMockRtpHeader(bytes: Uint8Array): MockRtpHeaderFields {
  if (bytes.length < MOCK_RTP_HEADER_BYTES) {
    throw new Error('parseMockRtpHeader: short header')
  }
  const b = bytes
  return {
    version: (b[0] >>> 6) & 0x3,
    padding: ((b[0] >>> 5) & 0x1) === 1,
    extension: ((b[0] >>> 4) & 0x1) === 1,
    csrcCount: b[0] & 0xf,
    marker: ((b[1] >>> 7) & 0x1) === 1,
    payloadType: b[1] & 0x7f,
    sequenceNumber: (b[2] << 8) | b[3],
    timestamp: ((b[4] << 24) >>> 0) + ((b[5] << 16) >>> 0) + ((b[6] << 8) >>> 0) + (b[7] >>> 0),
    ssrc: ((b[8] << 24) >>> 0) + ((b[9] << 16) >>> 0) + ((b[10] << 8) >>> 0) + (b[11] >>> 0),
  }
}

export function buildMockRtpPacket(header: MockRtpHeaderFields, payload: Uint8Array): Uint8Array {
  const headerBytes = buildMockRtpHeader(header)
  const packet = new Uint8Array(headerBytes.length + payload.length)
  packet.set(headerBytes, 0)
  packet.set(payload, headerBytes.length)
  return packet
}

// ---- Mock SFrame key material ----

/**
 * Deterministic 32-byte "call secret" for tests that need to reference a
 * callSecret value by seed but do NOT need to derive real SFrame keys
 * from it. Used by fixture plumbing tests that assert "this event
 * carried the expected seed-linked bytes".
 */
export function makeMockCallSecret(seed: number): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 0; i < out.length; i++) {
    out[i] = (seed + i * 7) & 0xff
  }
  return out
}

export interface MockSFrameKeyEventPayload {
  callId: string
  keyId: number
  senderDeviceId: string
  recipients: Array<{ deviceId: string; hpkeEnc: string; hpkeCiphertext: string }>
}

/**
 * Build a mock kind-20002 event payload body. All HPKE fields are stub
 * hex strings — tests that assert over actual HPKE sealing use the real
 * helpers in Tier 5 main, not this mock.
 */
export function makeMockSFrameKeyEventPayload(
  callId: string,
  keyId: number,
  senderDeviceId: string,
  recipientDeviceIds: string[]
): MockSFrameKeyEventPayload {
  return {
    callId,
    keyId,
    senderDeviceId,
    recipients: recipientDeviceIds.map((deviceId) => ({
      deviceId,
      hpkeEnc: `mock-hpke-enc-${deviceId}`,
      hpkeCiphertext: `mock-hpke-ct-${deviceId}`,
    })),
  }
}
