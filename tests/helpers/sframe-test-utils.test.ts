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
