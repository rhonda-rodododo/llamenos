import { describe, expect, test } from 'bun:test'
import {
  CallModePayloadSchema,
  DtlsBindingEventPayloadSchema,
  SFrameKeyEventPayloadSchema,
} from './nostr-events.js'

const validCallId = '00000000-0000-4000-8000-000000000001'
const hex64A = 'a'.repeat(64)
const hex64B = 'b'.repeat(64)

describe('SFrameKeyEventPayloadSchema', () => {
  const base = {
    type: 'call:sframe-key' as const,
    callId: validCallId,
    initiatorDeviceId: hex64A,
    keyId: 0,
    recipients: [{ deviceId: hex64A, hpkeEnc: 'deadbeef', hpkeCiphertext: 'cafebabe' }],
    senderIds: [hex64A],
    issuedAt: '2026-04-11T00:00:00.000Z',
    reason: 'initial' as const,
  }

  test('accepts valid payload (initial)', () => {
    expect(() => SFrameKeyEventPayloadSchema.parse(base)).not.toThrow()
  })

  test.each(['initial', 'rotate_join', 'rotate_leave', 'rotate_scheduled'] as const)(
    'accepts reason %s',
    (reason) => {
      expect(() => SFrameKeyEventPayloadSchema.parse({ ...base, reason })).not.toThrow()
    }
  )

  test('rejects keyId > 127', () => {
    expect(() => SFrameKeyEventPayloadSchema.parse({ ...base, keyId: 128 })).toThrow()
  })

  test('rejects empty recipients', () => {
    expect(() => SFrameKeyEventPayloadSchema.parse({ ...base, recipients: [] })).toThrow()
  })

  test('rejects non-hex hpkeEnc', () => {
    expect(() =>
      SFrameKeyEventPayloadSchema.parse({
        ...base,
        recipients: [{ deviceId: hex64A, hpkeEnc: 'ZZZZ', hpkeCiphertext: 'cafebabe' }],
      })
    ).toThrow()
  })

  test('rejects more than 32 senderIds', () => {
    const many = Array.from({ length: 33 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32))
    expect(() => SFrameKeyEventPayloadSchema.parse({ ...base, senderIds: many })).toThrow()
  })

  test('rejects non-uuid callId', () => {
    expect(() => SFrameKeyEventPayloadSchema.parse({ ...base, callId: 'not-a-uuid' })).toThrow()
  })
})

describe('DtlsBindingEventPayloadSchema', () => {
  const base = {
    type: 'call:dtls-binding' as const,
    callId: validCallId,
    deviceId: hex64A,
    fingerprint: hex64B,
    bindingHash: hex64A,
    issuedAt: '2026-04-11T00:00:00.000Z',
  }

  test('accepts valid', () => {
    expect(() => DtlsBindingEventPayloadSchema.parse(base)).not.toThrow()
  })

  test('rejects fingerprint containing colons', () => {
    expect(() =>
      DtlsBindingEventPayloadSchema.parse({
        ...base,
        fingerprint: `ab:cd:ef${'0'.repeat(56)}`,
      })
    ).toThrow()
  })

  test('rejects fingerprint of wrong length', () => {
    expect(() =>
      DtlsBindingEventPayloadSchema.parse({ ...base, fingerprint: 'ab'.repeat(16) })
    ).toThrow()
  })
})

describe('CallModePayloadSchema', () => {
  test('accepts pstn with reason and hubId', () => {
    expect(() =>
      CallModePayloadSchema.parse({
        type: 'call:mode',
        callId: 'CA1234567890abcdef1234567890abcd',
        mode: 'pstn',
        reason: 'caller_on_pstn_trunk',
        hubId: 'hub-1',
      })
    ).not.toThrow()
  })

  test('accepts sframe without reason', () => {
    expect(() =>
      CallModePayloadSchema.parse({
        type: 'call:mode',
        callId: validCallId,
        mode: 'sframe',
        hubId: 'global',
      })
    ).not.toThrow()
  })

  test('accepts non-UUID callId (Twilio SID)', () => {
    expect(() =>
      CallModePayloadSchema.parse({
        type: 'call:mode',
        callId: 'CA00000000000000000000000000000000',
        mode: 'pstn',
        hubId: 'hub-1',
      })
    ).not.toThrow()
  })

  test('rejects empty callId', () => {
    expect(() =>
      CallModePayloadSchema.parse({
        type: 'call:mode',
        callId: '',
        mode: 'pstn',
        hubId: 'hub-1',
      })
    ).toThrow()
  })

  test('rejects unknown mode', () => {
    expect(() =>
      CallModePayloadSchema.parse({
        type: 'call:mode',
        callId: validCallId,
        mode: 'quantum',
        hubId: 'hub-1',
      })
    ).toThrow()
  })

  test('rejects missing hubId', () => {
    expect(() =>
      CallModePayloadSchema.parse({
        type: 'call:mode',
        callId: validCallId,
        mode: 'sframe',
      })
    ).toThrow()
  })
})
