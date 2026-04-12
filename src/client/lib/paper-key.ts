/**
 * Paper key module: BIP39 24-word mnemonic generation, deterministic keypair
 * derivation, and recovery flow that provisions a new device while retiring
 * the paper key.
 *
 * The mnemonic is shown once to the user and never stored. From it we derive
 * an Ed25519 signing keypair and an X25519 encryption keypair using
 * domain-separated HMAC-SHA256.
 */
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { LABEL_PAPER_KEY_ENCRYPTION, LABEL_PAPER_KEY_SIGNING } from '@shared/crypto-labels'
import type { Tier3DeviceAddPayload, Tier3DeviceRemovePayload } from '@shared/schemas/sigchain'
import type { DeviceKeypair } from '@shared/types'
import { generateDeviceKeypair, pubkeyToHex } from './device-identity'

// ---- PKCS8 DER headers for raw 32-byte seed import ----

const ED25519_PKCS8_HEADER = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
])

const X25519_PKCS8_HEADER = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
])

function buildPkcs8(header: Uint8Array, seed: Uint8Array): ArrayBuffer {
  const der = new Uint8Array(48)
  der.set(header)
  der.set(seed, 16)
  return der.buffer as ArrayBuffer
}

// ---- Result types ----

export interface PaperKeyResult {
  mnemonic: string
  deviceId: string
  signingPubkey: Uint8Array
  encryptionPubkey: Uint8Array
}

export interface DerivedPaperKey {
  deviceId: string
  signing: {
    privateKey: CryptoKey // non-extractable Ed25519
    publicKey: Uint8Array // raw 32 bytes
  }
  encryption: {
    privateKey: CryptoKey // non-extractable X25519
    publicKey: Uint8Array // raw 32 bytes
  }
}

export interface PaperKeyRecoveryResult {
  newDevice: DeviceKeypair
  paperKeyDeviceId: string
  addEntry: Tier3DeviceAddPayload
  removeEntry: Tier3DeviceRemovePayload
}

// ---- Key import helpers (JWK round-trip for public key extraction) ----

async function importEd25519FromSeed(
  seed: Uint8Array
): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  const pkcs8 = buildPkcs8(ED25519_PKCS8_HEADER, seed)

  // Import extractable to get JWK with public key component
  const extractable = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, [
    'sign',
  ])
  const jwk = await crypto.subtle.exportKey('jwk', extractable)

  // Import non-extractable private key
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, [
    'sign',
  ])

  // Extract raw public key from JWK
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey(
      'raw',
      await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
        { name: 'Ed25519' },
        true,
        ['verify']
      )
    )
  )

  return { privateKey, publicKey }
}

async function importX25519FromSeed(
  seed: Uint8Array
): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  const pkcs8 = buildPkcs8(X25519_PKCS8_HEADER, seed)

  // Import extractable to get JWK with public key component
  const extractable = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, [
    'deriveBits',
  ])
  const jwk = await crypto.subtle.exportKey('jwk', extractable)

  // Import non-extractable private key
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, [
    'deriveBits',
  ])

  // Extract raw public key from JWK
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey(
      'raw',
      await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
        { name: 'X25519' },
        true,
        []
      )
    )
  )

  return { privateKey, publicKey }
}

// ---- Deterministic device ID from signing pubkey ----

function deterministicDeviceId(signingPub: Uint8Array): string {
  const hash = sha256(signingPub)
  const hex = bytesToHex(hash.slice(0, 16))
  // Format as UUID-like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// ---- Core derivation ----

/**
 * Derive a paper key keypair from a validated BIP39 mnemonic.
 *
 * Uses domain-separated HMAC-SHA256 to derive signing and encryption seeds
 * from the 64-byte BIP39 seed. Private keys are imported as non-extractable.
 */
export async function derivePaperKeyFromMnemonic(mnemonic: string): Promise<DerivedPaperKey> {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('Invalid BIP39 mnemonic')
  }

  const bip39Seed = mnemonicToSeedSync(mnemonic)

  // Domain-separated HMAC derivation — encode labels as UTF-8 bytes
  const encoder = new TextEncoder()
  const signingSeed = hmac(sha256, bip39Seed, encoder.encode(LABEL_PAPER_KEY_SIGNING))
  const encryptionSeed = hmac(sha256, bip39Seed, encoder.encode(LABEL_PAPER_KEY_ENCRYPTION))

  try {
    const signing = await importEd25519FromSeed(signingSeed)
    const encryption = await importX25519FromSeed(encryptionSeed)
    const deviceId = deterministicDeviceId(signing.publicKey)

    return {
      deviceId,
      signing: { privateKey: signing.privateKey, publicKey: signing.publicKey },
      encryption: { privateKey: encryption.privateKey, publicKey: encryption.publicKey },
    }
  } finally {
    // Zero raw seed bytes
    signingSeed.fill(0)
    encryptionSeed.fill(0)
    bip39Seed.fill(0)
  }
}

// ---- Generation ----

/**
 * Generate a new paper recovery key: a 24-word BIP39 mnemonic plus the
 * derived device identity. The mnemonic is shown once to the user and
 * never stored.
 */
export async function generatePaperRecoveryKey(): Promise<PaperKeyResult> {
  // 256 bits of entropy → 24-word mnemonic
  const mnemonic = generateMnemonic(wordlist, 256)
  const derived = await derivePaperKeyFromMnemonic(mnemonic)

  return {
    mnemonic,
    deviceId: derived.deviceId,
    signingPubkey: derived.signing.publicKey,
    encryptionPubkey: derived.encryption.publicKey,
  }
}

// ---- Recovery flow ----

/**
 * Recover from a paper key: derive the paper key keypair, generate a new
 * device keypair, and build sigchain entries to add the new device and
 * retire the paper key.
 */
export async function recoverFromPaperKey(params: {
  mnemonic: string
  userId: string
  pukGeneration: number
}): Promise<PaperKeyRecoveryResult> {
  const paperKey = await derivePaperKeyFromMnemonic(params.mnemonic)

  // Generate a fresh device keypair for the replacement device
  const newDevice = await generateDeviceKeypair({ isPaperKey: false })

  // Build sigchain entry: add the new device (signed by paper key)
  const addEntry: Tier3DeviceAddPayload = {
    type: 'tier3_device_add',
    userId: params.userId,
    newDeviceId: newDevice.deviceId,
    newDeviceSigningPubkey: pubkeyToHex(newDevice.signing.publicKey),
    newDeviceEncryptionPubkey: pubkeyToHex(newDevice.encryption.publicKey),
    signedByDeviceId: paperKey.deviceId,
    newDeviceDisplayName: 'Recovered device',
    pukGeneration: params.pukGeneration,
  }

  // Build sigchain entry: remove the paper key device (signed by paper key)
  const removeEntry: Tier3DeviceRemovePayload = {
    type: 'tier3_device_remove',
    userId: params.userId,
    removedDeviceId: paperKey.deviceId,
    removedSigningPubkey: pubkeyToHex(paperKey.signing.publicKey),
    signedByDeviceId: paperKey.deviceId,
    reason: 'user_revoked',
    pukGeneration: params.pukGeneration,
  }

  return {
    newDevice,
    paperKeyDeviceId: paperKey.deviceId,
    addEntry,
    removeEntry,
  }
}
