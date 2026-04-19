/**
 * Per-User Key (PUK) lifecycle: creation, subkey derivation, rotation,
 * and generation-walk for historical content access.
 *
 * A PUK seed is a 32-byte random value. From it, three subkeys are derived
 * per generation via HMAC-SHA256:
 *   - signKey:    HMAC(seed, LABEL_PUK_SIGN || gen)     → Ed25519 seed
 *   - dhKey:      HMAC(seed, LABEL_PUK_DH || gen)       → X25519 seed
 *   - secretBox:  HMAC(seed, LABEL_PUK_SECRETBOX || gen) → AES-GCM-256 key
 *
 * The PUK seed is HPKE-sealed to each device's X25519 public key. On rotation,
 * the old seed is AES-GCM encrypted under the new generation's SecretBox key
 * (CLKR chain), and new HPKE envelopes are issued to all remaining devices.
 */
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  LABEL_PUK_DH,
  LABEL_PUK_PREVIOUS_GEN,
  LABEL_PUK_SECRETBOX,
  LABEL_PUK_SIGN,
  LABEL_PUK_WRAP_TO_DEVICE,
} from '@shared/crypto-labels'
import { createHpkeSuite } from '@shared/crypto-suite'
import type { HpkeEnvelope } from '@shared/hpke-envelope'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'
import {
  type AesGcmKey,
  type DeviceKeypair,
  type Ed25519SigningKey,
  type X25519EncryptionKey,
  asAesGcmKey,
  asEd25519SigningKey,
  asX25519EncryptionKey,
} from '@shared/types'

export interface PukSubkeys {
  signPrivate: Ed25519SigningKey // non-extractable Ed25519
  signPublic: Ed25519SigningKey // Ed25519
  dhPrivate: X25519EncryptionKey // non-extractable X25519
  dhPublic: X25519EncryptionKey // X25519
  secretBoxKey: AesGcmKey // AES-GCM-256
}

export interface PukEnvelope {
  deviceId: string
  envelope: HpkeEnvelope
}

export interface InitialPukResult {
  generation: number
  envelopes: PukEnvelope[]
  pukSignPubRaw: Uint8Array
  pukDhPubRaw: Uint8Array
  /** Opaque — callers must not read this; only used in tests. */
  _testOnlySeed?: Uint8Array
}

export interface RotatePukParams {
  oldSeed: Uint8Array
  oldGen: number
  remainingDevices: Array<{ deviceId: string; encryption: { publicKey: Uint8Array } }>
}

export interface RotatePukResult {
  newGen: number
  newSeed: Uint8Array
  newEnvelopes: PukEnvelope[]
  oldGenWrappedUnderNew: string // hex of AES-GCM ciphertext
  newSecretBoxKey: AesGcmKey
  pukSignPubRaw: Uint8Array
  pukDhPubRaw: Uint8Array
}

// ---- Subkey derivation ----

function deriveRaw(seed: Uint8Array, label: string, generation: number): Uint8Array {
  const genBytes = new Uint8Array(4)
  new DataView(genBytes.buffer).setUint32(0, generation, false) // big-endian
  const input = new Uint8Array(label.length + genBytes.length)
  input.set(new TextEncoder().encode(label))
  input.set(genBytes, label.length)
  return hmac(sha256, seed, input)
}

/**
 * Derive all three PUK subkeys for a given seed and generation.
 * The Ed25519 and X25519 private keys are imported as non-extractable.
 */
export async function derivePukSubkeys(seed: Uint8Array, generation: number): Promise<PukSubkeys> {
  const signSeed = deriveRaw(seed, LABEL_PUK_SIGN, generation)
  const dhSeed = deriveRaw(seed, LABEL_PUK_DH, generation)
  const sbSeed = deriveRaw(seed, LABEL_PUK_SECRETBOX, generation)

  // Ed25519: import as extractable for JWK round-trip, then non-extractable for usage
  const { privateKey: signPrivate, publicKey: signPublic } = await importEd25519FromSeed(signSeed)

  // X25519: same JWK round-trip
  const { privateKey: dhPrivate, publicKey: dhPublic } = await importX25519FromSeed(dhSeed)

  // AES-GCM-256 key
  const sbKey = asAesGcmKey(
    await crypto.subtle.importKey(
      'raw',
      sbSeed as BufferSource,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  )

  // Zero raw seeds
  signSeed.fill(0)
  dhSeed.fill(0)
  sbSeed.fill(0)

  return {
    signPrivate,
    signPublic,
    dhPrivate,
    dhPublic,
    secretBoxKey: sbKey,
  }
}

// ---- PKCS8 DER wrappers for importing raw 32-byte seeds ----

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

/**
 * Import Ed25519 from seed bytes → non-extractable private + public CryptoKey.
 * Uses JWK round-trip to extract the public key (Bun doesn't support SPKI
 * export from PKCS8-imported Ed25519 keys).
 */
async function importEd25519FromSeed(
  seed: Uint8Array
): Promise<{ privateKey: Ed25519SigningKey; publicKey: Ed25519SigningKey }> {
  const pkcs8 = buildPkcs8(ED25519_PKCS8_HEADER, seed)

  // Import extractable to get JWK with public key component
  const extractable = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, [
    'sign',
  ])
  const jwk = await crypto.subtle.exportKey('jwk', extractable)

  // Import non-extractable private key
  const privateKey = asEd25519SigningKey(
    await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign'])
  )

  // Import public-only from JWK
  const publicKey = asEd25519SigningKey(
    await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
      { name: 'Ed25519' },
      true,
      ['verify']
    )
  )

  return { privateKey, publicKey }
}

async function importX25519FromSeed(
  seed: Uint8Array
): Promise<{ privateKey: X25519EncryptionKey; publicKey: X25519EncryptionKey }> {
  const pkcs8 = buildPkcs8(X25519_PKCS8_HEADER, seed)

  // Import extractable to get JWK with public key component
  const extractable = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, [
    'deriveBits',
  ])
  const jwk = await crypto.subtle.exportKey('jwk', extractable)

  // Import non-extractable private key
  const privateKey = asX25519EncryptionKey(
    await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits'])
  )

  // Import public-only from JWK
  const publicKey = asX25519EncryptionKey(
    await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
      { name: 'X25519' },
      true,
      []
    )
  )

  return { privateKey, publicKey }
}

// ---- HPKE envelope helpers ----

async function sealSeedToDevice(
  seed: Uint8Array,
  deviceEncPub: Uint8Array,
  deviceId: string
): Promise<HpkeEnvelope> {
  const suite = createHpkeSuite()
  const recipientKey = asX25519EncryptionKey(
    (await suite.kem.deserializePublicKey(deviceEncPub)) as CryptoKey
  )
  const aad = buildAad(LABEL_PUK_WRAP_TO_DEVICE, deviceId, 'puk-seed')
  return hpkeSeal(seed, recipientKey, LABEL_PUK_WRAP_TO_DEVICE, aad)
}

/**
 * Open a PUK seed envelope using the raw 32-byte X25519 private key.
 *
 * In production, this runs inside the crypto worker which holds the raw
 * device key material. The caller must provide the raw bytes, not a
 * CryptoKey handle.
 */
export async function openPukEnvelope(
  envelope: HpkeEnvelope,
  rawX25519PrivateKey: Uint8Array,
  deviceId: string
): Promise<Uint8Array> {
  const aad = buildAad(LABEL_PUK_WRAP_TO_DEVICE, deviceId, 'puk-seed')
  const suite = createHpkeSuite()
  const hpkePriv = asX25519EncryptionKey(
    (await suite.kem.deserializePrivateKey(rawX25519PrivateKey)) as CryptoKey
  )
  return hpkeOpen(envelope, hpkePriv, LABEL_PUK_WRAP_TO_DEVICE, aad)
}

// ---- Create initial PUK ----

export async function createInitialPuk(device: DeviceKeypair): Promise<InitialPukResult> {
  const seed = crypto.getRandomValues(new Uint8Array(32))

  try {
    const derived = await derivePukSubkeys(seed, 1)
    const signPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', derived.signPublic))
    const dhPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', derived.dhPublic))

    const envelope = await sealSeedToDevice(seed, device.encryption.publicKey, device.deviceId)

    return {
      generation: 1,
      envelopes: [{ deviceId: device.deviceId, envelope }],
      pukSignPubRaw: signPubRaw,
      pukDhPubRaw: dhPubRaw,
      _testOnlySeed: new Uint8Array(seed),
    }
  } finally {
    seed.fill(0)
  }
}

// ---- AES-GCM helpers for old-gen wrap ----

async function aesGcmEncrypt(
  plaintext: Uint8Array,
  key: AesGcmKey,
  aadString: string
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aad = new TextEncoder().encode(aadString)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext as BufferSource
  )
  // Pack: iv (12) || ciphertext
  const packed = new Uint8Array(12 + ct.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(ct), 12)
  return packed
}

async function aesGcmDecrypt(
  packed: Uint8Array,
  key: AesGcmKey,
  aadString: string
): Promise<Uint8Array> {
  const iv = packed.slice(0, 12)
  const ct = packed.slice(12)
  const aad = new TextEncoder().encode(aadString)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct)
  return new Uint8Array(pt)
}

// ---- Rotate PUK ----

export async function rotatePuk(params: RotatePukParams): Promise<RotatePukResult> {
  const newSeed = crypto.getRandomValues(new Uint8Array(32))
  const newGen = params.oldGen + 1

  try {
    const newDerived = await derivePukSubkeys(newSeed, newGen)
    const signPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', newDerived.signPublic))
    const dhPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', newDerived.dhPublic))

    // Wrap old seed under new SecretBox key with AAD binding
    const aadStr = `${LABEL_PUK_PREVIOUS_GEN}:gen${params.oldGen}->gen${newGen}`
    const oldGenWrapped = await aesGcmEncrypt(params.oldSeed, newDerived.secretBoxKey, aadStr)

    // Seal new seed to each remaining device
    const envelopes: PukEnvelope[] = await Promise.all(
      params.remainingDevices.map(async (d) => ({
        deviceId: d.deviceId,
        envelope: await sealSeedToDevice(newSeed, d.encryption.publicKey, d.deviceId),
      }))
    )

    return {
      newGen,
      newSeed: new Uint8Array(newSeed),
      newEnvelopes: envelopes,
      oldGenWrappedUnderNew: bytesToHex(oldGenWrapped),
      newSecretBoxKey: newDerived.secretBoxKey,
      pukSignPubRaw: signPubRaw,
      pukDhPubRaw: dhPubRaw,
    }
  } finally {
    newSeed.fill(0)
  }
}

// ---- Decrypt old gen wrap ----

export async function decryptOldGenWrap(
  wrappedHex: string,
  secretBoxKey: AesGcmKey,
  newGen: number
): Promise<Uint8Array> {
  const oldGen = newGen - 1
  const aadStr = `${LABEL_PUK_PREVIOUS_GEN}:gen${oldGen}->gen${newGen}`
  const packed = hexToBytes(wrappedHex)
  return aesGcmDecrypt(packed, secretBoxKey, aadStr)
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ---- Generation walk ----

export interface GenerationWalkParams {
  currentSeed: Uint8Array
  currentGen: number
  targetGen: number
  /** Hex-encoded AES-GCM blobs. Index = generation, value = oldGenWrappedUnderNew. */
  wrapChain: string[]
}

/**
 * Walk backwards from currentGen to targetGen, decrypting each step.
 */
export async function getPukSeedForGeneration(params: GenerationWalkParams): Promise<Uint8Array> {
  if (params.targetGen >= params.currentGen) {
    throw new Error(`targetGen (${params.targetGen}) must be < currentGen (${params.currentGen})`)
  }
  if (params.targetGen < 1) {
    throw new Error('targetGen must be >= 1')
  }

  let seed: Uint8Array = new Uint8Array(params.currentSeed)
  let gen = params.currentGen

  while (gen > params.targetGen) {
    const derived = await derivePukSubkeys(seed, gen)
    const wrappedHex = params.wrapChain[gen]
    if (!wrappedHex) {
      throw new Error(`Missing wrap chain entry for generation ${gen}`)
    }
    const prevSeed = await decryptOldGenWrap(wrappedHex, derived.secretBoxKey, gen)
    seed.fill(0)
    seed = new Uint8Array(prevSeed)
    gen--
  }

  return seed
}
