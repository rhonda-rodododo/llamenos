import { describe, expect, test } from 'bun:test'
import { deriveBaseKey, importAesKey } from './cipher-suite.js'
import { openFrame, sealFrame } from './frame-codec.js'
import { asCiphertextBytes } from './sframe-types.js'
import { TRAILER_LENGTH } from './trailer.js'

const SECRET_A = new Uint8Array(32).fill(0x42)
const SECRET_B = new Uint8Array(32).fill(0x99)

async function makeKey(secret: Uint8Array, callId: string, senderId: string): Promise<CryptoKey> {
  const raw = deriveBaseKey(secret, callId, senderId)
  return importAesKey(raw)
}

function makePayload(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes)
}

describe('SFrame frame codec — round-trip', () => {
  test('seals and opens a basic frame (no codec header)', async () => {
    const key = await makeKey(SECRET_A, 'call-1', 'alice')
    const plaintext = makePayload([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const sealed = await sealFrame(plaintext, key, {
      callId: 'call-1',
      senderId: 'alice',
      keyId: 3,
      counter: 17,
      ssrc: 0xabcdef01,
      rtpTimestamp: 0x10203040,
    })
    // Sealed frame must contain trailer + tag + payload + (no header)
    expect(sealed.byteLength).toBe(plaintext.byteLength + 16 + TRAILER_LENGTH)

    const opened = await openFrame(sealed, key, {
      callId: 'call-1',
      senderId: 'alice',
      ssrc: 0xabcdef01,
      rtpTimestamp: 0x10203040,
    })
    expect(opened.counter).toBe(17)
    expect(opened.keyId).toBe(3)
    expect(Array.from(opened.plaintext)).toEqual(Array.from(plaintext))
  })

  test('preserves a non-zero codec header passthrough', async () => {
    const key = await makeKey(SECRET_A, 'call-2', 'alice')
    const frame = makePayload([0xaa, 0xbb, 0xcc, 1, 2, 3, 4, 5])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-2',
      senderId: 'alice',
      keyId: 0,
      counter: 0,
      ssrc: 1,
      rtpTimestamp: 1000,
      codecHeaderLength: 3,
    })
    // Header must be in the clear at the start of sealed buffer.
    expect(sealed[0]).toBe(0xaa)
    expect(sealed[1]).toBe(0xbb)
    expect(sealed[2]).toBe(0xcc)

    const opened = await openFrame(sealed, key, {
      callId: 'call-2',
      senderId: 'alice',
      ssrc: 1,
      rtpTimestamp: 1000,
      codecHeaderLength: 3,
    })
    expect(Array.from(opened.plaintext)).toEqual(Array.from(frame))
    expect(opened.counter).toBe(0)
    expect(opened.keyId).toBe(0)
  })

  test('1-byte payload (DTX-style) round-trips', async () => {
    const key = await makeKey(SECRET_A, 'call-dtx', 'alice')
    const frame = makePayload([0x55])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-dtx',
      senderId: 'alice',
      keyId: 0,
      counter: 1,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    const opened = await openFrame(sealed, key, {
      callId: 'call-dtx',
      senderId: 'alice',
      ssrc: 1,
      rtpTimestamp: 1,
    })
    expect(Array.from(opened.plaintext)).toEqual(Array.from(frame))
  })

  test('counter round-trips at 0, 1, and 0xdeadbeef', async () => {
    const key = await makeKey(SECRET_A, 'call-c', 'alice')
    for (const counter of [0, 1, 0xdeadbeef]) {
      const frame = makePayload([counter & 0xff, 0x42])
      const sealed = await sealFrame(frame, key, {
        callId: 'call-c',
        senderId: 'alice',
        keyId: 0,
        counter,
        ssrc: 7,
        rtpTimestamp: 7,
      })
      const opened = await openFrame(sealed, key, {
        callId: 'call-c',
        senderId: 'alice',
        ssrc: 7,
        rtpTimestamp: 7,
      })
      expect(opened.counter).toBe(counter)
      expect(Array.from(opened.plaintext)).toEqual(Array.from(frame))
    }
  })

  test('keyId round-trips at 0, 1, and 0x7f', async () => {
    const key = await makeKey(SECRET_A, 'call-k', 'alice')
    for (const keyId of [0, 1, 0x7f]) {
      const frame = makePayload([keyId, 0x99])
      const sealed = await sealFrame(frame, key, {
        callId: 'call-k',
        senderId: 'alice',
        keyId,
        counter: 5,
        ssrc: 1,
        rtpTimestamp: 1,
      })
      const opened = await openFrame(sealed, key, {
        callId: 'call-k',
        senderId: 'alice',
        ssrc: 1,
        rtpTimestamp: 1,
      })
      expect(opened.keyId).toBe(keyId)
      expect(Array.from(opened.plaintext)).toEqual(Array.from(frame))
    }
  })
})

describe('SFrame frame codec — AAD binding', () => {
  test('wrong key fails to open', async () => {
    const keyA = await makeKey(SECRET_A, 'call-1', 'alice')
    const keyB = await makeKey(SECRET_B, 'call-1', 'alice')
    const frame = makePayload([1, 2, 3, 4])
    const sealed = await sealFrame(frame, keyA, {
      callId: 'call-1',
      senderId: 'alice',
      keyId: 0,
      counter: 0,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    await expect(
      openFrame(sealed, keyB, {
        callId: 'call-1',
        senderId: 'alice',
        ssrc: 1,
        rtpTimestamp: 1,
      })
    ).rejects.toThrow()
  })

  test('wrong callId fails (AAD mismatch)', async () => {
    const key = await makeKey(SECRET_A, 'call-1', 'alice')
    const frame = makePayload([1, 2, 3, 4])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-1',
      senderId: 'alice',
      keyId: 0,
      counter: 0,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    await expect(
      openFrame(sealed, key, {
        callId: 'call-2',
        senderId: 'alice',
        ssrc: 1,
        rtpTimestamp: 1,
      })
    ).rejects.toThrow()
  })

  test('wrong senderId fails (AAD mismatch)', async () => {
    const key = await makeKey(SECRET_A, 'call-1', 'alice')
    const frame = makePayload([1, 2, 3, 4])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-1',
      senderId: 'alice',
      keyId: 0,
      counter: 0,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    await expect(
      openFrame(sealed, key, {
        callId: 'call-1',
        senderId: 'bob',
        ssrc: 1,
        rtpTimestamp: 1,
      })
    ).rejects.toThrow()
  })

  test('wrong ssrc fails (nonce mismatch)', async () => {
    const key = await makeKey(SECRET_A, 'call-1', 'alice')
    const frame = makePayload([1, 2, 3, 4])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-1',
      senderId: 'alice',
      keyId: 0,
      counter: 0,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    await expect(
      openFrame(sealed, key, {
        callId: 'call-1',
        senderId: 'alice',
        ssrc: 2,
        rtpTimestamp: 1,
      })
    ).rejects.toThrow()
  })

  test('wrong rtpTimestamp fails (nonce mismatch)', async () => {
    const key = await makeKey(SECRET_A, 'call-1', 'alice')
    const frame = makePayload([1, 2, 3, 4])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-1',
      senderId: 'alice',
      keyId: 0,
      counter: 0,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    await expect(
      openFrame(sealed, key, {
        callId: 'call-1',
        senderId: 'alice',
        ssrc: 1,
        rtpTimestamp: 2,
      })
    ).rejects.toThrow()
  })
})

describe('SFrame frame codec — tamper detection', () => {
  test('flipping a ciphertext byte fails GCM tag check', async () => {
    const key = await makeKey(SECRET_A, 'call-t', 'alice')
    const frame = makePayload([1, 2, 3, 4, 5, 6, 7, 8])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-t',
      senderId: 'alice',
      keyId: 0,
      counter: 0,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    // Flip a byte inside the ciphertext region (well before the trailer).
    const tampered = asCiphertextBytes(new Uint8Array(sealed))
    tampered[2] ^= 0x01
    await expect(
      openFrame(tampered, key, {
        callId: 'call-t',
        senderId: 'alice',
        ssrc: 1,
        rtpTimestamp: 1,
      })
    ).rejects.toThrow()
  })

  test('flipping the keyId in the trailer fails AAD', async () => {
    const key = await makeKey(SECRET_A, 'call-t', 'alice')
    const frame = makePayload([1, 2, 3, 4])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-t',
      senderId: 'alice',
      keyId: 1,
      counter: 0,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    const tampered = asCiphertextBytes(new Uint8Array(sealed))
    // Last byte is the config byte; flip a low (keyId) bit.
    tampered[tampered.byteLength - 1] ^= 0x01
    await expect(
      openFrame(tampered, key, {
        callId: 'call-t',
        senderId: 'alice',
        ssrc: 1,
        rtpTimestamp: 1,
      })
    ).rejects.toThrow()
  })

  test('flipping the counter in the trailer fails (nonce changes)', async () => {
    const key = await makeKey(SECRET_A, 'call-t', 'alice')
    const frame = makePayload([1, 2, 3, 4])
    const sealed = await sealFrame(frame, key, {
      callId: 'call-t',
      senderId: 'alice',
      keyId: 0,
      counter: 5,
      ssrc: 1,
      rtpTimestamp: 1,
    })
    const tampered = asCiphertextBytes(new Uint8Array(sealed))
    // Counter is the 4 bytes before the config byte.
    tampered[tampered.byteLength - 2] ^= 0x01
    await expect(
      openFrame(tampered, key, {
        callId: 'call-t',
        senderId: 'alice',
        ssrc: 1,
        rtpTimestamp: 1,
      })
    ).rejects.toThrow()
  })
})

describe('SFrame frame codec — input validation', () => {
  test('sealFrame rejects negative codecHeaderLength', async () => {
    const key = await makeKey(SECRET_A, 'call-1', 'alice')
    await expect(
      sealFrame(makePayload([1, 2, 3]), key, {
        callId: 'call-1',
        senderId: 'alice',
        keyId: 0,
        counter: 0,
        ssrc: 1,
        rtpTimestamp: 1,
        codecHeaderLength: -1,
      })
    ).rejects.toThrow(/codecHeaderLength/)
  })

  test('sealFrame rejects codecHeaderLength larger than frame', async () => {
    const key = await makeKey(SECRET_A, 'call-1', 'alice')
    await expect(
      sealFrame(makePayload([1, 2, 3]), key, {
        callId: 'call-1',
        senderId: 'alice',
        keyId: 0,
        counter: 0,
        ssrc: 1,
        rtpTimestamp: 1,
        codecHeaderLength: 4,
      })
    ).rejects.toThrow(/codecHeaderLength/)
  })

  test('openFrame rejects frame too short to decrypt', async () => {
    const key = await makeKey(SECRET_A, 'call-1', 'alice')
    // Need at least header + tag(16) + trailer(5) = 21 bytes for headerLen=0
    const tooShort = asCiphertextBytes(new Uint8Array(20))
    await expect(
      openFrame(tooShort, key, {
        callId: 'call-1',
        senderId: 'alice',
        ssrc: 1,
        rtpTimestamp: 1,
      })
    ).rejects.toThrow(/too short/)
  })
})
