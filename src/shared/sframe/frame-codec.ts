import { LABEL_SFRAME_BASE_KEY, LABEL_SFRAME_CALL_SECRET, labelToId } from '../crypto-labels.js'
import { SFRAME_CIPHER_SUITE } from './cipher-suite.js'
import {
  type PlaintextBytes,
  type SealedFrame,
  asPlaintextBytes,
  asSealedFrame,
} from './sframe-types.js'
import { TRAILER_LENGTH, parseTrailer, writeTrailer } from './trailer.js'

/**
 * Per-frame seal/open helpers for the Llámenos voice E2EE pipeline.
 *
 * Wire layout (structurally modeled after Jitsi JFrame v1, NOT wire-compatible):
 *   [ codec header (passthrough) ][ ciphertext + GCM tag ][ counter | keyId ]
 *
 * AES-GCM nonce (96 bits):
 *   nonce = SSRC(4 BE) || rtpTimestamp(4 BE) || counter(4 BE)
 *
 * AAD binds the ciphertext to the call + sender + keyId so a frame replayed
 * across calls, senders, or keys fails to authenticate:
 *   aad = LABEL_SFRAME_BASE_KEY || 0x00
 *       || labelToId(LABEL_SFRAME_CALL_SECRET)
 *       || callId  || 0x00
 *       || senderId || 0x00
 *       || keyId
 *
 * The receiver looks up the correct CryptoKey by the keyId in the trailer
 * before calling openFrame — this module is intentionally key-store agnostic.
 */

interface SealContext {
  callId: string
  senderId: string
  keyId: number
  counter: number
  ssrc: number
  rtpTimestamp: number
  codecHeaderLength?: number
}

interface OpenContext {
  callId: string
  senderId: string
  ssrc: number
  rtpTimestamp: number
  codecHeaderLength?: number
}

interface OpenResult {
  plaintext: PlaintextBytes
  counter: number
  keyId: number
}

const ENCODER = new TextEncoder()

function utf8(s: string): Uint8Array {
  return ENCODER.encode(s)
}

function buildNonce(ssrc: number, rtpTimestamp: number, counter: number): Uint8Array {
  const nonce = new Uint8Array(SFRAME_CIPHER_SUITE.nonceLength)
  const view = new DataView(nonce.buffer)
  view.setUint32(0, ssrc >>> 0, false)
  view.setUint32(4, rtpTimestamp >>> 0, false)
  view.setUint32(8, counter >>> 0, false)
  return nonce
}

function buildAad(callId: string, senderId: string, keyId: number): Uint8Array {
  const labelBytes = utf8(LABEL_SFRAME_BASE_KEY)
  const callIdBytes = utf8(callId)
  const senderBytes = utf8(senderId)
  const callSecretByte = labelToId(LABEL_SFRAME_CALL_SECRET)
  const total =
    labelBytes.length +
    1 + // 0x00 separator after label
    1 + // labelToId(LABEL_SFRAME_CALL_SECRET) byte
    callIdBytes.length +
    1 + // 0x00 separator after callId
    senderBytes.length +
    1 + // 0x00 separator after senderId
    1 // keyId byte
  const out = new Uint8Array(total)
  let off = 0
  out.set(labelBytes, off)
  off += labelBytes.length
  out[off++] = 0x00
  out[off++] = callSecretByte & 0xff
  out.set(callIdBytes, off)
  off += callIdBytes.length
  out[off++] = 0x00
  out.set(senderBytes, off)
  off += senderBytes.length
  out[off++] = 0x00
  out[off++] = keyId & 0x7f
  return out
}

/**
 * Encrypt one encoded WebRTC frame and return a new buffer laid out as
 * `[ codec header ][ ciphertext+tag ][ trailer ]`.
 *
 * The codec header (first `codecHeaderLength` bytes, default 0) is left in
 * the clear so WebRTC's depacketizer / receiver can still parse it. For Opus
 * audio with no extension this is 0.
 */
export async function sealFrame(
  frame: Uint8Array,
  key: CryptoKey,
  ctx: SealContext
): Promise<SealedFrame> {
  const headerLen = ctx.codecHeaderLength ?? 0
  if (headerLen < 0 || headerLen > frame.byteLength) {
    throw new Error(
      `sframe: invalid codecHeaderLength ${headerLen} for frame of ${frame.byteLength} bytes`
    )
  }
  const header = frame.subarray(0, headerLen)
  const payload = frame.subarray(headerLen)

  const nonce = buildNonce(ctx.ssrc, ctx.rtpTimestamp, ctx.counter)
  const aad = buildAad(ctx.callId, ctx.senderId, ctx.keyId)

  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
        tagLength: SFRAME_CIPHER_SUITE.tagLength * 8,
      },
      key,
      payload as unknown as BufferSource
    )
  )

  const trailer = writeTrailer(ctx.counter, ctx.keyId)
  const out = new Uint8Array(header.byteLength + ct.byteLength + trailer.byteLength)
  out.set(header, 0)
  out.set(ct, header.byteLength)
  out.set(trailer, header.byteLength + ct.byteLength)
  return asSealedFrame(out)
}

/**
 * Decrypt a sealed frame. The caller must have already resolved the right key
 * for the keyId encoded in the trailer (peek with `parseTrailer`); this
 * function takes the resolved key directly.
 *
 * Returns the plaintext (codec header + decrypted payload), plus the parsed
 * counter and keyId so callers can update replay-window state.
 */
export async function openFrame(
  frame: SealedFrame,
  key: CryptoKey,
  ctx: OpenContext
): Promise<OpenResult> {
  const headerLen = ctx.codecHeaderLength ?? 0
  const minLen = headerLen + TRAILER_LENGTH + SFRAME_CIPHER_SUITE.tagLength
  if (frame.byteLength < minLen) {
    throw new Error(`sframe: frame too short to decrypt (${frame.byteLength} < ${minLen})`)
  }
  const { counter, keyId } = parseTrailer(frame)
  const header = frame.subarray(0, headerLen)
  const ctEnd = frame.byteLength - TRAILER_LENGTH
  const ct = frame.subarray(headerLen, ctEnd)

  const nonce = buildNonce(ctx.ssrc, ctx.rtpTimestamp, counter)
  const aad = buildAad(ctx.callId, ctx.senderId, keyId)

  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
        tagLength: SFRAME_CIPHER_SUITE.tagLength * 8,
      },
      key,
      ct as unknown as BufferSource
    )
  )

  const out = new Uint8Array(header.byteLength + pt.byteLength)
  out.set(header, 0)
  out.set(pt, header.byteLength)
  return { plaintext: asPlaintextBytes(out), counter, keyId }
}
