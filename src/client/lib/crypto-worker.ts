/**
 * Crypto Web Worker — holds the decrypted nsec in a closure.
 *
 * The main thread NEVER touches the raw secret key bytes.
 * All cryptographic operations that require the private key happen here.
 *
 * Communication: structured postMessage with request/response IDs.
 * Rate limiting: auto-locks if operations exceed safe thresholds.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_DEVICE_PROVISION, SAS_INFO, SAS_SALT } from '@shared/crypto-labels'
import { unbiasedSixDigitCode } from '@shared/crypto-primitives'

// ---- Message protocol types ----

type WorkerRequest =
  | { type: 'unlock'; id: string; kekHex: string; nonceHex: string; ciphertextHex: string }
  | { type: 'lock'; id: string }
  | { type: 'sign'; id: string; messageHex: string }
  | {
      type: 'decrypt'
      id: string
      ephemeralPubkeyHex: string
      wrappedKeyHex: string
      label: string
    }
  | { type: 'encrypt'; id: string; plaintextHex: string; recipientPubkeyHex: string; label: string }
  | { type: 'getPublicKey'; id: string }
  | { type: 'isUnlocked'; id: string }
  | { type: 'reEncrypt'; id: string; newKekHex: string }
  | { type: 'provisionNsec'; id: string; recipientEphemeralPubkeyHex: string }
  | {
      type: 'decryptEnvelopeField'
      id: string
      encryptedHex: string
      ephemeralPubkeyHex: string
      wrappedKeyHex: string
      label: string
    }
  | {
      type: 'envelopeEncryptField'
      id: string
      plaintext: string
      recipientPubkeysHex: string[]
      label: string
    }
  | { type: 'computeHmac'; id: string; input: string; secretHex: string }

interface WorkerSuccessResponse {
  type: 'success'
  id: string
  result: unknown
}

interface WorkerErrorResponse {
  type: 'error'
  id: string
  error: string
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse

// ---- Private state (closure-scoped) ----

let secretKey: Uint8Array | null = null
let publicKeyHex: string | null = null

// ---- Rate limiting ----

interface RateBucket {
  timestamps: number[]
  maxPerSec: number
  maxPerMin: number
}

const rateLimits: Record<string, RateBucket> = {
  sign: { timestamps: [], maxPerSec: 10, maxPerMin: 100 },
  decrypt: { timestamps: [], maxPerSec: 100, maxPerMin: 1000 },
  encrypt: { timestamps: [], maxPerSec: 10, maxPerMin: 100 },
}

function checkRateLimit(operation: string): boolean {
  const bucket = rateLimits[operation]
  if (!bucket) return true

  const now = Date.now()
  // Prune timestamps older than 60s
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < 60_000)

  // Check per-minute limit
  if (bucket.timestamps.length >= bucket.maxPerMin) return false

  // Check per-second limit
  const oneSecAgo = now - 1_000
  const recentCount = bucket.timestamps.filter((t) => t >= oneSecAgo).length
  if (recentCount >= bucket.maxPerSec) return false

  bucket.timestamps.push(now)
  return true
}

function resetRateLimits(): void {
  for (const bucket of Object.values(rateLimits)) {
    bucket.timestamps = []
  }
}

function autoLock(): void {
  if (secretKey) {
    secretKey.fill(0)
  }
  secretKey = null
  publicKeyHex = null
  resetRateLimits()
}

// ---- Crypto helpers (self-contained, mirrors crypto.ts patterns) ----

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

/**
 * ECIES wrap: encrypt a plaintext under a recipient's public key with domain separation.
 * Uses ephemeral ECDH + SHA-256(label || sharedX) + XChaCha20-Poly1305.
 */
function eciesWrap(
  plaintext: Uint8Array,
  recipientPubkeyHex: string,
  label: string
): { ephemeralPubkeyHex: string; wrappedKeyHex: string } {
  const ephemeralSecret = randomBytes(32)
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)

  // x-only pubkey -> compressed with "02" prefix
  const recipientCompressed = hexToBytes(`02${recipientPubkeyHex}`)
  const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  const sharedX = shared.subarray(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const ciphertext = cipher.encrypt(plaintext)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    ephemeralPubkeyHex: bytesToHex(ephemeralPublicKey),
    wrappedKeyHex: bytesToHex(packed),
  }
}

/**
 * ECIES unwrap: decrypt using our secret key + ephemeral pubkey with domain separation.
 */
function eciesUnwrap(
  ephemeralPubkeyHex: string,
  wrappedKeyHex: string,
  sk: Uint8Array,
  label: string
): Uint8Array {
  const ephemeralPub = hexToBytes(ephemeralPubkeyHex)
  const shared = secp256k1.getSharedSecret(sk, ephemeralPub)
  const sharedX = shared.subarray(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const data = hexToBytes(wrappedKeyHex)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  return cipher.decrypt(ciphertext)
}

// ---- Operation handlers ----

function handleUnlock(kekHex: string, nonceHex: string, ciphertextHex: string): string {
  const kek = hexToBytes(kekHex)
  const nonce = hexToBytes(nonceHex)
  const ciphertext = hexToBytes(ciphertextHex)

  const cipher = xchacha20poly1305(kek, nonce)
  const decrypted = cipher.decrypt(ciphertext)

  // The encrypted blob stores nsecHex (64 ASCII hex chars).
  // Decode the hex string to get the raw 32-byte secret key.
  const nsecHex = new TextDecoder().decode(decrypted)
  decrypted.fill(0)
  secretKey = hexToBytes(nsecHex)
  // Derive x-only public key via schnorr (returns hex string)
  publicKeyHex = bytesToHex(schnorr.getPublicKey(secretKey))

  resetRateLimits()
  return publicKeyHex
}

function handleLock(): void {
  autoLock()
}

function handleSign(messageHex: string): string {
  if (!secretKey) throw new Error('Worker is locked')

  if (!checkRateLimit('sign')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }

  const message = hexToBytes(messageHex)
  const signature = schnorr.sign(message, secretKey)
  return bytesToHex(signature)
}

function handleDecrypt(ephemeralPubkeyHex: string, wrappedKeyHex: string, label: string): string {
  if (!secretKey) throw new Error('Worker is locked')

  if (!checkRateLimit('decrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }

  const result = eciesUnwrap(ephemeralPubkeyHex, wrappedKeyHex, secretKey, label)
  return bytesToHex(result)
}

function handleEncrypt(
  plaintextHex: string,
  recipientPubkeyHex: string,
  label: string
): { ephemeralPubkeyHex: string; wrappedKeyHex: string } {
  // Encrypt doesn't need our nsec (uses ephemeral key), but we keep it
  // in the worker for API consistency and to enforce the worker-is-unlocked
  // invariant for all crypto operations.
  if (!secretKey) throw new Error('Worker is locked')

  if (!checkRateLimit('encrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }

  const plaintext = hexToBytes(plaintextHex)
  return eciesWrap(plaintext, recipientPubkeyHex, label)
}

function handleGetPublicKey(): string | null {
  return publicKeyHex
}

function handleIsUnlocked(): boolean {
  return secretKey !== null
}

function handleReEncrypt(newKekHex: string): { nonce: string; ciphertext: string } {
  if (!secretKey) throw new Error('Worker is locked')

  const newKek = hexToBytes(newKekHex)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(newKek, nonce)
  // Encrypt the nsec as hex string (same format as encryptNsec in key-store-v2)
  // so that handleUnlock can decode it consistently
  const nsecHexBytes = new TextEncoder().encode(bytesToHex(secretKey))
  const ciphertext = cipher.encrypt(nsecHexBytes)
  nsecHexBytes.fill(0)

  return {
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  }
}

function handleProvisionNsec(recipientEphemeralPubkeyHex: string): {
  ciphertext: string
  nonce: string
  pubkey: string
  sas: string
} {
  if (!secretKey || !publicKeyHex) throw new Error('Worker is locked')

  // Support both x-only (64 hex chars) and compressed (66 hex chars) pubkeys
  const recipientPub =
    recipientEphemeralPubkeyHex.length === 64
      ? hexToBytes(`02${recipientEphemeralPubkeyHex}`)
      : hexToBytes(recipientEphemeralPubkeyHex)

  // ECDH: our secretKey + recipient's ephemeral pubkey
  const shared = secp256k1.getSharedSecret(secretKey, recipientPub)
  const sharedX = shared.subarray(1, 33)

  // Derive encryption key with domain separation
  const labelBytes = utf8ToBytes(LABEL_DEVICE_PROVISION)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const encKey = sha256(keyInput)

  // Encrypt the nsec hex string
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(encKey, nonce)
  const nsecHex = bytesToHex(secretKey)
  const ciphertext = cipher.encrypt(utf8ToBytes(nsecHex))

  // Derive SAS (Short Authentication String) from the shared secret
  // Both devices compute this independently — matching codes confirm no MITM
  const sasBytes = hkdf(sha256, sharedX, utf8ToBytes(SAS_SALT), utf8ToBytes(SAS_INFO), 4)
  const sasCode = unbiasedSixDigitCode(sasBytes)
  const sas = `${sasCode.slice(0, 3)} ${sasCode.slice(3)}`

  return {
    ciphertext: bytesToHex(ciphertext),
    nonce: bytesToHex(nonce),
    pubkey: publicKeyHex,
    sas,
  }
}

// ---- Message handler ----

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  let response: WorkerResponse

  try {
    let result: unknown

    switch (req.type) {
      case 'unlock':
        result = handleUnlock(req.kekHex, req.nonceHex, req.ciphertextHex)
        break
      case 'lock':
        handleLock()
        result = null
        break
      case 'sign':
        result = handleSign(req.messageHex)
        break
      case 'decrypt':
        result = handleDecrypt(req.ephemeralPubkeyHex, req.wrappedKeyHex, req.label)
        break
      case 'encrypt':
        result = handleEncrypt(req.plaintextHex, req.recipientPubkeyHex, req.label)
        break
      case 'getPublicKey':
        result = handleGetPublicKey()
        break
      case 'isUnlocked':
        result = handleIsUnlocked()
        break
      case 'reEncrypt':
        result = handleReEncrypt(req.newKekHex)
        break
      case 'provisionNsec':
        result = handleProvisionNsec(req.recipientEphemeralPubkeyHex)
        break
      case 'envelopeEncryptField': {
        // Generate a random symmetric key, encrypt the plaintext with it, and
        // ECIES-wrap the key for each recipient. Returns { encryptedHex, envelopes }.
        const messageKey = randomBytes(32)
        const fieldNonce = randomBytes(24)
        const fieldCipher = xchacha20poly1305(messageKey, fieldNonce)
        const ct = fieldCipher.encrypt(utf8ToBytes(req.plaintext))
        const packed = new Uint8Array(fieldNonce.length + ct.length)
        packed.set(fieldNonce)
        packed.set(ct, fieldNonce.length)
        const envelopes = req.recipientPubkeysHex.map((pub) => {
          const wrapped = eciesWrap(messageKey, pub, req.label)
          return {
            recipientPubkey: pub,
            ephemeralPubkeyHex: wrapped.ephemeralPubkeyHex,
            wrappedKeyHex: wrapped.wrappedKeyHex,
          }
        })
        messageKey.fill(0)
        result = { encryptedHex: bytesToHex(packed), envelopes }
        break
      }
      case 'computeHmac': {
        const mac = hmac(sha256, hexToBytes(req.secretHex), utf8ToBytes(req.input))
        result = bytesToHex(mac)
        break
      }
      case 'decryptEnvelopeField': {
        if (!secretKey) throw new Error('Worker is locked')
        if (!checkRateLimit('decrypt')) {
          autoLock()
          throw new Error('Rate limit exceeded — worker auto-locked')
        }
        // Step 1: ECIES unwrap the per-field symmetric message key
        const messageKey = eciesUnwrap(
          req.ephemeralPubkeyHex,
          req.wrappedKeyHex,
          secretKey,
          req.label
        )
        // Step 2: Symmetric decrypt the field ciphertext
        const fieldData = hexToBytes(req.encryptedHex)
        const fieldNonce = fieldData.slice(0, 24)
        const fieldCiphertext = fieldData.slice(24)
        const fieldCipher = xchacha20poly1305(messageKey, fieldNonce)
        const plaintext = fieldCipher.decrypt(fieldCiphertext)
        result = new TextDecoder().decode(plaintext)
        break
      }
      default: {
        // Exhaustive check — if we get here, the type is never
        const _exhaustive: never = req
        throw new Error(`Unknown request type: ${(_exhaustive as { type: string }).type}`)
      }
    }

    response = { type: 'success', id: req.id, result }
  } catch (err) {
    response = {
      type: 'error',
      id: req.id,
      error: err instanceof Error ? err.message : 'Unknown worker error',
    }
  }

  self.postMessage(response)
}
