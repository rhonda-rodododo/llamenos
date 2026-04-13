import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import type { CryptoLabel } from './crypto-labels'
import { idToLabel } from './crypto-labels'
import type { Ciphertext } from './crypto-types'
import type { Envelope } from './types'

/**
 * Symmetric encryption using XChaCha20-Poly1305 with mandatory AAD binding.
 * Returns hex-encoded: nonce(24 bytes) || ciphertext.
 * The AAD cryptographically binds the ciphertext to a context — use a domain label
 * (e.g. utf8ToBytes(LABEL_*)) or record identifier to prevent cross-context reuse.
 */
export function symmetricEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array
): Ciphertext {
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(key, nonce, aad)
  const ciphertext = cipher.encrypt(plaintext)
  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed) as Ciphertext
}

/**
 * Symmetric decryption using XChaCha20-Poly1305 with mandatory AAD binding.
 * Input: hex-encoded nonce(24) || ciphertext.
 * AAD must match what was passed to symmetricEncrypt — mismatch throws (authentication failure).
 */
export function symmetricDecrypt(
  packed: string | Ciphertext,
  key: Uint8Array,
  aad: Uint8Array
): Uint8Array {
  const data = hexToBytes(packed)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(key, nonce, aad)
  return cipher.decrypt(ciphertext)
}

/**
 * ECIES key wrapping for a single recipient.
 * Generates ephemeral secp256k1 keypair, derives shared secret via ECDH,
 * derives symmetric key via SHA-256(label || sharedX), wraps with XChaCha20-Poly1305.
 */
export function eciesWrapKey(
  key: Uint8Array,
  recipientPubkeyHex: string,
  label: CryptoLabel
): { wrappedKey: Ciphertext; ephemeralPubkey: string } {
  const ephemeralSecret = new Uint8Array(32)
  crypto.getRandomValues(ephemeralSecret)
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)

  const recipientCompressed = hexToBytes(`02${recipientPubkeyHex}`)
  const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const ciphertext = cipher.encrypt(key)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    wrappedKey: bytesToHex(packed) as Ciphertext,
    ephemeralPubkey: bytesToHex(ephemeralPublicKey),
  }
}

/**
 * ECIES key unwrapping. Recovers the symmetric key from an ECIES envelope.
 */
export function eciesUnwrapKey(
  envelope: { wrappedKey: string | Ciphertext; ephemeralPubkey: string },
  privateKey: Uint8Array,
  label: CryptoLabel
): Uint8Array {
  const ephemeralPub = hexToBytes(envelope.ephemeralPubkey)
  const shared = secp256k1.getSharedSecret(privateKey, ephemeralPub)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const packed = hexToBytes(envelope.wrappedKey)
  const nonce = packed.slice(0, 24)
  const ciphertext = packed.slice(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  return cipher.decrypt(ciphertext)
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

// --- Envelope types ---

/** A symmetric key wrapped via ECIES for a single recipient (no pubkey tag). */
export interface KeyEnvelope {
  wrappedKey: Ciphertext // hex: nonce(24) + ciphertext(32 key + 16 tag)
  ephemeralPubkey: string // hex: compressed 33-byte pubkey (66 chars)
}

/** A KeyEnvelope tagged with the recipient's x-only pubkey (for multi-recipient scenarios). */
export interface RecipientKeyEnvelope extends KeyEnvelope {
  pubkey: string // recipient's x-only pubkey (hex, 64 chars)
}

/**
 * ECIES key unwrap with explicit secret key — for server-side and test usage
 * where no crypto worker is available. Mirror of eciesUnwrapKey but takes secretKey directly.
 */
export function eciesUnwrapKeyWithSecret(
  envelope: KeyEnvelope,
  secretKey: Uint8Array,
  label: CryptoLabel
): Uint8Array {
  const ephemeralPub = hexToBytes(envelope.ephemeralPubkey)
  const shared = secp256k1.getSharedSecret(secretKey, ephemeralPub)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const data = hexToBytes(envelope.wrappedKey)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  return cipher.decrypt(ciphertext)
}

// --- Envelope: versioned ECIES envelope with wire-format label enforcement ---

export type { Envelope }

/**
 * Thrown when an Envelope's embedded labelId does not match the expected
 * CryptoLabel, or when the envelope version is not 2.
 * This enforces the "triple-redundant label defense": brand + HKDF + AEAD AAD + wire id.
 */
export class CryptoLabelMismatchError extends Error {
  constructor(detail: string | { expected: CryptoLabel; actual: CryptoLabel }) {
    const msg =
      typeof detail === 'string'
        ? detail
        : `Crypto label mismatch: expected ${detail.expected}, got ${detail.actual}`
    super(msg)
    this.name = 'CryptoLabelMismatchError'
  }
}

/**
 * Unwrap an Envelope after verifying the embedded labelId matches expectedLabel.
 * Throws CryptoLabelMismatchError if the version is not 2 or the labelId is wrong.
 *
 * @param env            The versioned envelope to unwrap.
 * @param unwrapSecret   Caller-supplied unwrap function (crypto worker, server key, etc.)
 * @param expectedLabel  The CryptoLabel the caller expects this envelope to have been sealed with.
 */
export async function decryptEnvelope(
  env: Envelope,
  unwrapSecret: (
    ephemeralPubkey: string,
    wrapped: Ciphertext,
    label: CryptoLabel
  ) => Promise<Uint8Array>,
  expectedLabel: CryptoLabel
): Promise<Uint8Array> {
  if (env.v !== 2) {
    throw new CryptoLabelMismatchError(`Envelope version ${env.v as number} not supported`)
  }
  const actualLabel = idToLabel(env.labelId)
  if (actualLabel !== expectedLabel) {
    throw new CryptoLabelMismatchError({ expected: expectedLabel, actual: actualLabel })
  }
  return unwrapSecret(env.ephemeralPubkey, env.wrappedKey, expectedLabel)
}
