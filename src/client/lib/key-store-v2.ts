/**
 * Multi-factor encrypted key storage using PBKDF2 + HKDF + XChaCha20-Poly1305.
 *
 * Key derivation (v2):
 *   PIN → PBKDF2-SHA256 (600k iterations, 32-byte salt) → 32-byte pin-derived
 *   [pin-derived ‖ prfOutput? ‖ idpValue] → HKDF-SHA256 (info = 3F or 2F label) → 32-byte KEK
 *   KEK → XChaCha20-Poly1305 encrypts nsec bytes → stored in localStorage as JSON.
 *
 * 3-factor mode: PIN + WebAuthn PRF output + IdP-bound value
 * 2-factor mode: PIN + IdP-bound value (no PRF)
 *
 * Decrypted keyPair is held in memory only — never written to storage unencrypted.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { HMAC_KEYID_PREFIX, LABEL_NSEC_KEK_2F, LABEL_NSEC_KEK_3F } from '@shared/crypto-labels'

const STORAGE_KEY = 'llamenos-encrypted-key-v2'
const PBKDF2_ITERATIONS = 600_000

/**
 * Known synthetic IdP issuer prefixes. Keys stored with these issuers were created
 * before the user had a real IdP session (e.g., during device linking, recovery,
 * or demo login without an IdP). The `unlock()` flow will auto-rotate these
 * to real IdP values on first successful unlock with a valid IdP session.
 *
 * Most flows now use real nsecSecret from the IdP at import time:
 * - Bootstrap: nsecSecret returned from /api/auth/bootstrap
 * - Onboarding: nsecSecret returned from /api/invites/redeem
 *
 * Only device-link (and recovery/demo fallbacks) still use synthetic values.
 */
export const SYNTHETIC_ISSUERS = ['device-link'] as const
export type SyntheticIssuer = (typeof SYNTHETIC_ISSUERS)[number]

/**
 * Derive a deterministic 32-byte synthetic IdP value from an issuer string.
 * Used during importKey when no real IdP session exists yet, and during unlock
 * to reconstruct the same KEK for decryption before rotating to the real value.
 *
 * The domain-separated SHA-256 ensures consistent length (32 bytes) regardless
 * of issuer string length.
 */
export function syntheticIdpValue(issuer: string): Uint8Array {
  return sha256(new TextEncoder().encode(`llamenos:synthetic:${issuer}`))
}

export interface KEKFactors {
  pin: string
  idpValue: Uint8Array
  prfOutput?: Uint8Array // undefined = 2-factor mode
  salt: Uint8Array
}

export interface EncryptedKeyDataV2 {
  version: 2
  kdf: 'pbkdf2-sha256'
  cipher: 'xchacha20-poly1305'
  salt: string // hex, 32 bytes
  nonce: string // hex, 24 bytes
  ciphertext: string // hex
  pubkeyHash: string // HMAC_KEYID_PREFIX hash (truncated SHA-256)
  prfUsed: boolean
  idpIssuer: string
}

/**
 * Derive a 32-byte Key Encryption Key from multiple factors.
 *
 * Step 1: PIN → PBKDF2-SHA256 (sync, expensive, 32 bytes)
 * Step 2: Concatenate available factor material (each 32 bytes)
 * Step 3: HKDF-SHA256 with factor-count-specific info label → 32-byte KEK
 *
 * This is intentionally synchronous — @noble/hashes pbkdf2 and hkdf are sync.
 * Callers should wrap in a Worker or async boundary to avoid blocking the UI.
 */
export function deriveKEK(factors: KEKFactors): Uint8Array {
  // Step 1: PIN → PBKDF2-SHA256
  const pinBytes = new TextEncoder().encode(factors.pin)
  const pinDerived = pbkdf2(sha256, pinBytes, factors.salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  })

  // Step 2: Concatenate available factors (each exactly 32 bytes)
  const ikm = factors.prfOutput
    ? new Uint8Array([...pinDerived, ...factors.prfOutput, ...factors.idpValue])
    : new Uint8Array([...pinDerived, ...factors.idpValue])

  // Step 3: HKDF with factor-specific info for domain separation
  // @noble/hashes hkdf requires info as Uint8Array — encode the label string
  const infoLabel = factors.prfOutput ? LABEL_NSEC_KEK_3F : LABEL_NSEC_KEK_2F
  const info = new TextEncoder().encode(infoLabel)
  return hkdf(sha256, ikm, factors.salt, info, 32)
}

/**
 * Encrypt an nsec hex string with a KEK. Returns a v2 encrypted blob.
 * Caller must derive the KEK separately via deriveKEK().
 */
export function encryptNsec(
  nsecHex: string,
  kek: Uint8Array,
  pubkey: string,
  prfUsed: boolean,
  idpIssuer: string,
  salt: Uint8Array
): EncryptedKeyDataV2 {
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(kek, nonce)
  const plaintext = new TextEncoder().encode(nsecHex)
  const ciphertext = cipher.encrypt(plaintext)
  plaintext.fill(0)

  // Hash pubkey for identification — never store plaintext pubkey alongside encrypted key
  const pubkeyHash = bytesToHex(
    sha256(new TextEncoder().encode(`${HMAC_KEYID_PREFIX}${pubkey}`))
  ).slice(0, 16)

  return {
    version: 2,
    kdf: 'pbkdf2-sha256',
    cipher: 'xchacha20-poly1305',
    salt: bytesToHex(salt),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
    pubkeyHash,
    prfUsed,
    idpIssuer,
  }
}

/**
 * Decrypt a v2 encrypted blob using a KEK. Returns nsec hex string or null on failure.
 * Caller must derive the KEK separately via deriveKEK().
 */
export function decryptNsec(data: EncryptedKeyDataV2, kek: Uint8Array): string | null {
  try {
    const nonce = hexToBytes(data.nonce)
    const ciphertext = hexToBytes(data.ciphertext)
    const cipher = xchacha20poly1305(kek, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null // Wrong KEK or corrupted data
  }
}

/**
 * Persist a v2 encrypted blob to localStorage.
 */
export function storeEncryptedKeyV2(data: EncryptedKeyDataV2): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

/**
 * Load a v2 encrypted blob from localStorage. Returns null if absent or wrong version.
 */
export function loadEncryptedKeyV2(): EncryptedKeyDataV2 | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as Record<string, unknown>).version !== 2
    ) {
      return null
    }
    const p = parsed as Record<string, unknown>
    if (
      typeof p.salt !== 'string' ||
      typeof p.nonce !== 'string' ||
      typeof p.ciphertext !== 'string' ||
      typeof p.pubkeyHash !== 'string' ||
      typeof p.kdf !== 'string' ||
      typeof p.cipher !== 'string'
    ) {
      return null
    }
    return parsed as EncryptedKeyDataV2
  } catch {
    return null
  }
}

/**
 * Check if a v2 encrypted key exists in localStorage.
 */
export function hasStoredKeyV2(): boolean {
  return loadEncryptedKeyV2() !== null
}

/**
 * Clear the v2 encrypted key from localStorage.
 */
export function clearStoredKeyV2(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Validate PIN format: 6-8 digits only.
 */
export function isValidPin(pin: string): boolean {
  return /^\d{6,8}$/.test(pin)
}

/**
 * Derive a PIN-based proof value for rate-limit / audit tracking.
 * Uses a DIFFERENT salt than the KEK derivation so the proof cannot leak KEK material.
 * The server stores a SHA-256 hash of this proof and verifies it on security-critical
 * operations (PIN change, recovery rotate, lockdown), ensuring the caller knows the
 * current PIN without the server seeing the PIN itself.
 */
export function deriveKekProof(pin: string): string {
  const salt = new TextEncoder().encode('llamenos:pin-proof:v1')
  const key = pbkdf2(sha256, new TextEncoder().encode(pin), salt, { c: 100_000, dkLen: 32 })
  return bytesToHex(key)
}

export interface RewrapFactors {
  idpValue: Uint8Array
  prfOutput?: Uint8Array
}

/**
 * Re-wrap the stored nsec under a new KEK derived with a new PIN.
 * Caller must have already unlocked the key with the current PIN (worker holds nsec).
 * Returns the new EncryptedKeyDataV2 as a JSON string, ready to send to the server.
 * Also persists the new blob to localStorage.
 */
export async function rewrapWithNewPin(
  newPin: string,
  factors: RewrapFactors,
  currentBlob: EncryptedKeyDataV2
): Promise<string> {
  const { cryptoWorker } = await import('./crypto-worker-client')
  const newSalt = new Uint8Array(32)
  crypto.getRandomValues(newSalt)
  const newKek = deriveKEK({
    pin: newPin,
    idpValue: factors.idpValue,
    prfOutput: factors.prfOutput,
    salt: newSalt,
  })
  const reEncrypted = await cryptoWorker.reEncrypt(bytesToHex(newKek))
  const newBlob: EncryptedKeyDataV2 = {
    ...currentBlob,
    salt: bytesToHex(newSalt),
    nonce: reEncrypted.nonce,
    ciphertext: reEncrypted.ciphertext,
  }
  storeEncryptedKeyV2(newBlob)
  return JSON.stringify(newBlob)
}

/**
 * Re-wrap the stored nsec under a KEK derived with a new recovery key factor.
 * Caller must have already unlocked the key (worker holds nsec).
 * Note: current implementation uses PIN + IdP value as the primary factors; the recovery
 * key is stored separately via createBackup(). This helper re-derives the main blob
 * using the new PIN context while recording that a new recovery key has been generated.
 * Returns the new EncryptedKeyDataV2 as a JSON string.
 */
export async function rewrapWithNewRecoveryKey(
  pin: string,
  factors: RewrapFactors,
  currentBlob: EncryptedKeyDataV2
): Promise<string> {
  // For the primary blob, the factors are the same (PIN + IdP + optional PRF).
  // The recovery key is used only for the separate backup file. Rotating rewraps
  // the primary blob with fresh salt/nonce to ensure local storage is not stale
  // after recovery key rotation.
  const { cryptoWorker } = await import('./crypto-worker-client')
  const newSalt = new Uint8Array(32)
  crypto.getRandomValues(newSalt)
  const newKek = deriveKEK({
    pin,
    idpValue: factors.idpValue,
    prfOutput: factors.prfOutput,
    salt: newSalt,
  })
  const reEncrypted = await cryptoWorker.reEncrypt(bytesToHex(newKek))
  const newBlob: EncryptedKeyDataV2 = {
    ...currentBlob,
    salt: bytesToHex(newSalt),
    nonce: reEncrypted.nonce,
    ciphertext: reEncrypted.ciphertext,
  }
  storeEncryptedKeyV2(newBlob)
  return JSON.stringify(newBlob)
}
