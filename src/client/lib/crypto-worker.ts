/**
 * Crypto Web Worker — holds the decrypted nsec in a closure.
 *
 * The main thread NEVER touches the raw secret key bytes.
 * All cryptographic operations that require the private key happen here.
 *
 * Communication: structured postMessage with request/response IDs.
 * Rate limiting: auto-locks if operations exceed safe thresholds.
 *
 * HPKE-only era (Slice 7):
 *   All per-recipient asymmetric encryption uses HPKE RFC 9180 via
 *   `hpkeSeal` / `hpkeOpen`. All symmetric encryption uses AES-256-GCM
 *   via WebCrypto. Legacy ECIES and XChaCha20 have been fully removed.
 *
 *   The `schnorr`/`secp256k1` identity nsec still backs `sign` +
 *   `signAuditEntry` because Tier 0's hash-chained audit log depends on
 *   it. That is a signing keypair and is independent of the X25519
 *   HPKE KEM — HPKE does not replace signing.
 */

import { x25519 } from '@noble/curves/ed25519.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { aesGcmDecrypt, aesGcmEncrypt } from '@shared/aes-gcm'
import type { CryptoLabel } from '@shared/crypto-labels'
import {
  LABEL_DEVICE_PROVISION,
  LABEL_MLS_PROVISION,
  LABEL_ROOT_KEK_WRAP,
  SAS_INFO,
  SAS_SALT,
} from '@shared/crypto-labels'
import { unbiasedSixDigitCode } from '@shared/crypto-primitives'
import type { HpkeEnvelope } from '@shared/hpke-envelope'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'
import type { AesGcmKey, X25519EncryptionKey } from '@shared/types'

// ---- Message protocol types ----

type WorkerRequest =
  | { type: 'unlock'; id: string; kekHex: string; nonceHex: string; ciphertextHex: string }
  | { type: 'lock'; id: string }
  | { type: 'sign'; id: string; messageHex: string }
  | { type: 'getPublicKey'; id: string }
  | { type: 'isUnlocked'; id: string }
  | { type: 'reEncrypt'; id: string; newKekHex: string; aadHex: string }
  | { type: 'provisionNsec'; id: string; recipientEphemeralPubkeyHex: string }
  | { type: 'signAuditEntry'; id: string; entryHashHex: string }
  | { type: 'computeHmac'; id: string; input: string; secretHex: string }
  | { type: 'exportSession'; id: string }
  | {
      type: 'importSession'
      id: string
      tokenHex: string
      encryptedNsecHex: string
      capsuleNonceHex: string
      encryptedKekHex?: string
      kekNonceHex?: string
    }
  // ---- HPKE ----
  | {
      type: 'hpkeSeal'
      id: string
      plaintext: string
      recipientPublicKeyRaw: Uint8Array
      label: CryptoLabel
      recordId: string
      fieldName: string
    }
  | {
      type: 'hpkeOpen'
      id: string
      envelope: HpkeEnvelope
      expectedLabel: CryptoLabel
      recordId: string
      fieldName: string
    }
  | {
      type: 'hpkeOpenRaw'
      id: string
      envelope: HpkeEnvelope
      expectedLabel: CryptoLabel
      recordId: string
      fieldName: string
    }
  | {
      type: 'hpkeOpenRawAad'
      id: string
      envelope: HpkeEnvelope
      expectedLabel: CryptoLabel
      aadHex: string
    }
  | {
      type: 'unlockWithHandles'
      id: string
      nsecRaw: Uint8Array
      hpkePrivateKey: X25519EncryptionKey
      hubKey: AesGcmKey
    }
  | { type: 'hpkePublicKeyRaw'; id: string }
  // ---- Tier 2 root-KEK handlers ----
  | { type: 'rootKekCreate'; id: string }
  | {
      type: 'rootKekWrap'
      id: string
      factorBytesHex: string
      hkdfSaltHex: string
    }
  | {
      type: 'rootKekUnwrap'
      id: string
      factorBytesHex: string
      hkdfSaltHex: string
      wrappedKeyHex: string
    }
  | { type: 'rootKekClear'; id: string }
  | { type: 'rootKekIsLoaded'; id: string }
  // ---- Tier 6 MLS sidecar ----
  | { type: 'mlsInit'; id: string; clientId: string; kekHex?: string }
  | { type: 'mlsGenerateKeyPackages'; id: string; count: number }
  | { type: 'mlsCurrentEpoch'; id: string; groupId: string }
  | { type: 'mlsLock'; id: string }
  | { type: 'mlsClearState'; id: string }
  // ---- Tier 6 MLS group management (Slice 3) ----
  | { type: 'mlsCreateGroup'; id: string; groupId: string }
  | { type: 'mlsProcessWelcome'; id: string; welcomeBytes: Uint8Array }
  | { type: 'mlsExternalJoin'; id: string; groupInfoBytes: Uint8Array }
  | { type: 'mlsEncryptMessage'; id: string; groupId: string; plaintext: Uint8Array }
  | { type: 'mlsDecryptMessage'; id: string; groupId: string; ciphertext: Uint8Array }
  | {
      type: 'mlsAddMembers'
      id: string
      groupId: string
      keyPackages: Uint8Array[]
    }
  | { type: 'mlsRemoveMembers'; id: string; groupId: string; clientIds: string[] }
  | { type: 'mlsWipeGroup'; id: string; groupId: string }

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

// Tier 1 HPKE handles. Populated by `unlockWithHandles` and cleared on
// `lock()`. These are non-extractable CryptoKey objects when the runtime
// supports native X25519 wrapKey; otherwise the private key is an @hpke/*
// key object wrapping a raw-byte view (see `native-curves-check.ts`).
let hpkePrivateKey: X25519EncryptionKey | null = null
let hpkePublicKeyRawCache: Uint8Array | null = null
let _hubKey: AesGcmKey | null = null

// Tier 2 root KEK. A 256-bit AES-KW key generated or unwrapped inside the
// worker and held only as a CryptoKey handle. Never posted back to the main
// thread. Cleared by `autoLock()` alongside the Tier 1 handles.
let rootKek: CryptoKey | null = null

// Tier 6 MLS state. The KEK bytes are stored from the `handleUnlock` path so
// the MLS IDB DatabaseKey can be derived via HKDF without a second round trip.
// The `mlsInstance` holds the core-crypto `CoreCrypto` handle (from deferred or
// full init). Both are cleared on `autoLock()`.
let kekBytes: Uint8Array | null = null
let mlsInstance: Awaited<
  ReturnType<typeof import('@wireapp/core-crypto').CoreCrypto.deferredInit>
> | null = null

// ---- Rate limiting ----

interface RateBucket {
  timestamps: number[]
  maxPerSec: number
  maxPerMin: number
}

const rateLimits: Record<string, RateBucket> = {
  sign: { timestamps: [], maxPerSec: 10, maxPerMin: 100 },
  decrypt: { timestamps: [], maxPerSec: 100, maxPerMin: 1000 },
  encrypt: { timestamps: [], maxPerSec: 50, maxPerMin: 500 },
}

function checkRateLimit(operation: string): boolean {
  const bucket = rateLimits[operation]
  if (!bucket) return true

  const now = Date.now()
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < 60_000)

  if (bucket.timestamps.length >= bucket.maxPerMin) return false

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
  hpkePrivateKey = null
  _hubKey = null
  if (hpkePublicKeyRawCache) {
    hpkePublicKeyRawCache.fill(0)
    hpkePublicKeyRawCache = null
  }
  rootKek = null
  if (kekBytes) {
    kekBytes.fill(0)
    kekBytes = null
  }
  if (mlsInstance) {
    mlsInstance.close().catch(() => undefined)
    mlsInstance = null
  }
  resetRateLimits()
}

// ---- Crypto helpers ----

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

// ---- Operation handlers ----

async function handleUnlock(
  kekHex: string,
  nonceHex: string,
  ciphertextHex: string
): Promise<string> {
  const kek = hexToBytes(kekHex)

  // Reconstruct packed hex (nonce + ciphertext) for aesGcmDecrypt
  const packedHex = nonceHex + ciphertextHex
  const decrypted = await aesGcmDecrypt(packedHex, kek, new Uint8Array(0))

  // The encrypted blob stores nsecHex (64 ASCII hex chars).
  // Decode the hex string to get the raw 32-byte secret key.
  const nsecHex = new TextDecoder().decode(decrypted)
  decrypted.fill(0)
  secretKey = hexToBytes(nsecHex)
  publicKeyHex = bytesToHex(schnorr.getPublicKey(secretKey))

  // Store KEK for MLS IDB key derivation (Tier 6).
  if (kekBytes) kekBytes.fill(0)
  kekBytes = new Uint8Array(kek)

  // Derive X25519 HPKE keypair from nsec via HKDF so the PIN-based unlock
  // path populates `hpkePrivateKey` just like `unlockWithHandles` does.
  const { LABEL_USER_HPKE_KEY, LABEL_USER_HPKE_KEY_INFO } = await import('@shared/crypto-labels')
  const { hkdfDerive } = await import('@shared/crypto-primitives')
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey } = await import('@shared/types')
  const enc = new TextEncoder()
  const ikm = hkdfDerive(
    secretKey,
    enc.encode(LABEL_USER_HPKE_KEY),
    enc.encode(LABEL_USER_HPKE_KEY_INFO),
    32
  )
  const suite = createHpkeSuite()
  const kp = (await suite.kem.deriveKeyPair(ikm)) as CryptoKeyPair
  hpkePrivateKey = asX25519EncryptionKey(kp.privateKey)
  hpkePublicKeyRawCache = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))
  ikm.fill(0)

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

function handleSignAuditEntry(entryHashHex: string): string {
  if (!secretKey) throw new Error('Worker is locked')
  if (!checkRateLimit('sign')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const signature = schnorr.sign(hexToBytes(entryHashHex), secretKey)
  return bytesToHex(signature)
}

function handleGetPublicKey(): string | null {
  return publicKeyHex
}

function handleIsUnlocked(): boolean {
  return secretKey !== null
}

async function handleReEncrypt(
  newKekHex: string,
  _aad: Uint8Array
): Promise<{ nonce: string; ciphertext: string }> {
  if (!secretKey) throw new Error('Worker is locked')

  const newKek = hexToBytes(newKekHex)
  // Encrypt the nsec as hex string (same format as encryptNsec in key-store)
  const nsecHexBytes = new TextEncoder().encode(bytesToHex(secretKey))
  const packed = await aesGcmEncrypt(nsecHexBytes, newKek, new Uint8Array(0))
  nsecHexBytes.fill(0)
  newKek.fill(0)

  // Split packed hex into nonce (24 hex chars = 12 bytes) and ciphertext
  return {
    nonce: packed.slice(0, 24),
    ciphertext: packed.slice(24),
  }
}

async function handleProvisionNsec(recipientEphemeralPubkeyHex: string): Promise<{
  ciphertext: string
  nonce: string
  pubkey: string
  sas: string
}> {
  if (!secretKey || !publicKeyHex) throw new Error('Worker is locked')

  // Generate an ephemeral X25519 keypair for provisioning.
  const ephemeralSecret = randomBytes(32)
  const ephemeralPubkey = x25519.getPublicKey(ephemeralSecret)

  // X25519 ECDH: our ephemeral secret + recipient's ephemeral pubkey
  const recipientPubBytes = hexToBytes(recipientEphemeralPubkeyHex)
  const sharedX = x25519.getSharedSecret(ephemeralSecret, recipientPubBytes)

  // Derive encryption key with domain separation
  const labelBytes = utf8ToBytes(LABEL_DEVICE_PROVISION)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const encKey = sha256(keyInput)

  // Encrypt the nsec hex string with AES-256-GCM
  const nsecHex = bytesToHex(secretKey)
  const packed = await aesGcmEncrypt(utf8ToBytes(nsecHex), encKey, new Uint8Array(0))
  // Split packed hex into nonce (24 hex chars = 12 bytes) and ciphertext
  const nonce = packed.slice(0, 24)
  const ciphertext = packed.slice(24)

  // Derive SAS (Short Authentication String) from the shared secret
  const sasBytes = hkdf(sha256, sharedX, utf8ToBytes(SAS_SALT), utf8ToBytes(SAS_INFO), 4)
  const sasCode = unbiasedSixDigitCode(sasBytes)
  const sas = `${sasCode.slice(0, 3)} ${sasCode.slice(3)}`

  // Zero the ephemeral secret
  ephemeralSecret.fill(0)

  return {
    ciphertext,
    nonce,
    pubkey: bytesToHex(ephemeralPubkey),
    sas,
  }
}

/**
 * Export the unlocked nsec as an opaque session capsule encrypted under a
 * random token. The main thread stores the capsule + token separately so a
 * page reload can call `importSession` and skip PBKDF2.
 */
async function handleExportSession(): Promise<{
  tokenHex: string
  encryptedNsecHex: string
  capsuleNonceHex: string
  encryptedKekHex: string | null
  kekNonceHex: string | null
}> {
  if (!secretKey) throw new Error('Worker is locked')

  const token = randomBytes(32)
  const nsecHex = bytesToHex(secretKey)
  const nsecBytes = utf8ToBytes(nsecHex)
  const packed = await aesGcmEncrypt(nsecBytes, token, new Uint8Array(0))
  nsecBytes.fill(0)
  // Split into nonce + ciphertext
  const capsuleNonceHex = packed.slice(0, 24)
  const encryptedNsecHex = packed.slice(24)

  // Also export the KEK bytes (if available) so session-restore can re-init MLS
  let encryptedKekHex: string | null = null
  let kekNonceHex: string | null = null
  if (kekBytes) {
    const kekPacked = await aesGcmEncrypt(
      utf8ToBytes(bytesToHex(kekBytes)),
      token,
      new Uint8Array(0)
    )
    kekNonceHex = kekPacked.slice(0, 24)
    encryptedKekHex = kekPacked.slice(24)
  }

  return {
    tokenHex: bytesToHex(token),
    encryptedNsecHex,
    capsuleNonceHex,
    encryptedKekHex,
    kekNonceHex,
  }
}

/**
 * Restore worker state from a session capsule created by handleExportSession.
 * Returns the x-only public key hex on success (same shape as handleUnlock).
 */
async function handleImportSession(
  tokenHex: string,
  encryptedNsecHex: string,
  capsuleNonceHex: string,
  encryptedKekHex?: string,
  kekNonceHexParam?: string
): Promise<string> {
  const token = hexToBytes(tokenHex)
  const packed = capsuleNonceHex + encryptedNsecHex
  const decrypted = await aesGcmDecrypt(packed, token, new Uint8Array(0))
  const nsecHex = new TextDecoder().decode(decrypted)
  decrypted.fill(0)

  secretKey = hexToBytes(nsecHex)
  publicKeyHex = bytesToHex(schnorr.getPublicKey(secretKey))

  // Restore KEK bytes if the capsule included them (enables MLS re-init).
  if (encryptedKekHex && kekNonceHexParam) {
    try {
      const kekPacked = kekNonceHexParam + encryptedKekHex
      const kekDecrypted = await aesGcmDecrypt(kekPacked, token, new Uint8Array(0))
      const kekHex = new TextDecoder().decode(kekDecrypted)
      if (kekBytes) kekBytes.fill(0)
      kekBytes = hexToBytes(kekHex)
    } catch {
      // KEK restoration is best-effort — MLS will just be unavailable
    }
  }

  // Derive X25519 HPKE keypair from nsec
  const { LABEL_USER_HPKE_KEY, LABEL_USER_HPKE_KEY_INFO } = await import('@shared/crypto-labels')
  const { hkdfDerive } = await import('@shared/crypto-primitives')
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey } = await import('@shared/types')
  const enc = new TextEncoder()
  const ikm = hkdfDerive(
    secretKey,
    enc.encode(LABEL_USER_HPKE_KEY),
    enc.encode(LABEL_USER_HPKE_KEY_INFO),
    32
  )
  const suite = createHpkeSuite()
  const kp = (await suite.kem.deriveKeyPair(ikm)) as CryptoKeyPair
  hpkePrivateKey = asX25519EncryptionKey(kp.privateKey)
  hpkePublicKeyRawCache = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))
  ikm.fill(0)

  resetRateLimits()
  return publicKeyHex
}

// ---- HPKE handlers ----

async function handleUnlockWithHandles(
  nsecRaw: Uint8Array,
  hpkePriv: X25519EncryptionKey,
  hub: AesGcmKey
): Promise<string> {
  if (nsecRaw.byteLength !== 32) {
    throw new Error(`unlockWithHandles nsec must be 32 bytes, got ${nsecRaw.byteLength}`)
  }
  secretKey = new Uint8Array(nsecRaw)
  publicKeyHex = bytesToHex(schnorr.getPublicKey(secretKey))
  hpkePrivateKey = hpkePriv
  _hubKey = hub

  const { LABEL_USER_HPKE_KEY, LABEL_USER_HPKE_KEY_INFO } = await import('@shared/crypto-labels')
  const { hkdfDerive } = await import('@shared/crypto-primitives')
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const enc = new TextEncoder()
  const ikm = hkdfDerive(
    secretKey,
    enc.encode(LABEL_USER_HPKE_KEY),
    enc.encode(LABEL_USER_HPKE_KEY_INFO),
    32
  )
  const suite = createHpkeSuite()
  const kp = (await suite.kem.deriveKeyPair(ikm)) as CryptoKeyPair
  hpkePublicKeyRawCache = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))
  ikm.fill(0)

  nsecRaw.fill(0)
  resetRateLimits()
  return publicKeyHex
}

async function handleHpkeSeal(
  plaintext: string,
  recipientPublicKeyRaw: Uint8Array,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<HpkeEnvelope> {
  if (!secretKey) throw new Error('Worker is locked')
  if (!checkRateLimit('encrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
  const suite = createHpkeSuite()
  const recipientKey = asX25519(
    (await suite.kem.deserializePublicKey(recipientPublicKeyRaw)) as CryptoKey
  )
  const aad = buildAad(label, recordId, fieldName)
  return hpkeSeal(new TextEncoder().encode(plaintext), recipientKey, label, aad)
}

async function handleHpkeOpen(
  envelope: HpkeEnvelope,
  expectedLabel: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<string> {
  if (!secretKey || !hpkePrivateKey) throw new Error('Worker is locked')
  if (!checkRateLimit('decrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const aad = buildAad(expectedLabel, recordId, fieldName)
  const pt = await hpkeOpen(envelope, hpkePrivateKey, expectedLabel, aad)
  return new TextDecoder().decode(pt)
}

async function handleHpkeOpenRaw(
  envelope: HpkeEnvelope,
  expectedLabel: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<string> {
  if (!secretKey || !hpkePrivateKey) throw new Error('Worker is locked')
  if (!checkRateLimit('decrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const aad = buildAad(expectedLabel, recordId, fieldName)
  const pt = await hpkeOpen(envelope, hpkePrivateKey, expectedLabel, aad)
  return bytesToHex(new Uint8Array(pt))
}

async function handleHpkeOpenRawAad(
  envelope: HpkeEnvelope,
  expectedLabel: CryptoLabel,
  aad: Uint8Array
): Promise<string> {
  if (!secretKey || !hpkePrivateKey) throw new Error('Worker is locked')
  if (!checkRateLimit('decrypt')) {
    autoLock()
    throw new Error('Rate limit exceeded — worker auto-locked')
  }
  const pt = await hpkeOpen(envelope, hpkePrivateKey, expectedLabel, aad)
  return new TextDecoder().decode(pt)
}

// ---- Tier 2 root-KEK handlers ----

async function deriveFactorAesKw(
  factorBytes: Uint8Array,
  hkdfSalt: Uint8Array
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    factorBytes.buffer.slice(
      factorBytes.byteOffset,
      factorBytes.byteOffset + factorBytes.byteLength
    ) as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey']
  )
  const infoBytes = new TextEncoder().encode(LABEL_ROOT_KEK_WRAP)
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: hkdfSalt.buffer.slice(
        hkdfSalt.byteOffset,
        hkdfSalt.byteOffset + hkdfSalt.byteLength
      ) as ArrayBuffer,
      info: infoBytes.buffer.slice(
        infoBytes.byteOffset,
        infoBytes.byteOffset + infoBytes.byteLength
      ) as ArrayBuffer,
    },
    baseKey,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  )
}

async function handleRootKekCreate(): Promise<void> {
  rootKek = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, true, [
    'wrapKey',
    'unwrapKey',
  ])
}

async function handleRootKekWrap(factorBytesHex: string, hkdfSaltHex: string): Promise<string> {
  if (!rootKek) throw new Error('root KEK not loaded')
  const factorBytes = hexToBytes(factorBytesHex)
  try {
    const factorKey = await deriveFactorAesKw(factorBytes, hexToBytes(hkdfSaltHex))
    const wrapped = await crypto.subtle.wrapKey('raw', rootKek, factorKey, 'AES-KW')
    return bytesToHex(new Uint8Array(wrapped))
  } finally {
    factorBytes.fill(0)
  }
}

async function handleRootKekUnwrap(
  factorBytesHex: string,
  hkdfSaltHex: string,
  wrappedKeyHex: string
): Promise<void> {
  const factorBytes = hexToBytes(factorBytesHex)
  try {
    const factorKey = await deriveFactorAesKw(factorBytes, hexToBytes(hkdfSaltHex))
    const wrapped = hexToBytes(wrappedKeyHex)
    rootKek = await crypto.subtle.unwrapKey(
      'raw',
      wrapped.buffer.slice(
        wrapped.byteOffset,
        wrapped.byteOffset + wrapped.byteLength
      ) as ArrayBuffer,
      factorKey,
      'AES-KW',
      { name: 'AES-KW', length: 256 },
      true,
      ['wrapKey', 'unwrapKey']
    )
  } finally {
    factorBytes.fill(0)
  }
}

function handleRootKekClear(): void {
  rootKek = null
}

function handleRootKekIsLoaded(): boolean {
  return rootKek !== null
}

async function handleHpkePublicKeyRaw(): Promise<Uint8Array | null> {
  if (!hpkePrivateKey) return null
  if (hpkePublicKeyRawCache) return hpkePublicKeyRawCache
  return null
}

// ---- Tier 6 MLS handlers ----

const MLS_DATABASE_NAME = 'llamenos-mls'
const MLS_DEFAULT_KEY_PACKAGE_COUNT = 100

function deriveMlsIdbKey(kek: Uint8Array): Uint8Array {
  const info = new TextEncoder().encode(LABEL_MLS_PROVISION)
  return hkdf(sha256, kek, new Uint8Array(0), info, 32)
}

async function handleMlsInit(clientId: string, explicitKekHex?: string): Promise<void> {
  const kek = explicitKekHex ? hexToBytes(explicitKekHex) : kekBytes
  if (!kek) throw new Error('KEK not available — unlock first or provide kekHex')

  const idbKey = deriveMlsIdbKey(kek)
  try {
    const { CoreCrypto, DatabaseKey, ClientId, Ciphersuite } = await (
      await import('./mls/core-crypto-loader')
    ).loadCoreCrypto()

    if (mlsInstance) {
      await mlsInstance.close()
      mlsInstance = null
    }

    const dbKey = new DatabaseKey(idbKey)
    const ccClientId = new ClientId(new TextEncoder().encode(clientId))
    mlsInstance = await CoreCrypto.init({
      databaseName: MLS_DATABASE_NAME,
      key: dbKey,
      clientId: ccClientId,
      ciphersuites: [Ciphersuite.MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519],
      nbKeyPackage: MLS_DEFAULT_KEY_PACKAGE_COUNT,
    })

    await setupMlsTransport()
  } finally {
    idbKey.fill(0)
  }
}

async function ensureMlsInit(): Promise<void> {
  if (mlsInstance) return
  if (!kekBytes || !publicKeyHex) {
    throw new Error('MLS not initialized — worker is locked')
  }
  await handleMlsInit(publicKeyHex)
}

async function handleMlsGenerateKeyPackages(count: number): Promise<Uint8Array[]> {
  await ensureMlsInit()
  const { Ciphersuite, CredentialType } = await (
    await import('./mls/core-crypto-loader')
  ).loadCoreCrypto()
  return mlsInstance!.transaction((ctx) =>
    ctx.clientKeypackages(
      Ciphersuite.MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519,
      CredentialType.Basic,
      count
    )
  )
}

async function handleMlsCurrentEpoch(groupId: string): Promise<number | null> {
  await ensureMlsInit()
  const { ConversationId } = await (await import('./mls/core-crypto-loader')).loadCoreCrypto()
  const convId = new ConversationId(new TextEncoder().encode(groupId))
  return mlsInstance!.transaction(async (ctx) => {
    const exists = await ctx.conversationExists(convId)
    if (!exists) return null
    return ctx.conversationEpoch(convId)
  })
}

async function handleMlsLock(): Promise<void> {
  if (mlsInstance) {
    await mlsInstance.close()
    mlsInstance = null
  }
}

async function handleMlsClearState(): Promise<void> {
  if (mlsInstance) {
    await mlsInstance.close()
    mlsInstance = null
  }
  if (typeof indexedDB !== 'undefined') {
    indexedDB.deleteDatabase(MLS_DATABASE_NAME)
  }
}

// ---- Tier 6 MLS group management (Slice 3) ----

let capturedCommitBundle: {
  commit: Uint8Array
  welcome: Uint8Array | undefined
  groupInfo: Uint8Array | undefined
} | null = null

async function setupMlsTransport(): Promise<void> {
  if (!mlsInstance) return
  const { MlsTransportData } = await (await import('./mls/core-crypto-loader')).loadCoreCrypto()
  await mlsInstance.provideTransport({
    sendCommitBundle: async (bundle) => {
      capturedCommitBundle = {
        commit: new Uint8Array(bundle.commit),
        welcome: bundle.welcome ? bundle.welcome.copyBytes() : undefined,
        groupInfo: bundle.groupInfo.payload.copyBytes(),
      }
      return 'success'
    },
    sendMessage: async () => 'success',
    prepareForTransport: async () => new MlsTransportData(new Uint8Array(0)),
  })
}

async function handleMlsCreateGroup(groupId: string): Promise<void> {
  await ensureMlsInit()
  const { ConversationId, Ciphersuite, CredentialType } = await (
    await import('./mls/core-crypto-loader')
  ).loadCoreCrypto()
  const convId = new ConversationId(new TextEncoder().encode(groupId))
  await mlsInstance!.transaction((ctx) =>
    ctx.createConversation(convId, CredentialType.Basic, {
      ciphersuite: Ciphersuite.MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519,
    })
  )
}

async function handleMlsProcessWelcome(welcomeBytes: Uint8Array): Promise<string> {
  await ensureMlsInit()
  const { Welcome } = await (await import('./mls/core-crypto-loader')).loadCoreCrypto()
  const welcome = new Welcome(welcomeBytes)
  const bundle = await mlsInstance!.transaction((ctx) => ctx.processWelcomeMessage(welcome))
  const idBytes = bundle.id.copyBytes()
  return new TextDecoder().decode(idBytes)
}

async function handleMlsExternalJoin(groupInfoBytes: Uint8Array): Promise<string> {
  await ensureMlsInit()
  const { GroupInfo, CredentialType } = await (
    await import('./mls/core-crypto-loader')
  ).loadCoreCrypto()
  const gi = new GroupInfo(groupInfoBytes)
  const bundle = await mlsInstance!.transaction((ctx) =>
    ctx.joinByExternalCommit(gi, CredentialType.Basic)
  )
  const idBytes = bundle.id.copyBytes()
  return new TextDecoder().decode(idBytes)
}

async function handleMlsEncryptMessage(
  groupId: string,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  await ensureMlsInit()
  const { ConversationId } = await (await import('./mls/core-crypto-loader')).loadCoreCrypto()
  const convId = new ConversationId(new TextEncoder().encode(groupId))
  return mlsInstance!.transaction((ctx) => ctx.encryptMessage(convId, plaintext))
}

async function handleMlsDecryptMessage(
  groupId: string,
  ciphertext: Uint8Array
): Promise<{
  message: Uint8Array | undefined
  senderClientId: string | undefined
  hasEpochChanged: boolean
  isActive: boolean
}> {
  await ensureMlsInit()
  const { ConversationId } = await (await import('./mls/core-crypto-loader')).loadCoreCrypto()
  const convId = new ConversationId(new TextEncoder().encode(groupId))
  const result = await mlsInstance!.transaction((ctx) => ctx.decryptMessage(convId, ciphertext))
  return {
    message: result.message,
    senderClientId: result.senderClientId
      ? new TextDecoder().decode(result.senderClientId.copyBytes())
      : undefined,
    hasEpochChanged: result.hasEpochChanged,
    isActive: result.isActive,
  }
}

async function handleMlsAddMembers(
  groupId: string,
  keyPackages: Uint8Array[]
): Promise<{
  commit: Uint8Array
  welcome: Uint8Array | undefined
  groupInfo: Uint8Array | undefined
}> {
  await ensureMlsInit()
  const { ConversationId } = await (await import('./mls/core-crypto-loader')).loadCoreCrypto()
  const convId = new ConversationId(new TextEncoder().encode(groupId))

  capturedCommitBundle = null
  await mlsInstance!.transaction((ctx) => ctx.addClientsToConversation(convId, keyPackages))

  if (!capturedCommitBundle) throw new Error('No commit bundle captured from transport')
  const result = capturedCommitBundle
  capturedCommitBundle = null
  return result
}

async function handleMlsRemoveMembers(
  groupId: string,
  clientIds: string[]
): Promise<{
  commit: Uint8Array
  welcome: Uint8Array | undefined
  groupInfo: Uint8Array | undefined
}> {
  await ensureMlsInit()
  const { ConversationId, ClientId } = await (
    await import('./mls/core-crypto-loader')
  ).loadCoreCrypto()
  const convId = new ConversationId(new TextEncoder().encode(groupId))
  const cids = clientIds.map((id) => new ClientId(new TextEncoder().encode(id)))

  capturedCommitBundle = null
  await mlsInstance!.transaction((ctx) => ctx.removeClientsFromConversation(convId, cids))

  if (!capturedCommitBundle) throw new Error('No commit bundle captured from transport')
  const result = capturedCommitBundle
  capturedCommitBundle = null
  return result
}

async function handleMlsWipeGroup(groupId: string): Promise<void> {
  await ensureMlsInit()
  const { ConversationId } = await (await import('./mls/core-crypto-loader')).loadCoreCrypto()
  const convId = new ConversationId(new TextEncoder().encode(groupId))
  await mlsInstance!.transaction((ctx) => ctx.wipeConversation(convId))
}

// ---- Message handler ----

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  let response: WorkerResponse

  try {
    let result: unknown

    switch (req.type) {
      case 'unlock':
        result = await handleUnlock(req.kekHex, req.nonceHex, req.ciphertextHex)
        break
      case 'unlockWithHandles':
        result = await handleUnlockWithHandles(req.nsecRaw, req.hpkePrivateKey, req.hubKey)
        break
      case 'hpkeSeal':
        result = await handleHpkeSeal(
          req.plaintext,
          req.recipientPublicKeyRaw,
          req.label,
          req.recordId,
          req.fieldName
        )
        break
      case 'hpkeOpen':
        result = await handleHpkeOpen(req.envelope, req.expectedLabel, req.recordId, req.fieldName)
        break
      case 'hpkeOpenRaw':
        result = await handleHpkeOpenRaw(
          req.envelope,
          req.expectedLabel,
          req.recordId,
          req.fieldName
        )
        break
      case 'hpkeOpenRawAad':
        result = await handleHpkeOpenRawAad(req.envelope, req.expectedLabel, hexToBytes(req.aadHex))
        break
      case 'hpkePublicKeyRaw':
        result = await handleHpkePublicKeyRaw()
        break
      case 'rootKekCreate':
        await handleRootKekCreate()
        result = null
        break
      case 'rootKekWrap':
        result = await handleRootKekWrap(req.factorBytesHex, req.hkdfSaltHex)
        break
      case 'rootKekUnwrap':
        await handleRootKekUnwrap(req.factorBytesHex, req.hkdfSaltHex, req.wrappedKeyHex)
        result = null
        break
      case 'rootKekClear':
        handleRootKekClear()
        result = null
        break
      case 'rootKekIsLoaded':
        result = handleRootKekIsLoaded()
        break
      case 'lock':
        handleLock()
        result = null
        break
      case 'sign':
        result = handleSign(req.messageHex)
        break
      case 'getPublicKey':
        result = handleGetPublicKey()
        break
      case 'isUnlocked':
        result = handleIsUnlocked()
        break
      case 'reEncrypt':
        result = await handleReEncrypt(req.newKekHex, hexToBytes(req.aadHex))
        break
      case 'provisionNsec':
        result = await handleProvisionNsec(req.recipientEphemeralPubkeyHex)
        break
      case 'computeHmac': {
        const mac = hmac(sha256, hexToBytes(req.secretHex), utf8ToBytes(req.input))
        result = bytesToHex(mac)
        break
      }
      case 'exportSession':
        result = await handleExportSession()
        break
      case 'importSession':
        result = await handleImportSession(
          req.tokenHex,
          req.encryptedNsecHex,
          req.capsuleNonceHex,
          req.encryptedKekHex,
          req.kekNonceHex
        )
        break
      case 'signAuditEntry':
        result = handleSignAuditEntry(req.entryHashHex)
        break
      // ---- Tier 6 MLS ----
      case 'mlsInit':
        await handleMlsInit(req.clientId, req.kekHex)
        result = null
        break
      case 'mlsGenerateKeyPackages':
        result = await handleMlsGenerateKeyPackages(req.count)
        break
      case 'mlsCurrentEpoch':
        result = await handleMlsCurrentEpoch(req.groupId)
        break
      case 'mlsLock':
        await handleMlsLock()
        result = null
        break
      case 'mlsClearState':
        await handleMlsClearState()
        result = null
        break
      // ---- Tier 6 MLS group management (Slice 3) ----
      case 'mlsCreateGroup':
        await handleMlsCreateGroup(req.groupId)
        result = null
        break
      case 'mlsProcessWelcome':
        result = await handleMlsProcessWelcome(req.welcomeBytes)
        break
      case 'mlsExternalJoin':
        result = await handleMlsExternalJoin(req.groupInfoBytes)
        break
      case 'mlsEncryptMessage':
        result = await handleMlsEncryptMessage(req.groupId, req.plaintext)
        break
      case 'mlsDecryptMessage':
        result = await handleMlsDecryptMessage(req.groupId, req.ciphertext)
        break
      case 'mlsAddMembers':
        result = await handleMlsAddMembers(req.groupId, req.keyPackages)
        break
      case 'mlsRemoveMembers':
        result = await handleMlsRemoveMembers(req.groupId, req.clientIds)
        break
      case 'mlsWipeGroup':
        await handleMlsWipeGroup(req.groupId)
        result = null
        break
      default: {
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

// ---- Test-only exports ----

export function _test_setSecretKey(key: Uint8Array): void {
  secretKey = key
  publicKeyHex = bytesToHex(schnorr.getPublicKey(key))
}

export function _test_clearSecretKey(): void {
  if (secretKey) secretKey.fill(0)
  secretKey = null
  publicKeyHex = null
}

export {
  handleHpkeOpen as _test_handleHpkeOpen,
  handleHpkeSeal as _test_handleHpkeSeal,
  handleSignAuditEntry as _test_handleSignAuditEntry,
  handleUnlockWithHandles as _test_handleUnlockWithHandles,
}

export function _test_clearHpkeState(): void {
  hpkePrivateKey = null
  _hubKey = null
  if (hpkePublicKeyRawCache) {
    hpkePublicKeyRawCache.fill(0)
    hpkePublicKeyRawCache = null
  }
}

export {
  deriveMlsIdbKey as _test_deriveMlsIdbKey,
  handleMlsClearState as _test_handleMlsClearState,
  handleMlsCurrentEpoch as _test_handleMlsCurrentEpoch,
  handleMlsGenerateKeyPackages as _test_handleMlsGenerateKeyPackages,
  handleMlsInit as _test_handleMlsInit,
  handleMlsLock as _test_handleMlsLock,
  handleRootKekClear as _test_handleRootKekClear,
  handleRootKekCreate as _test_handleRootKekCreate,
  handleRootKekIsLoaded as _test_handleRootKekIsLoaded,
  handleRootKekUnwrap as _test_handleRootKekUnwrap,
  handleRootKekWrap as _test_handleRootKekWrap,
}

export function _test_getMlsInstance(): typeof mlsInstance {
  return mlsInstance
}

export function _test_setKekBytes(kek: Uint8Array): void {
  kekBytes = kek
}

export function _test_clearMlsState(): void {
  if (kekBytes) {
    kekBytes.fill(0)
    kekBytes = null
  }
  mlsInstance = null
  capturedCommitBundle = null
}

export {
  handleMlsAddMembers as _test_handleMlsAddMembers,
  handleMlsCreateGroup as _test_handleMlsCreateGroup,
  handleMlsDecryptMessage as _test_handleMlsDecryptMessage,
  handleMlsEncryptMessage as _test_handleMlsEncryptMessage,
  handleMlsExternalJoin as _test_handleMlsExternalJoin,
  handleMlsProcessWelcome as _test_handleMlsProcessWelcome,
  handleMlsRemoveMembers as _test_handleMlsRemoveMembers,
  handleMlsWipeGroup as _test_handleMlsWipeGroup,
  setupMlsTransport as _test_setupMlsTransport,
}
