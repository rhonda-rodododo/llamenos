/**
 * Crypto Web Worker — holds the decrypted nsec in a closure.
 *
 * The main thread NEVER touches the raw secret key bytes.
 * All cryptographic operations that require the private key happen here.
 *
 * Communication: structured postMessage with request/response IDs.
 * Rate limiting: auto-locks if operations exceed safe thresholds.
 *
 * Tier 1 transition state:
 *   This worker is in a dual-era state. The legacy ECIES/XChaCha20 surface
 *   is still here because the remaining call sites that depend on it
 *   (file-crypto, hub-key-manager, signal-contact, device provisioning,
 *   key-store KEK rotation, notes/files envelope paths) have not yet been
 *   migrated — they carry over to Tier 2+.
 *
 *   Tier 1 added an HPKE sidecar for:
 *     - `hpkeSeal` / `hpkeOpen` — RFC 9180 seal/open against HpkeEnvelope.
 *     - `unlockWithHandles` — accept non-extractable CryptoKey handles (HPKE
 *       private key + hub AES-GCM key) alongside the raw-nsec unlock path.
 *
 *   Rules while the sidecar coexists:
 *     - Never add a NEW caller that uses the ECIES surface; use HPKE.
 *     - Never silently fall back from HPKE to ECIES on open failure.
 *     - The `schnorr`/`secp256k1` identity nsec still backs `sign` +
 *       `signAuditEntry` because Tier 0's hash-chained audit log depends on
 *       it. That is a signing keypair and is independent of the X25519
 *       HPKE KEM — HPKE does not replace signing.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { CryptoLabel } from '@shared/crypto-labels'
import {
  LABEL_DEVICE_PROVISION,
  LABEL_ROOT_KEK_WRAP,
  SAS_INFO,
  SAS_SALT,
} from '@shared/crypto-labels'
import { unbiasedSixDigitCode } from '@shared/crypto-primitives'
import type { HpkeEnvelope } from '@shared/hpke-envelope'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'

// ---- Message protocol types ----

type WorkerRequest =
  | { type: 'unlock'; id: string; kekHex: string; nonceHex: string; ciphertextHex: string }
  | { type: 'lock'; id: string }
  | { type: 'sign'; id: string; messageHex: string }
  | {
      // Legacy ECIES key unwrap (label-id envelope path). Domain separation comes
      // from `label` (used to derive the symmetric wrapping key). The inner
      // AEAD uses empty AAD — do NOT add an `aad` field here unless
      // `eciesWrap`/`eciesUnwrap` actually plumb it through, otherwise
      // callers will think they have binding they don't. New code should use
      // the HPKE `hpkeSeal`/`hpkeOpen` sidecar below instead.
      type: 'decrypt'
      id: string
      ephemeralPubkeyHex: string
      wrappedKeyHex: string
      label: CryptoLabel
    }
  | {
      // ECIES key wrap. See note on `decrypt` re: AAD.
      type: 'encrypt'
      id: string
      plaintextHex: string
      recipientPubkeyHex: string
      label: CryptoLabel
    }
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
      label: CryptoLabel
      aad: string
    }
  | {
      type: 'envelopeEncryptField'
      id: string
      plaintext: string
      recipientPubkeysHex: string[]
      label: CryptoLabel
      aad: string
    }
  | { type: 'signAuditEntry'; id: string; entryHashHex: string }
  | { type: 'computeHmac'; id: string; input: string; secretHex: string }
  | { type: 'exportSession'; id: string }
  | {
      type: 'importSession'
      id: string
      tokenHex: string
      encryptedNsecHex: string
      capsuleNonceHex: string
    }
  // ---- Tier 1 HPKE sidecar ----
  | {
      // HPKE single-shot seal. The main thread ships the recipient's HPKE
      // public key bytes; the worker imports them and produces an HpkeEnvelope.
      // Public-key operations do not need our secret, but we still require
      // the worker to be unlocked so an XSS attacker cannot invoke sealing
      // as a grinder primitive while the user is logged out.
      type: 'hpkeSeal'
      id: string
      plaintext: string
      recipientPublicKeyRaw: Uint8Array
      label: CryptoLabel
      recordId: string
      fieldName: string
    }
  | {
      // HPKE single-shot open. The envelope is decoded in the worker against
      // the held HPKE private CryptoKey. Throws if version, labelId, or AAD
      // mismatches — never falls back to ECIES.
      type: 'hpkeOpen'
      id: string
      envelope: HpkeEnvelope
      expectedLabel: CryptoLabel
      recordId: string
      fieldName: string
    }
  | {
      // Unlock from a key store that returns non-extractable CryptoKey
      // handles (HPKE private key + hub AES-GCM key) plus the raw nsec. The
      // handles are transferred via structured clone. The nsec still arrives
      // as raw bytes because no current runtime offers a non-extractable
      // wrapKey path for X25519 schnorr/secp256k1 — see native-curves-check.
      type: 'unlockWithHandles'
      id: string
      nsecRaw: Uint8Array
      hpkePrivateKey: CryptoKey
      hubKey: CryptoKey
    }
  | { type: 'hpkePublicKeyRaw'; id: string }
  // ---- Tier 2 root-KEK handlers ----
  //
  // The root KEK is a 256-bit AES-KW CryptoKey held exclusively in the worker
  // closure. Each factor (PRF, OPAQUE export key, recovery phrase, recovery
  // group share) contributes 32 bytes of entropy; the worker derives an
  // ephemeral AES-KW wrapping key via HKDF-SHA256 over those bytes with
  // `LABEL_ROOT_KEK_WRAP` and a per-envelope salt, then wraps the root KEK
  // under that factor key and drops the ephemeral handle. The main thread
  // persists only `{ hkdfSalt, wrappedKey }` per factor and never sees
  // either the factor bytes or the root KEK in the clear.
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
let hpkePrivateKey: CryptoKey | null = null
let hpkePublicKeyRawCache: Uint8Array | null = null
let hubKey: CryptoKey | null = null

// Tier 2 root KEK. A 256-bit AES-KW key generated or unwrapped inside the
// worker and held only as a CryptoKey handle. Never posted back to the main
// thread. Cleared by `autoLock()` alongside the Tier 1 handles.
let rootKek: CryptoKey | null = null

// ---- Rate limiting ----

interface RateBucket {
  timestamps: number[]
  maxPerSec: number
  maxPerMin: number
}

// Rate limits defend against XSS exfiltration via the worker. They must allow
// legitimate use (a dashboard page can decrypt many fields in parallel across
// contacts, messages, user PII, timeline entries, etc.) while still catching
// abuse patterns.
const rateLimits: Record<string, RateBucket> = {
  sign: { timestamps: [], maxPerSec: 10, maxPerMin: 100 },
  decrypt: { timestamps: [], maxPerSec: 100, maxPerMin: 1000 },
  encrypt: { timestamps: [], maxPerSec: 50, maxPerMin: 500 },
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
  // Tier 1 handles. CryptoKey is not zeroable — we drop the reference and
  // rely on GC. Raw public key cache is zeroed.
  hpkePrivateKey = null
  hubKey = null
  if (hpkePublicKeyRawCache) {
    hpkePublicKeyRawCache.fill(0)
    hpkePublicKeyRawCache = null
  }
  // Tier 2 root KEK — drop the handle for GC.
  rootKek = null
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

function handleDecrypt(
  ephemeralPubkeyHex: string,
  wrappedKeyHex: string,
  label: CryptoLabel
): string {
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
  label: CryptoLabel
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

function handleReEncrypt(newKekHex: string): { nonce: string; ciphertext: string } {
  if (!secretKey) throw new Error('Worker is locked')

  const newKek = hexToBytes(newKekHex)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(newKek, nonce)
  // Encrypt the nsec as hex string (same format as encryptNsec in key-store)
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

/**
 * Export the unlocked nsec as an opaque session capsule encrypted under a
 * random token. The main thread stores the capsule + token separately so a
 * page reload can call `importSession` and skip PBKDF2.
 *
 * Threat model: capsule in IDB + token in sessionStorage together re-grant
 * access, which is equivalent to the existing XSS-exposes-KEK surface. A
 * lock() or wipeKey() must be called to clear both.
 */
function handleExportSession(): {
  tokenHex: string
  encryptedNsecHex: string
  capsuleNonceHex: string
} {
  if (!secretKey) throw new Error('Worker is locked')

  const token = randomBytes(32)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(token, nonce)
  // Encode nsec as hex — matches the unlock/reEncrypt format
  const nsecHex = bytesToHex(secretKey)
  const plaintext = utf8ToBytes(nsecHex)
  const ciphertext = cipher.encrypt(plaintext)
  plaintext.fill(0)

  return {
    tokenHex: bytesToHex(token),
    encryptedNsecHex: bytesToHex(ciphertext),
    capsuleNonceHex: bytesToHex(nonce),
  }
}

/**
 * Restore worker state from a session capsule created by handleExportSession.
 * Returns the x-only public key hex on success (same shape as handleUnlock).
 * Throws if the capsule is invalid / tampered.
 */
function handleImportSession(
  tokenHex: string,
  encryptedNsecHex: string,
  capsuleNonceHex: string
): string {
  const token = hexToBytes(tokenHex)
  const nonce = hexToBytes(capsuleNonceHex)
  const ciphertext = hexToBytes(encryptedNsecHex)

  const cipher = xchacha20poly1305(token, nonce)
  const decrypted = cipher.decrypt(ciphertext)
  const nsecHex = new TextDecoder().decode(decrypted)
  decrypted.fill(0)

  secretKey = hexToBytes(nsecHex)
  publicKeyHex = bytesToHex(schnorr.getPublicKey(secretKey))

  resetRateLimits()
  return publicKeyHex
}

// ---- Tier 1 HPKE sidecar handlers ----

/**
 * Unlock the worker from a key-store unlock result. The main thread runs
 * its unlock flow and transfers the non-extractable CryptoKey handles
 * (hub key, HPKE private key) plus the raw nsec bytes here.
 *
 * This sits alongside `handleUnlock` (kek/nonce path) — callers migrate at
 * their own pace while Tier 1 rolls out. Both paths populate `secretKey` +
 * `publicKeyHex` identically so `signAuditEntry` and `sign` keep working
 * without caring which path was used.
 */
function handleUnlockWithHandles(nsecRaw: Uint8Array, hpkePriv: CryptoKey, hub: CryptoKey): string {
  if (nsecRaw.byteLength !== 32) {
    throw new Error(`unlockWithHandles nsec must be 32 bytes, got ${nsecRaw.byteLength}`)
  }
  secretKey = new Uint8Array(nsecRaw)
  nsecRaw.fill(0)
  publicKeyHex = bytesToHex(schnorr.getPublicKey(secretKey))
  hpkePrivateKey = hpkePriv
  hubKey = hub
  hpkePublicKeyRawCache = null
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
  const suite = createHpkeSuite()
  const recipientKey = await suite.kem.deserializePublicKey(recipientPublicKeyRaw)
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

// ---- Tier 2 root-KEK handlers ----

/**
 * Derive an ephemeral AES-KW wrapping key from raw factor bytes and a
 * per-envelope salt. The derivation uses HKDF-SHA256 with
 * `LABEL_ROOT_KEK_WRAP` as the `info` parameter so every factor in the
 * root-KEK bundle is domain-separated from other uses of the same raw bytes
 * (e.g. OPAQUE export keys, PRF outputs, and recovery phrases all feed in
 * here but the resulting key is bound to this label).
 *
 * The returned CryptoKey is non-extractable and only usable for
 * `wrapKey`/`unwrapKey`. Callers must drop the reference after use so the
 * ephemeral key doesn't outlive a single wrap/unwrap round.
 */
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

/**
 * Generate a fresh random root KEK and install it in the worker. Any
 * existing root KEK handle is dropped. Used at first-time enrollment and
 * during root-KEK rotation.
 *
 * The key is extractable at the SubtleCrypto level so `wrapKey` can produce
 * per-factor envelopes — but the CryptoKey handle itself is held only in
 * the worker closure, so the main thread can never read the raw bytes.
 */
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
  // @hpke/core doesn't expose a public-from-private derive, so we require
  // the main thread to publish the HPKE pubkey separately — it's stored in
  // the StoredKeyBlob (identityPublicKey) and does not need to live here.
  // Returning null tells the client to read it from the key store.
  return null
}

// ---- Message handler ----

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  let response: WorkerResponse

  try {
    let result: unknown

    switch (req.type) {
      case 'unlock':
        result = handleUnlock(req.kekHex, req.nonceHex, req.ciphertextHex)
        break
      case 'unlockWithHandles':
        result = handleUnlockWithHandles(req.nsecRaw, req.hpkePrivateKey, req.hubKey)
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
        const fieldCipher = xchacha20poly1305(messageKey, fieldNonce, hexToBytes(req.aad))
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
      case 'exportSession':
        result = handleExportSession()
        break
      case 'importSession':
        result = handleImportSession(req.tokenHex, req.encryptedNsecHex, req.capsuleNonceHex)
        break
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
        const fieldCipher = xchacha20poly1305(messageKey, fieldNonce, hexToBytes(req.aad))
        const plaintext = fieldCipher.decrypt(fieldCiphertext)
        result = new TextDecoder().decode(plaintext)
        break
      }
      case 'signAuditEntry':
        result = handleSignAuditEntry(req.entryHashHex)
        break
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

// ---- Test-only exports (prefixed _test_ — do NOT use in production code) ----
// These allow unit tests to exercise handler logic directly without a real Worker.

/** @internal Test only — set the module-level secretKey for handler tests. */
export function _test_setSecretKey(key: Uint8Array): void {
  secretKey = key
  publicKeyHex = bytesToHex(schnorr.getPublicKey(key))
}

/** @internal Test only — zero and clear the module-level secretKey. */
export function _test_clearSecretKey(): void {
  if (secretKey) secretKey.fill(0)
  secretKey = null
  publicKeyHex = null
}

/** @internal Test only — direct access to handleSignAuditEntry for unit testing. */
export { handleSignAuditEntry as _test_handleSignAuditEntry }

/** @internal Test only — direct access to the unlockWithHandles handler. */
export { handleUnlockWithHandles as _test_handleUnlockWithHandles }

/** @internal Test only — direct access to HPKE sidecar handlers. */
export { handleHpkeSeal as _test_handleHpkeSeal, handleHpkeOpen as _test_handleHpkeOpen }

/** @internal Test only — clear Tier 1 HPKE state between tests. */
export function _test_clearHpkeState(): void {
  hpkePrivateKey = null
  hubKey = null
  if (hpkePublicKeyRawCache) {
    hpkePublicKeyRawCache.fill(0)
    hpkePublicKeyRawCache = null
  }
}

/** @internal Test only — direct access to the Tier 2 root-KEK handlers. */
export {
  handleRootKekCreate as _test_handleRootKekCreate,
  handleRootKekWrap as _test_handleRootKekWrap,
  handleRootKekUnwrap as _test_handleRootKekUnwrap,
  handleRootKekClear as _test_handleRootKekClear,
  handleRootKekIsLoaded as _test_handleRootKekIsLoaded,
}
