import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm'
import type { Ciphertext } from './crypto-types'

/**
 * Symmetric encryption using AES-256-GCM with mandatory AAD binding.
 * Returns hex-encoded: nonce(12 bytes) || ciphertext+tag.
 * The AAD cryptographically binds the ciphertext to a context — use a domain label
 * (e.g. utf8ToBytes(LABEL_*)) or record identifier to prevent cross-context reuse.
 */
export async function symmetricEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array
): Promise<Ciphertext> {
  return (await aesGcmEncrypt(plaintext, key, aad)) as Ciphertext
}

/**
 * Symmetric decryption using AES-256-GCM with mandatory AAD binding.
 * Input: hex-encoded nonce(12) || ciphertext+tag.
 * AAD must match what was passed to symmetricEncrypt — mismatch throws (authentication failure).
 */
export async function symmetricDecrypt(
  packed: string | Ciphertext,
  key: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  return aesGcmDecrypt(packed, key, aad)
}

/**
 * Convert 4 raw bytes to an unbiased 6-digit code (000000–999999).
 * Uses multiplication-shift instead of modulo to avoid distribution bias.
 * (Modulo 10^6 of a 32-bit value gives codes 0–294967 an extra 1/4295 probability.)
 */
export function unbiasedSixDigitCode(fourBytes: Uint8Array): string {
  const num =
    ((fourBytes[0] << 24) | (fourBytes[1] << 16) | (fourBytes[2] << 8) | fourBytes[3]) >>> 0
  return Math.floor((num / 4_294_967_296) * 1_000_000)
    .toString()
    .padStart(6, '0')
}

/**
 * HMAC-SHA256. Returns raw bytes (caller converts to hex as needed).
 */
export function hmacSha256(key: Uint8Array, input: Uint8Array): Uint8Array {
  return hmac(sha256, key, input)
}

/**
 * HKDF-SHA256 key derivation.
 */
export function hkdfDerive(
  secret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  return hkdf(sha256, secret, salt, info, length)
}

// --- Key Management ---

/** A secp256k1 keypair for Nostr-style identity. */
export interface KeyPair {
  secretKey: Uint8Array // 32-byte private key
  publicKey: string // hex-encoded x-only public key (64 chars)
  nsec: string // bech32-encoded private key (for user display)
  npub: string // bech32-encoded public key (for user display)
}

export function generateKeyPair(): KeyPair {
  const secretKey = generateSecretKey()
  const publicKey = getPublicKey(secretKey)
  return {
    secretKey,
    publicKey,
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(publicKey),
  }
}

export function keyPairFromNsec(nsec: string): KeyPair | null {
  try {
    const decoded = nip19.decode(nsec)
    if (decoded.type !== 'nsec') return null
    const secretKey = decoded.data
    const publicKey = getPublicKey(secretKey)
    return {
      secretKey,
      publicKey,
      nsec,
      npub: nip19.npubEncode(publicKey),
    }
  } catch {
    return null
  }
}

export function isValidNsec(nsec: string): boolean {
  try {
    const decoded = nip19.decode(nsec)
    return decoded.type === 'nsec'
  } catch {
    return false
  }
}
