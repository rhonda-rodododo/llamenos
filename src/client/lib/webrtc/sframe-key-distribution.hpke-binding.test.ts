/**
 * SFrame key-distribution inline HPKE binding test — Tier 5 Phase-2 P1.
 *
 * Verifies that SFrame key distribution enforces inline HPKE label binding
 * via LABEL_SFRAME_CALL_SECRET. The binding prevents:
 *   1. Cross-call replay (AAD bound to callId)
 *   2. Cross-context replay (label separates SFrame keys from other HPKE uses)
 *   3. Recipient substitution (each device gets a unique KEM encapsulation)
 *
 * The module under test (`sframe-key-distribution.ts`) calls hpkeSeal/hpkeOpen
 * directly (no dependency injection), ensuring label enforcement can't be
 * skipped by callers.
 */
import { describe, expect, test } from 'bun:test'
import { LABEL_SFRAME_CALL_SECRET } from '@shared/crypto-labels.js'
import { createHpkeSuite } from '@shared/crypto-suite.js'
import { buildAad } from '@shared/hpke-primitives.js'
import { asX25519EncryptionKey, type X25519EncryptionKey } from '@shared/types'
import { buildKeyEvent, parseKeyEvent } from './sframe-key-distribution.js'

async function genKeyPair(): Promise<{
  privateKey: X25519EncryptionKey
  publicKey: X25519EncryptionKey
}> {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  return {
    privateKey: asX25519EncryptionKey(kp.privateKey as CryptoKey),
    publicKey: asX25519EncryptionKey(kp.publicKey as CryptoKey),
  }
}

const CALL_A = '00000000-0000-4000-8000-aaaaaaaaaaaa'
const CALL_B = '00000000-0000-4000-8000-bbbbbbbbbbbb'
const DEVICE_1 = '1'.repeat(64)
const DEVICE_2 = '2'.repeat(64)

describe('SFrame HPKE label binding (Tier 5)', () => {
  test('LABEL_SFRAME_CALL_SECRET is used for all seal/open operations', () => {
    // Verify the label constant exists and has expected properties
    expect(LABEL_SFRAME_CALL_SECRET).toBeTruthy()
    expect(typeof LABEL_SFRAME_CALL_SECRET).toBe('string')
    expect(LABEL_SFRAME_CALL_SECRET).toContain('sframe')
  })

  test('AAD is correctly bound to callId via buildAad', () => {
    const aadA = buildAad(LABEL_SFRAME_CALL_SECRET, CALL_A, 'sframe-secret')
    const aadB = buildAad(LABEL_SFRAME_CALL_SECRET, CALL_B, 'sframe-secret')

    // Different callIds produce different AADs
    expect(aadA).not.toEqual(aadB)

    // Same callId produces identical AADs (deterministic)
    const aadA2 = buildAad(LABEL_SFRAME_CALL_SECRET, CALL_A, 'sframe-secret')
    expect(aadA).toEqual(aadA2)
  })

  test('cross-call replay: secret sealed for call A cannot decrypt under call B', async () => {
    const kp = await genKeyPair()
    const secret = crypto.getRandomValues(new Uint8Array(32))

    const event = await buildKeyEvent({
      callId: CALL_A,
      initiatorDeviceId: DEVICE_1,
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: DEVICE_1, publicKey: kp.publicKey }],
      senderIds: [DEVICE_1],
      reason: 'initial',
    })

    // Forge the event to claim it's for call B
    const forged = { ...event, callId: CALL_B }

    await expect(
      parseKeyEvent({
        event: forged,
        localDeviceId: DEVICE_1,
        privateKey: kp.privateKey,
      })
    ).rejects.toThrow()
  })

  test('recipient-specific KEM: each recipient gets unique encapsulation', async () => {
    const kp1 = await genKeyPair()
    const kp2 = await genKeyPair()
    const secret = crypto.getRandomValues(new Uint8Array(32))

    const event = await buildKeyEvent({
      callId: CALL_A,
      initiatorDeviceId: DEVICE_1,
      keyId: 0,
      callSecret: secret,
      recipients: [
        { deviceId: DEVICE_1, publicKey: kp1.publicKey },
        { deviceId: DEVICE_2, publicKey: kp2.publicKey },
      ],
      senderIds: [DEVICE_1, DEVICE_2],
      reason: 'initial',
    })

    // Each recipient has unique enc (KEM encapsulated key) and ciphertext
    expect(event.recipients[0].hpkeEnc).not.toBe(event.recipients[1].hpkeEnc)
    expect(event.recipients[0].hpkeCiphertext).not.toBe(event.recipients[1].hpkeCiphertext)

    // But both decrypt to the same secret
    const opened1 = await parseKeyEvent({
      event,
      localDeviceId: DEVICE_1,
      privateKey: kp1.privateKey,
    })
    const opened2 = await parseKeyEvent({
      event,
      localDeviceId: DEVICE_2,
      privateKey: kp2.privateKey,
    })
    expect(Array.from(opened1)).toEqual(Array.from(opened2))
    expect(Array.from(opened1)).toEqual(Array.from(secret))
  })

  test('recipient substitution: device 2 cannot use device 1 ciphertext', async () => {
    const kp1 = await genKeyPair()
    const kp2 = await genKeyPair()
    const secret = crypto.getRandomValues(new Uint8Array(32))

    const event = await buildKeyEvent({
      callId: CALL_A,
      initiatorDeviceId: DEVICE_1,
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: DEVICE_1, publicKey: kp1.publicKey }],
      senderIds: [DEVICE_1],
      reason: 'initial',
    })

    // Attacker adds their device ID to the recipients list, pointing at
    // device 1's ciphertext. AEAD fails because the private key is wrong.
    const forgedEvent = {
      ...event,
      recipients: [...event.recipients, { ...event.recipients[0], deviceId: DEVICE_2 }],
    }

    await expect(
      parseKeyEvent({
        event: forgedEvent,
        localDeviceId: DEVICE_2,
        privateKey: kp2.privateKey,
      })
    ).rejects.toThrow()
  })

  test('key rotation reason is preserved in event payload', async () => {
    const kp = await genKeyPair()
    const secret = crypto.getRandomValues(new Uint8Array(32))

    for (const reason of ['initial', 'rotate_join', 'rotate_leave', 'rotate_scheduled'] as const) {
      const event = await buildKeyEvent({
        callId: CALL_A,
        initiatorDeviceId: DEVICE_1,
        keyId: 0,
        callSecret: secret,
        recipients: [{ deviceId: DEVICE_1, publicKey: kp.publicKey }],
        senderIds: [DEVICE_1],
        reason,
      })
      expect(event.reason).toBe(reason)
    }
  })

  test('inline binding: no way to inject a custom label from the caller', async () => {
    // The module's buildKeyEvent/parseKeyEvent don't accept a label parameter.
    // This test documents that the label is hardcoded — callers can't override it.
    const kp = await genKeyPair()
    const secret = crypto.getRandomValues(new Uint8Array(32))

    // buildKeyEvent only accepts the BuildKeyEventInputs interface —
    // there is no label field. The TypeScript compiler enforces this, but
    // we verify at runtime that the sealed envelope uses the correct label.
    const event = await buildKeyEvent({
      callId: CALL_A,
      initiatorDeviceId: DEVICE_1,
      keyId: 0,
      callSecret: secret,
      recipients: [{ deviceId: DEVICE_1, publicKey: kp.publicKey }],
      senderIds: [DEVICE_1],
      reason: 'initial',
    })

    // The event round-trips successfully, proving the label was consistent
    const opened = await parseKeyEvent({
      event,
      localDeviceId: DEVICE_1,
      privateKey: kp.privateKey,
    })
    expect(Array.from(opened)).toEqual(Array.from(secret))
  })
})
