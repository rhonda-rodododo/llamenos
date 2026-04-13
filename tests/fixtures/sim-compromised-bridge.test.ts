import { describe, expect, test } from 'bun:test'
import { asCiphertextBytes } from '../../src/shared/sframe/sframe-types.js'
import { SimCaller } from './sim-caller.js'
import { SimCompromisedBridge } from './sim-compromised-bridge.js'

describe('SimCompromisedBridge', () => {
  const callSecret = new Uint8Array(32).fill(0x33)
  const callId = '00000000-0000-4000-8000-000000000003'

  async function makeBoundCaller(deviceId: string): Promise<SimCaller> {
    const caller = new SimCaller(deviceId)
    caller.bindCall(callSecret, callId)
    await caller.loadKey(0)
    return caller
  }

  test('tampering with one ciphertext byte breaks decryption', async () => {
    const alice = await makeBoundCaller('alice')
    const bob = await makeBoundCaller('bob')
    const bridge = new SimCompromisedBridge()
    const plain = new Uint8Array([0x01, 0x77, 0x88, 0x99])
    const wire = await alice.produceFrame(plain, 0, 1)
    // Position 5 lands inside the ciphertext region: the frame has no
    // codec header, so bytes [0..plain.length-1] are ciphertext, bytes
    // [plain.length..plain.length+15] are the AES-GCM tag, and the final
    // 5 bytes are the trailer. For a 4-byte plaintext that's ct[0..3],
    // tag[4..19], trailer[20..24] — position 5 is inside the tag, which
    // is still covered by AES-GCM verification.
    const tampered = asCiphertextBytes(bridge.modifyFrame(wire, 5, 0xff))
    await expect(bob.consumeFrame(tampered, plain, 0, 1, 'alice')).rejects.toThrow()
  })

  test('tampering with the trailer keyId also breaks decryption', async () => {
    const alice = await makeBoundCaller('alice-2')
    const bob = await makeBoundCaller('bob-2')
    const bridge = new SimCompromisedBridge()
    const plain = new Uint8Array([0x01, 0x22, 0x33])
    const wire = await alice.produceFrame(plain, 0, 2)
    // Flip keyId from 0 → 1: the sender sealed under keyId 0 so the AAD
    // encodes 0; overwriting the trailer byte to 1 makes the receiver's
    // AAD diverge and AES-GCM authentication fails.
    const tampered = asCiphertextBytes(bridge.modifyTrailer(wire, 'keyId', 1))
    await expect(bob.consumeFrame(tampered, plain, 0, 2, 'alice-2')).rejects.toThrow()
  })

  test('tampering with the trailer counter breaks decryption', async () => {
    const alice = await makeBoundCaller('alice-3')
    const bob = await makeBoundCaller('bob-3')
    const bridge = new SimCompromisedBridge()
    const plain = new Uint8Array([0x01, 0xaa, 0xbb])
    const wire = await alice.produceFrame(plain, 0, 42)
    // Flip counter from 42 → 43: the AES-GCM nonce is derived from the
    // counter so the receiver will try to decrypt with the wrong nonce.
    const tampered = asCiphertextBytes(bridge.modifyTrailer(wire, 'counter', 43))
    await expect(bob.consumeFrame(tampered, plain, 0, 42, 'alice-3')).rejects.toThrow()
  })

  test('maybeDrop returns null when dropRate is 1.0', () => {
    const bridge = new SimCompromisedBridge()
    bridge.setDropRate(1.0)
    const dropped = bridge.maybeDrop(new Uint8Array([0x01]))
    expect(dropped).toBeNull()
  })

  test('maybeDrop returns the frame identity when dropRate is 0.0', () => {
    const bridge = new SimCompromisedBridge()
    bridge.setDropRate(0.0)
    const input = new Uint8Array([0x02, 0x03])
    const kept = bridge.maybeDrop(input)
    expect(kept).toBe(input)
  })

  test('setDropRate rejects values outside [0, 1]', () => {
    const bridge = new SimCompromisedBridge()
    expect(() => bridge.setDropRate(-0.1)).toThrow(/\[0, 1\]/)
    expect(() => bridge.setDropRate(1.1)).toThrow(/\[0, 1\]/)
    expect(() => bridge.setDropRate(Number.NaN)).toThrow(/\[0, 1\]/)
  })

  test('modifyFrame does not mutate the input', async () => {
    const alice = await makeBoundCaller('alice-4')
    const bridge = new SimCompromisedBridge()
    const plain = new Uint8Array([0x01, 0xde, 0xad])
    const wire = await alice.produceFrame(plain, 0, 7)
    const before = new Uint8Array(wire)
    bridge.modifyFrame(wire, 0, 0x00)
    expect(new Uint8Array(wire)).toEqual(before)
  })

  test('modifyFrame rejects out-of-range positions', () => {
    const bridge = new SimCompromisedBridge()
    const frame = new Uint8Array([0x01, 0x02, 0x03])
    expect(() => bridge.modifyFrame(frame, -1, 0)).toThrow(/out of range/)
    expect(() => bridge.modifyFrame(frame, 3, 0)).toThrow(/out of range/)
  })
})
