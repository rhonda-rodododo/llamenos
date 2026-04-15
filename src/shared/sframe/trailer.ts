/**
 * SFrame trailer layout (Jitsi JFrame v1 compatible):
 *
 *   [ ... payload+tag ... ][ counter: 4 bytes BE ][ config: 1 byte ]
 *
 * Config byte: (reserved<<7) | (keyId & 0x7F)
 *
 * The trailer travels in the clear (it's needed by the receiver before
 * decryption to look up the key and reconstruct the nonce). Its contents are
 * still bound cryptographically: the keyId is part of the AAD and the counter
 * is part of the nonce, so flipping any trailer bit causes AES-GCM
 * authentication to fail.
 */

export const TRAILER_LENGTH = 5 // 4 counter + 1 config

interface ParsedTrailer {
  counter: number
  keyId: number
}

export function parseTrailer(frame: Uint8Array): ParsedTrailer {
  if (frame.byteLength < TRAILER_LENGTH) {
    throw new Error(`sframe: frame shorter than trailer (${frame.byteLength})`)
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const counter = view.getUint32(frame.byteLength - TRAILER_LENGTH, false)
  const config = frame[frame.byteLength - 1] ?? 0
  if ((config & 0x80) !== 0) {
    throw new Error('sframe: reserved trailer bit set')
  }
  const keyId = config & 0x7f
  return { counter, keyId }
}

export function writeTrailer(counter: number, keyId: number): Uint8Array {
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 0x7f) {
    throw new Error(`sframe: keyId out of range (${keyId})`)
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) {
    throw new Error(`sframe: counter out of range (${counter})`)
  }
  const out = new Uint8Array(TRAILER_LENGTH)
  const view = new DataView(out.buffer)
  view.setUint32(0, counter >>> 0, false)
  out[4] = keyId & 0x7f
  return out
}
