/**
 * Cross-signing module: master key creation, device cross-signing,
 * user-to-user cross-signing, transitive trust verification, and
 * deterministic device fingerprints.
 *
 * Master key hierarchy:
 *   masterSeed (32 bytes random)
 *     -> selfSigningSeed = HMAC-SHA256(masterSeed, LABEL_MASTER_SELF_SIGNING)  -> Ed25519 keypair
 *     -> userSigningSeed = HMAC-SHA256(masterSeed, LABEL_MASTER_USER_SIGNING)  -> Ed25519 keypair
 *
 * The master seed is wrapped under the PUK SecretBox key (AES-GCM + AAD).
 */
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  LABEL_MASTER_KEY_WRAP,
  LABEL_MASTER_SELF_SIGNING,
  LABEL_MASTER_USER_SIGNING,
} from '@shared/crypto-labels'
import type { DeviceCrossSignPayload, UserCrossSignPayload } from '@shared/schemas/sigchain'

// ---- PKCS8 DER wrapper (same as puk.ts) ----

const ED25519_PKCS8_HEADER = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
])

function buildPkcs8(header: Uint8Array, seed: Uint8Array): ArrayBuffer {
  const der = new Uint8Array(48)
  der.set(header)
  der.set(seed, 16)
  return der.buffer as ArrayBuffer
}

/**
 * Import Ed25519 from seed bytes -> non-extractable private + extractable public CryptoKey.
 * Returns raw 32-byte public key alongside the CryptoKey handles.
 */
async function importEd25519FromSeed(
  seed: Uint8Array
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; publicKeyRaw: Uint8Array }> {
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

  // Import public-only from JWK (extractable for raw export)
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
    { name: 'Ed25519' },
    true,
    ['verify']
  )

  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))

  return { privateKey, publicKey, publicKeyRaw }
}

// ---- Hex helpers ----

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ---- AES-GCM helpers ----

async function aesGcmEncrypt(
  plaintext: Uint8Array,
  key: CryptoKey,
  aadString: string
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aad = new TextEncoder().encode(aadString)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext as BufferSource
  )
  const packed = new Uint8Array(12 + ct.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(ct), 12)
  return packed
}

async function aesGcmDecrypt(
  packed: Uint8Array,
  key: CryptoKey,
  aadString: string
): Promise<Uint8Array> {
  const iv = packed.slice(0, 12)
  const ct = packed.slice(12)
  const aad = new TextEncoder().encode(aadString)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct)
  return new Uint8Array(pt)
}

// ---- Result types ----

export interface MasterKeyResult {
  masterPubkey: Uint8Array
  selfSigningPubkey: Uint8Array
  userSigningPubkey: Uint8Array
  masterSeedWrappedUnderPuk: string // hex
  selfSigningPrivate: CryptoKey
  userSigningPrivate: CryptoKey
}

// ---- Master key creation (Task 27) ----

/**
 * Derive all master subkeys from a raw 32-byte master seed.
 * Returns the three pubkeys + two private CryptoKey handles.
 */
async function deriveMasterSubkeys(masterSeed: Uint8Array): Promise<{
  masterPub: { privateKey: CryptoKey; publicKey: CryptoKey; publicKeyRaw: Uint8Array }
  selfSigning: { privateKey: CryptoKey; publicKey: CryptoKey; publicKeyRaw: Uint8Array }
  userSigning: { privateKey: CryptoKey; publicKey: CryptoKey; publicKeyRaw: Uint8Array }
}> {
  // Master pubkey is derived directly from the master seed as Ed25519
  const masterPub = await importEd25519FromSeed(masterSeed)

  // Derive subkey seeds via HMAC-SHA256 (key = masterSeed, message = label as bytes)
  const enc = new TextEncoder()
  const selfSigningSeed = hmac(sha256, masterSeed, enc.encode(LABEL_MASTER_SELF_SIGNING))
  const userSigningSeed = hmac(sha256, masterSeed, enc.encode(LABEL_MASTER_USER_SIGNING))

  const selfSigning = await importEd25519FromSeed(selfSigningSeed)
  const userSigning = await importEd25519FromSeed(userSigningSeed)

  // Zero derived seeds
  selfSigningSeed.fill(0)
  userSigningSeed.fill(0)

  return { masterPub, selfSigning, userSigning }
}

/**
 * Create a new master key from a fresh 32-byte random seed.
 * The seed is wrapped under the PUK SecretBox key (AES-GCM with AAD).
 */
export async function createMasterKey({
  pukSecretBoxKey,
}: {
  pukSecretBoxKey: CryptoKey
}): Promise<MasterKeyResult> {
  const masterSeed = crypto.getRandomValues(new Uint8Array(32))

  try {
    const { masterPub, selfSigning, userSigning } = await deriveMasterSubkeys(masterSeed)

    // Wrap master seed under PUK SecretBox
    const wrapped = await aesGcmEncrypt(masterSeed, pukSecretBoxKey, LABEL_MASTER_KEY_WRAP)

    return {
      masterPubkey: masterPub.publicKeyRaw,
      selfSigningPubkey: selfSigning.publicKeyRaw,
      userSigningPubkey: userSigning.publicKeyRaw,
      masterSeedWrappedUnderPuk: bytesToHex(wrapped),
      selfSigningPrivate: selfSigning.privateKey,
      userSigningPrivate: userSigning.privateKey,
    }
  } finally {
    masterSeed.fill(0)
  }
}

/**
 * Re-derive master subkeys from a wrapped master seed.
 */
export async function deriveMasterFromWrapped({
  wrapped,
  pukSecretBoxKey,
}: {
  wrapped: string
  pukSecretBoxKey: CryptoKey
}): Promise<MasterKeyResult> {
  const packed = hexToBytes(wrapped)
  const masterSeed = await aesGcmDecrypt(packed, pukSecretBoxKey, LABEL_MASTER_KEY_WRAP)

  try {
    const { masterPub, selfSigning, userSigning } = await deriveMasterSubkeys(masterSeed)

    // Re-wrap (same plaintext, fresh IV)
    const reWrapped = await aesGcmEncrypt(masterSeed, pukSecretBoxKey, LABEL_MASTER_KEY_WRAP)

    return {
      masterPubkey: masterPub.publicKeyRaw,
      selfSigningPubkey: selfSigning.publicKeyRaw,
      userSigningPubkey: userSigning.publicKeyRaw,
      masterSeedWrappedUnderPuk: bytesToHex(reWrapped),
      selfSigningPrivate: selfSigning.privateKey,
      userSigningPrivate: userSigning.privateKey,
    }
  } finally {
    masterSeed.fill(0)
  }
}

// ---- Device cross-signing (Task 28) ----

/**
 * Sign a device's signing pubkey with the self-signing key.
 * Returns a DeviceCrossSignPayload-compatible object (minus signerDeviceId/targetDeviceId
 * which are caller-supplied).
 */
export async function crossSignOwnDevice({
  deviceSigningPubkey,
  selfSigningPrivate,
  signerDeviceId,
  targetDeviceId,
}: {
  deviceSigningPubkey: Uint8Array
  selfSigningPrivate: CryptoKey
  signerDeviceId: string
  targetDeviceId: string
}): Promise<DeviceCrossSignPayload> {
  const signature = await crypto.subtle.sign(
    'Ed25519',
    selfSigningPrivate,
    deviceSigningPubkey as BufferSource
  )
  return {
    type: 'device_cross_sign',
    signerDeviceId,
    targetDeviceId,
    targetSigningPubkey: bytesToHex(deviceSigningPubkey),
    signature: bytesToHex(new Uint8Array(signature)),
  }
}

// ---- User-to-user cross-signing (Task 29) ----

/**
 * Sign another user's master pubkey with our user-signing key.
 */
export async function crossSignOtherUser({
  targetMasterPubkey,
  userSigningPrivate,
  signerUserId,
  targetUserId,
}: {
  targetMasterPubkey: Uint8Array
  userSigningPrivate: CryptoKey
  signerUserId: string
  targetUserId: string
}): Promise<UserCrossSignPayload> {
  const signature = await crypto.subtle.sign(
    'Ed25519',
    userSigningPrivate,
    targetMasterPubkey as BufferSource
  )
  return {
    type: 'user_cross_sign',
    signerUserId,
    targetUserId,
    targetMasterPubkey: bytesToHex(targetMasterPubkey),
    signature: bytesToHex(new Uint8Array(signature)),
  }
}

/**
 * Verify an Ed25519 cross-signature.
 */
export async function verifyCrossSignature({
  signature,
  signerPublicKey,
  signedData,
}: {
  signature: string // hex
  signerPublicKey: Uint8Array
  signedData: Uint8Array
}): Promise<boolean> {
  const pubKey = await crypto.subtle.importKey(
    'raw',
    signerPublicKey as BufferSource,
    { name: 'Ed25519' },
    false,
    ['verify']
  )
  const sigBytes = hexToBytes(signature)
  return crypto.subtle.verify(
    'Ed25519',
    pubKey,
    sigBytes as BufferSource,
    signedData as BufferSource
  )
}

/**
 * Verify transitive trust: user A cross-signed user B's master key,
 * and user B's self-signing key signed device D's pubkey.
 *
 * Two-step verification:
 * 1. Trusting user's user-signing key validly signed the candidate's master pubkey
 * 2. Candidate's self-signing key validly signed the candidate's device pubkey
 *
 * Both the master pubkey (for cross-sign binding) and the self-signing pubkey
 * (for device signature verification) are required because the self-signing key
 * is HMAC-derived from the master seed and cannot be recovered from the master
 * pubkey alone.
 */
export async function verifyTransitiveTrust({
  trustingUserSigningPub,
  crossSignature,
  candidateMasterPub,
  selfSignSignature,
  candidateDevicePub,
  candidateSelfSigningPub,
}: {
  trustingUserSigningPub: Uint8Array
  crossSignature: string // hex — trusting user's user-signing sig over candidate master pub
  candidateMasterPub: Uint8Array
  selfSignSignature: string // hex — candidate's self-signing sig over device pub
  candidateDevicePub: Uint8Array
  candidateSelfSigningPub: Uint8Array
}): Promise<boolean> {
  // 1. Verify trusting user cross-signed candidate's master pubkey
  const crossValid = await verifyCrossSignature({
    signature: crossSignature,
    signerPublicKey: trustingUserSigningPub,
    signedData: candidateMasterPub,
  })
  if (!crossValid) return false

  // 2. Verify candidate's self-signing key signed the device pubkey
  const selfSignValid = await verifyCrossSignature({
    signature: selfSignSignature,
    signerPublicKey: candidateSelfSigningPub,
    signedData: candidateDevicePub,
  })

  return selfSignValid
}

// ---- Fingerprint (deterministic SAS-style) ----

/**
 * Compute a deterministic fingerprint for a device signing pubkey.
 * SHA-256 the pubkey, take first 8 bytes, format as 4 groups of 4 hex chars
 * separated by colons.
 */
export async function computeDeviceFingerprint(signingPubkey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', signingPubkey as BufferSource)
  const first8 = new Uint8Array(hash, 0, 8)
  const hex = bytesToHex(first8)
  // Format: xxxx:xxxx:xxxx:xxxx
  return `${hex.slice(0, 4)}:${hex.slice(4, 8)}:${hex.slice(8, 12)}:${hex.slice(12, 16)}`
}
