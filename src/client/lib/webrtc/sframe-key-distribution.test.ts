import { describe, expect, test } from 'bun:test'
import { createHpkeSuite } from '@shared/crypto-suite.js'
import { buildKeyEvent, parseKeyEvent } from './sframe-key-distribution.js'

async function genKeyPair(): Promise<CryptoKeyPair> {
  const suite = createHpkeSuite()
  return (await suite.kem.generateKeyPair()) as CryptoKeyPair
}

const CALL_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_CALL_ID = '00000000-0000-4000-8000-000000000002'
const DEVICE_A = 'a'.repeat(64)
const DEVICE_B = 'b'.repeat(64)
const DEVICE_C = 'c'.repeat(64)

describe('buildKeyEvent', () => {
  test('shapes a schema-valid event with two real HPKE recipients', async () => {
    const kpA = await genKeyPair()
    const kpB = await genKeyPair()
    const secret = new Uint8Array(32).fill(0x11)
    const event = await buildKeyEvent({
      callId: CALL_ID,
      initiatorDeviceId: DEVICE_A,
      keyId: 0,
      callSecret: secret,
      recipients: [
        { deviceId: DEVICE_A, publicKey: kpA.publicKey },
        { deviceId: DEVICE_B, publicKey: kpB.publicKey },
      ],
      senderIds: [DEVICE_A, DEVICE_B],
      reason: 'initial',
    })
    expect(event.type).toBe('call:sframe-key')
    expect(event.recipients).toHaveLength(2)
    expect(event.recipients[0].hpkeCiphertext).toMatch(/^[0-9a-f]+$/)
    expect(event.recipients[0].hpkeEnc).toMatch(/^[0-9a-f]+$/)
    // Different KEM encapsulations => different ciphertexts across recipients.
    expect(event.recipients[0].hpkeCiphertext).not.toBe(event.recipients[1].hpkeCiphertext)
  })

  test('rejects callSecret of wrong size', async () => {
    const kp = await genKeyPair()
    await expect(
      buildKeyEvent({
        callId: CALL_ID,
        initiatorDeviceId: DEVICE_A,
        keyId: 0,
        callSecret: new Uint8Array(16),
        recipients: [{ deviceId: DEVICE_A, publicKey: kp.publicKey }],
        senderIds: [DEVICE_A],
        reason: 'initial',
      })
    ).rejects.toThrow(/32 bytes/)
  })

  test('rejects empty recipients', async () => {
    await expect(
      buildKeyEvent({
        callId: CALL_ID,
        initiatorDeviceId: DEVICE_A,
        keyId: 0,
        callSecret: new Uint8Array(32),
        recipients: [],
        senderIds: [DEVICE_A],
        reason: 'initial',
      })
    ).rejects.toThrow(/at least one/)
  })
})

describe('parseKeyEvent', () => {
  test('round-trips a real HPKE seal/open pair', async () => {
    const kp = await genKeyPair()
    const secret = new Uint8Array(32).fill(0x42)
    const event = await buildKeyEvent({
      callId: CALL_ID,
      initiatorDeviceId: DEVICE_A,
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: DEVICE_A, publicKey: kp.publicKey }],
      senderIds: [DEVICE_A],
      reason: 'initial',
    })
    const opened = await parseKeyEvent({
      event,
      localDeviceId: DEVICE_A,
      privateKey: kp.privateKey,
    })
    expect(Array.from(opened)).toEqual(Array.from(secret))
  })

  test('throws when local device is not a recipient', async () => {
    const kp = await genKeyPair()
    const secret = new Uint8Array(32).fill(0x42)
    const event = await buildKeyEvent({
      callId: CALL_ID,
      initiatorDeviceId: DEVICE_A,
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: DEVICE_A, publicKey: kp.publicKey }],
      senderIds: [DEVICE_A],
      reason: 'initial',
    })
    await expect(
      parseKeyEvent({
        event,
        localDeviceId: DEVICE_C,
        privateKey: kp.privateKey,
      })
    ).rejects.toThrow(/not a recipient/)
  })

  test('AAD binding: envelope from one callId cannot be replayed into another', async () => {
    // Seal under CALL_ID, then hand the event to parseKeyEvent with a
    // forged callId — AEAD must reject because AAD is bound to callId.
    const kp = await genKeyPair()
    const secret = new Uint8Array(32).fill(0x7e)
    const real = await buildKeyEvent({
      callId: CALL_ID,
      initiatorDeviceId: DEVICE_A,
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: DEVICE_A, publicKey: kp.publicKey }],
      senderIds: [DEVICE_A],
      reason: 'initial',
    })
    const forged = { ...real, callId: OTHER_CALL_ID }
    await expect(
      parseKeyEvent({
        event: forged,
        localDeviceId: DEVICE_A,
        privateKey: kp.privateKey,
      })
    ).rejects.toThrow()
  })

  test('wrong recipient private key fails AEAD', async () => {
    const kpRecipient = await genKeyPair()
    const kpAttacker = await genKeyPair()
    const secret = new Uint8Array(32).fill(0x55)
    const event = await buildKeyEvent({
      callId: CALL_ID,
      initiatorDeviceId: DEVICE_A,
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: DEVICE_A, publicKey: kpRecipient.publicKey }],
      senderIds: [DEVICE_A],
      reason: 'initial',
    })
    await expect(
      parseKeyEvent({
        event,
        localDeviceId: DEVICE_A,
        privateKey: kpAttacker.privateKey,
      })
    ).rejects.toThrow()
  })
})
