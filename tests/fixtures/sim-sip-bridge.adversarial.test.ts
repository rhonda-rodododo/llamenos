/**
 * SimSipBridge adversarial test — verifies that the bridge never exposes
 * plaintext audio bytes. SFrame-encrypted frames pass through the bridge
 * as opaque ciphertext; this test asserts that known plaintext patterns
 * never appear in captured packets, while confirming the frames remain
 * valid ciphertext that the intended recipient can decrypt.
 */
import { describe, expect, it } from 'bun:test'
import { SimCaller } from './sim-caller'
import { SimSipBridge } from './sim-sip-bridge'

function containsSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true
  if (needle.length > haystack.length) return false
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

describe('SimSipBridge plaintext isolation', () => {
  it('captured packets never contain known plaintext bytes', async () => {
    // Setup: two callers bound to same call
    const callSecret = crypto.getRandomValues(new Uint8Array(32))
    const callId = 'test-plaintext-isolation'

    const alice = new SimCaller('alice-device')
    alice.bindCall(callSecret, callId)
    await alice.loadKey(0)

    const bob = new SimCaller('bob-device')
    bob.bindCall(callSecret, callId)
    await bob.loadKey(0)

    const bridge = new SimSipBridge()

    // Known distinctive plaintext patterns
    const plaintext1 = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe])
    const plaintext2 = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])

    // Seal and bridge both frames
    const sealed1 = await alice.produceFrame(plaintext1, 0, 1)
    bridge.bridgePacket('caller', sealed1)

    const sealed2 = await alice.produceFrame(plaintext2, 0, 2)
    bridge.bridgePacket('caller', sealed2)

    // Assert: no captured packet contains either plaintext as a contiguous substring
    const captured = bridge.getCapturedPackets()
    expect(captured.length).toBe(2)

    for (const pkt of captured) {
      const bytes = pkt.bytes
      for (const pt of [plaintext1, plaintext2]) {
        expect(containsSubsequence(bytes, pt)).toBe(false)
      }
    }

    // Verify Bob can still decrypt (proving the frames are valid ciphertext, not garbage)
    await bob.consumeFrame(sealed1, plaintext1, 0, 1, 'alice-device')
    await bob.consumeFrame(sealed2, plaintext2, 0, 2, 'alice-device')
  })

  it('bidirectional traffic remains opaque through the bridge', async () => {
    const callSecret = crypto.getRandomValues(new Uint8Array(32))
    const callId = 'test-bidirectional-opacity'

    const alice = new SimCaller('alice-device')
    alice.bindCall(callSecret, callId)
    await alice.loadKey(0)

    const bob = new SimCaller('bob-device')
    bob.bindCall(callSecret, callId)
    await bob.loadKey(0)

    const bridge = new SimSipBridge()

    // Alice sends to Bob
    const alicePt = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22])
    const aliceSealed = await alice.produceFrame(alicePt, 0, 1)
    bridge.bridgePacket('caller', aliceSealed)

    // Bob sends to Alice
    const bobPt = new Uint8Array([0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0x00])
    const bobSealed = await bob.produceFrame(bobPt, 0, 1)
    bridge.bridgePacket('volunteer', bobSealed)

    const captured = bridge.getCapturedPackets()
    expect(captured.length).toBe(2)

    // Verify directions
    expect(captured[0].direction).toBe('a-to-b')
    expect(captured[1].direction).toBe('b-to-a')

    // Neither plaintext appears in captured packets
    for (const pkt of captured) {
      expect(containsSubsequence(pkt.bytes, alicePt)).toBe(false)
      expect(containsSubsequence(pkt.bytes, bobPt)).toBe(false)
    }

    // Both sides can decrypt each other's frames
    await bob.consumeFrame(aliceSealed, alicePt, 0, 1, 'alice-device')
    await alice.consumeFrame(bobSealed, bobPt, 0, 1, 'bob-device')
  })
})
