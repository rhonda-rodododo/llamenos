import { describe, expect, test } from 'bun:test'
import {
  MOCK_RTP_HEADER_BYTES,
  buildMockRtpHeader,
  buildMockRtpPacket,
  makeMockCallSecret,
  makeMockSFrameKeyEventPayload,
  parseMockRtpHeader,
} from './sframe-test-utils'

describe('sframe-test-utils — mock RTP', () => {
  test('header round-trips all fields', () => {
    const fields = {
      version: 2,
      padding: false,
      extension: false,
      csrcCount: 0,
      marker: true,
      payloadType: 111,
      sequenceNumber: 54321,
      timestamp: 0xdeadbeef,
      ssrc: 0xcafebabe,
    }
    const header = buildMockRtpHeader(fields)
    expect(header.length).toBe(MOCK_RTP_HEADER_BYTES)
    expect(parseMockRtpHeader(header)).toEqual(fields)
  })

  test('buildMockRtpPacket concatenates header + payload', () => {
    const fields = {
      version: 2,
      padding: false,
      extension: false,
      csrcCount: 0,
      marker: false,
      payloadType: 0,
      sequenceNumber: 1,
      timestamp: 1,
      ssrc: 1,
    }
    const payload = new Uint8Array([0xaa, 0xbb, 0xcc])
    const packet = buildMockRtpPacket(fields, payload)
    expect(packet.length).toBe(MOCK_RTP_HEADER_BYTES + payload.length)
    expect(packet.slice(MOCK_RTP_HEADER_BYTES)).toEqual(payload)
  })

  test('buildMockRtpHeader rejects CSRCs', () => {
    expect(() =>
      buildMockRtpHeader({
        version: 2,
        padding: false,
        extension: false,
        csrcCount: 1,
        marker: false,
        payloadType: 0,
        sequenceNumber: 0,
        timestamp: 0,
        ssrc: 0,
      })
    ).toThrow()
  })

  test('parseMockRtpHeader rejects short input', () => {
    expect(() => parseMockRtpHeader(new Uint8Array(4))).toThrow()
  })

  test('parseMockRtpHeader rejects headers with csrcCount > 0 (symmetric with builder)', () => {
    const bytes = new Uint8Array(MOCK_RTP_HEADER_BYTES)
    bytes[0] = 0x81 // version 2, csrcCount 1
    expect(() => parseMockRtpHeader(bytes)).toThrow(/CSRC/)
  })

  test('round-trips timestamp and ssrc at the uint32 upper bound', () => {
    const fields = {
      version: 2,
      padding: false,
      extension: false,
      csrcCount: 0,
      marker: false,
      payloadType: 111,
      sequenceNumber: 0xffff,
      timestamp: 0xffffffff,
      ssrc: 0xffffffff,
    }
    const header = buildMockRtpHeader(fields)
    const parsed = parseMockRtpHeader(header)
    expect(parsed.timestamp).toBe(0xffffffff)
    expect(parsed.ssrc).toBe(0xffffffff)
    expect(parsed.sequenceNumber).toBe(0xffff)
  })

  test('round-trips timestamp at the uint32 sign boundary', () => {
    const fields = {
      version: 2,
      padding: false,
      extension: false,
      csrcCount: 0,
      marker: false,
      payloadType: 0,
      sequenceNumber: 0,
      timestamp: 0x80000000,
      ssrc: 0x80000000,
    }
    const header = buildMockRtpHeader(fields)
    const parsed = parseMockRtpHeader(header)
    expect(parsed.timestamp).toBe(0x80000000)
    expect(parsed.ssrc).toBe(0x80000000)
  })
})

describe('sframe-test-utils — mock key material', () => {
  test('makeMockCallSecret is deterministic', () => {
    expect(makeMockCallSecret(1)).toEqual(makeMockCallSecret(1))
    expect(makeMockCallSecret(1)).not.toEqual(makeMockCallSecret(2))
  })

  test('makeMockCallSecret is 32 bytes', () => {
    expect(makeMockCallSecret(7).length).toBe(32)
  })

  test('makeMockSFrameKeyEventPayload builds per-recipient stub envelopes', () => {
    const payload = makeMockSFrameKeyEventPayload('call-1', 0, 'device-a', ['device-b', 'device-c'])
    expect(payload.callId).toBe('call-1')
    expect(payload.keyId).toBe(0)
    expect(payload.senderDeviceId).toBe('device-a')
    expect(payload.recipients).toHaveLength(2)
    expect(payload.recipients[0].deviceId).toBe('device-b')
    expect(payload.recipients[0].hpkeEnc).toContain('device-b')
    expect(payload.recipients[1].hpkeCiphertext).toContain('device-c')
  })
})
