import { describe, expect, test } from 'bun:test'
import { LABEL_SFRAME_CALL_SECRET, labelToId } from '@shared/crypto-labels.js'
import type { EnvelopeV3 } from '@shared/envelope-v3.js'
import { buildKeyEvent, parseKeyEvent } from './sframe-key-distribution.js'

const fakeKey = {} as CryptoKey // pure test stub, never actually used

// Identity-like stub: returns an envelope whose ct is the plaintext.
const stubSeal = async (plaintext: Uint8Array): Promise<EnvelopeV3> => ({
  v: 3,
  labelId: labelToId(LABEL_SFRAME_CALL_SECRET),
  enc: 'AAECAw', // base64url of [0,1,2,3]
  ct: Buffer.from(plaintext).toString('base64url'),
})

const stubOpen = async (envelope: EnvelopeV3): Promise<Uint8Array> => {
  return new Uint8Array(Buffer.from(envelope.ct, 'base64url'))
}

describe('buildKeyEvent', () => {
  test('shapes a schema-valid event', async () => {
    const secret = new Uint8Array(32).fill(0x11)
    const event = await buildKeyEvent({
      callId: '00000000-0000-4000-8000-000000000001',
      initiatorDeviceId: 'a'.repeat(64),
      keyId: 0,
      callSecret: secret,
      recipients: [
        { deviceId: 'a'.repeat(64), publicKey: fakeKey },
        { deviceId: 'b'.repeat(64), publicKey: fakeKey },
      ],
      senderIds: ['a'.repeat(64), 'b'.repeat(64)],
      reason: 'initial',
      hpkeSeal: stubSeal,
    })
    expect(event.type).toBe('call:sframe-key')
    expect(event.recipients).toHaveLength(2)
    expect(event.recipients[0].hpkeCiphertext).toMatch(/^[0-9a-f]+$/)
    // The ciphertext decodes back to the 32-byte secret of 0x11s
    expect(event.recipients[0].hpkeCiphertext).toBe('11'.repeat(32))
  })

  test('rejects callSecret of wrong size', async () => {
    await expect(
      buildKeyEvent({
        callId: '00000000-0000-4000-8000-000000000001',
        initiatorDeviceId: 'a'.repeat(64),
        keyId: 0,
        callSecret: new Uint8Array(16),
        recipients: [{ deviceId: 'a'.repeat(64), publicKey: fakeKey }],
        senderIds: ['a'.repeat(64)],
        reason: 'initial',
        hpkeSeal: stubSeal,
      })
    ).rejects.toThrow(/32 bytes/)
  })

  test('rejects empty recipients', async () => {
    await expect(
      buildKeyEvent({
        callId: '00000000-0000-4000-8000-000000000001',
        initiatorDeviceId: 'a'.repeat(64),
        keyId: 0,
        callSecret: new Uint8Array(32),
        recipients: [],
        senderIds: ['a'.repeat(64)],
        reason: 'initial',
        hpkeSeal: stubSeal,
      })
    ).rejects.toThrow(/at least one/)
  })
})

describe('parseKeyEvent', () => {
  test('round-trips through stubSeal+stubOpen', async () => {
    const secret = new Uint8Array(32).fill(0x42)
    const event = await buildKeyEvent({
      callId: '00000000-0000-4000-8000-000000000001',
      initiatorDeviceId: 'a'.repeat(64),
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: 'a'.repeat(64), publicKey: fakeKey }],
      senderIds: ['a'.repeat(64)],
      reason: 'initial',
      hpkeSeal: stubSeal,
    })
    const opened = await parseKeyEvent({
      event,
      localDeviceId: 'a'.repeat(64),
      privateKey: fakeKey,
      hpkeOpen: stubOpen,
    })
    expect(Array.from(opened)).toEqual(Array.from(secret))
  })

  test('throws when local device is not a recipient', async () => {
    const secret = new Uint8Array(32).fill(0x42)
    const event = await buildKeyEvent({
      callId: '00000000-0000-4000-8000-000000000001',
      initiatorDeviceId: 'a'.repeat(64),
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: 'a'.repeat(64), publicKey: fakeKey }],
      senderIds: ['a'.repeat(64)],
      reason: 'initial',
      hpkeSeal: stubSeal,
    })
    await expect(
      parseKeyEvent({
        event,
        localDeviceId: 'c'.repeat(64),
        privateKey: fakeKey,
        hpkeOpen: stubOpen,
      })
    ).rejects.toThrow(/not a recipient/)
  })
})
