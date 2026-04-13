import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { LABEL_SFRAME_BASE_KEY } from '../crypto-labels.js'

/**
 * SFrame cipher suite pinned for Llámenos voice E2EE.
 *
 * Pins `AES_128_GCM_SHA256_128` from draft-ietf-sframe-enc — the single
 * suite all Llámenos voice calls use. No negotiation, no downgrade.
 */
export const SFRAME_CIPHER_SUITE = {
  aead: 'AES-GCM' as const,
  keyLength: 16, // AES-128
  tagLength: 16, // GCM tag
  nonceLength: 12, // 96-bit GCM nonce
  hash: 'SHA-256' as const,
} as const

export type SFrameCipherSuite = typeof SFRAME_CIPHER_SUITE

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/**
 * Derive a per-sender SFrame base key from the per-call secret.
 *
 * HKDF (RFC 5869, extract + expand):
 *   salt = callId (utf8)
 *   info = LABEL_SFRAME_BASE_KEY || 0x00 || senderId (utf8)
 *   okm  = 16 bytes (AES-128 key)
 */
export function deriveBaseKey(
  callSecret: Uint8Array,
  callId: string,
  senderId: string
): Uint8Array {
  const salt = utf8(callId)
  const labelBytes = utf8(LABEL_SFRAME_BASE_KEY)
  const senderBytes = utf8(senderId)
  const info = new Uint8Array(labelBytes.length + 1 + senderBytes.length)
  info.set(labelBytes, 0)
  info[labelBytes.length] = 0x00 // separator
  info.set(senderBytes, labelBytes.length + 1)
  return hkdf(sha256, callSecret, salt, info, SFRAME_CIPHER_SUITE.keyLength)
}

/**
 * Import a raw 16-byte key as a non-extractable AES-GCM CryptoKey
 * usable for both encrypt and decrypt.
 */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== SFRAME_CIPHER_SUITE.keyLength) {
    throw new Error(
      `SFrame key must be ${SFRAME_CIPHER_SUITE.keyLength} bytes, got ${raw.byteLength}`
    )
  }
  return crypto.subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}
