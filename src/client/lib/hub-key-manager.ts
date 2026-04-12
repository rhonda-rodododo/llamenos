/**
 * Hub Key Manager
 *
 * Hub-wide symmetric encryption key management. Each hub has a random 32-byte
 * key (the hub PTK) that is HPKE-wrapped individually for each *device* that
 * needs it. On rotation, the old generation key is AES-GCM wrapped under the
 * new key (CLKR chain) so devices can walk back to decrypt historical data.
 *
 * Key lifecycle:
 *   1. Admin generates hub key via generateHubKey()
 *   2. Key is HPKE-wrapped for each device via wrapHubKeyForDevice[s]()
 *   3. Devices fetch their envelope from GET /api/hub/key
 *   4. Devices unwrap with their X25519 private key via unwrapHubKeyForDevice()
 *   5. Hub key encrypts/decrypts hub-scoped data via encryptForHub()/decryptFromHub()
 *   6. On rotation: rotateHubKeyClkr() generates new key, wraps old under new,
 *      HPKE-wraps new key to remaining devices, computes commitment hashes
 */

import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_HUB_KEY_WRAP, LABEL_HUB_PTK_PREV_GEN } from '@shared/crypto-labels'
import { symmetricDecrypt, symmetricEncrypt } from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type { EnvelopeV3 } from '@shared/envelope-v3'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'

// ---- Random bytes helper ----

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

// ---- Hex helpers ----

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ---- Hub key generation (unchanged) ----

/**
 * Generate a random 32-byte hub key.
 * This is NOT derived from any user key — it's pure random.
 */
export function generateHubKey(): Uint8Array {
  return randomBytes(32)
}

// ---- Hub-scoped symmetric encryption (unchanged) ----

/**
 * Encrypt arbitrary data with the hub key using XChaCha20-Poly1305.
 * Returns hex: nonce(24) + ciphertext.
 * The AAD cryptographically binds the ciphertext to a context (e.g. record id + field name).
 */
export function encryptForHub(plaintext: string, hubKey: Uint8Array, aad: Uint8Array): Ciphertext {
  return symmetricEncrypt(utf8ToBytes(plaintext), hubKey, aad)
}

/**
 * Decrypt hub-encrypted data using the hub key.
 * Returns null on decryption failure (wrong key, corrupted data, AAD mismatch, etc.).
 */
export function decryptFromHub(
  packed: Ciphertext,
  hubKey: Uint8Array,
  aad: Uint8Array
): string | null {
  try {
    return new TextDecoder().decode(symmetricDecrypt(packed, hubKey, aad))
  } catch {
    return null
  }
}

// ---- Per-device HPKE wrapping (Task 24) ----

/**
 * HPKE-wrap a hub key for a specific device.
 *
 * @param hubKey          The 32-byte hub symmetric key
 * @param deviceEncPubkey Recipient device's X25519 public key (CryptoKey from HPKE KEM)
 * @param deviceId        Stable device identifier (bound in AAD)
 * @param hubId           Hub UUID (bound in AAD)
 */
export async function wrapHubKeyForDevice(
  hubKey: Uint8Array,
  deviceEncPubkey: CryptoKey,
  deviceId: string,
  hubId: string
): Promise<EnvelopeV3> {
  const aad = buildAad(LABEL_HUB_KEY_WRAP, deviceId, hubId)
  return hpkeSeal(hubKey, deviceEncPubkey, LABEL_HUB_KEY_WRAP, aad)
}

/**
 * HPKE-wrap a hub key for multiple devices in parallel.
 */
export async function wrapHubKeyForDevices(
  hubKey: Uint8Array,
  devices: Array<{ deviceId: string; encPubkey: CryptoKey }>,
  hubId: string
): Promise<Array<{ deviceId: string; envelope: EnvelopeV3 }>> {
  return Promise.all(
    devices.map(async (d) => ({
      deviceId: d.deviceId,
      envelope: await wrapHubKeyForDevice(hubKey, d.encPubkey, d.deviceId, hubId),
    }))
  )
}

/**
 * Unwrap a hub key from an HPKE envelope using a device's private key.
 *
 * @param envelope         The EnvelopeV3 received from the server
 * @param devicePrivateKey Device's X25519 private key (CryptoKey from HPKE KEM)
 * @param deviceId         The device identifier (must match what was used during wrapping)
 * @param hubId            Hub UUID (must match what was used during wrapping)
 * @returns                The 32-byte hub key
 */
export async function unwrapHubKeyForDevice(
  envelope: EnvelopeV3,
  devicePrivateKey: CryptoKey,
  deviceId: string,
  hubId: string
): Promise<Uint8Array> {
  const aad = buildAad(LABEL_HUB_KEY_WRAP, deviceId, hubId)
  return hpkeOpen(envelope, devicePrivateKey, LABEL_HUB_KEY_WRAP, aad)
}

// ---- Old-generation AES-GCM wrapping (CLKR chain) ----

/**
 * AES-GCM-256 wrap an old-generation hub key under the new-generation hub key.
 *
 * The AAD binds the ciphertext to the hub and generation transition, preventing
 * an attacker from splicing wrap entries across hubs or generations.
 *
 * @returns Hex string of (12-byte IV || ciphertext+tag)
 */
export async function wrapOldGenUnderNew(
  oldHubKey: Uint8Array,
  newHubKey: Uint8Array,
  hubId: string,
  newGen: number
): Promise<string> {
  const iv = randomBytes(12)
  const aadString = `${LABEL_HUB_PTK_PREV_GEN}:${hubId}:${newGen}`
  const aad = new TextEncoder().encode(aadString)

  const importedKey = await crypto.subtle.importKey(
    'raw',
    newHubKey as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  const ct = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      additionalData: aad as BufferSource,
    },
    importedKey,
    oldHubKey as BufferSource
  )

  const packed = new Uint8Array(12 + ct.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(ct), 12)
  return bytesToHex(packed)
}

/**
 * Unwrap an old-generation hub key from the CLKR chain.
 *
 * @param wrapped  Hex string produced by wrapOldGenUnderNew
 * @param newHubKey The new-generation hub key that was used as the wrapping key
 * @param hubId     Hub UUID (must match wrapping AAD)
 * @param newGen    The new generation number (must match wrapping AAD)
 * @returns         The 32-byte old-generation hub key
 */
export async function unwrapOldGen(
  wrapped: string,
  newHubKey: Uint8Array,
  hubId: string,
  newGen: number
): Promise<Uint8Array> {
  const packed = hexToBytes(wrapped)
  const iv = packed.slice(0, 12)
  const ct = packed.slice(12)
  const aadString = `${LABEL_HUB_PTK_PREV_GEN}:${hubId}:${newGen}`
  const aad = new TextEncoder().encode(aadString)

  const importedKey = await crypto.subtle.importKey(
    'raw',
    newHubKey as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad as BufferSource },
    importedKey,
    ct
  )

  return new Uint8Array(pt)
}

// ---- Generation chain walk ----

export interface GenerationWalkParams {
  currentHubKey: Uint8Array
  currentGen: number
  targetGen: number
  /** Map from generation number to hex-encoded wrap blob (oldGen wrapped under that gen's key) */
  wrapChain: Map<number, string>
  hubId: string
}

/**
 * Walk backwards from currentGen to targetGen, unwrapping at each step.
 *
 * At generation N, the wrap chain entry at key N contains the gen-(N-1) key
 * encrypted under the gen-N key. So we unwrap entry N to get key N-1, then
 * entry N-1 to get key N-2, etc.
 *
 * @throws If targetGen >= currentGen or if any chain entry is missing
 */
export async function walkGenerationChain(params: GenerationWalkParams): Promise<Uint8Array> {
  const { currentGen, targetGen, wrapChain, hubId } = params

  if (targetGen >= currentGen) {
    throw new Error(`targetGen (${targetGen}) must be < currentGen (${currentGen})`)
  }
  if (targetGen < 1) {
    throw new Error('targetGen must be >= 1')
  }

  let key: Uint8Array = new Uint8Array(params.currentHubKey)
  let gen = currentGen

  while (gen > targetGen) {
    const wrappedHex = wrapChain.get(gen)
    if (!wrappedHex) {
      throw new Error(`Missing wrap chain entry for generation ${gen}`)
    }
    key = await unwrapOldGen(wrappedHex, key, hubId, gen)
    gen--
  }

  return key
}

// ---- CLKR rotation (Task 25) ----

export interface HubKeyRotationResult {
  newHubKey: Uint8Array
  newGeneration: number
  oldGenWrappedUnderNew: string // hex
  deviceEnvelopes: Array<{ deviceId: string; envelope: EnvelopeV3 }>
  deviceCommitments: Array<{ deviceId: string; commitmentHash: string }>
}

/**
 * Perform a CLKR hub key rotation.
 *
 * Generates a new random hub key, wraps the old key under the new one for
 * chain continuity, HPKE-wraps the new key to each remaining device, and
 * computes per-device commitment hashes for the sigchain entry.
 *
 * Commitment hash: SHA-256(deviceId || envelope.ct) as hex. This binds the
 * envelope to the device identity without revealing the key material, and is
 * recorded in the hub_ptk_rotate sigchain entry for auditability.
 */
export async function rotateHubKeyClkr(params: {
  hubId: string
  currentHubKey: Uint8Array
  currentGen: number
  remainingDevices: Array<{ deviceId: string; encPubkey: CryptoKey }>
}): Promise<HubKeyRotationResult> {
  const { hubId, currentHubKey, currentGen, remainingDevices } = params
  const newGen = currentGen + 1

  // 1. Generate new hub key
  const newHubKey = generateHubKey()

  // 2. Wrap old key under new key for chain continuity
  const oldGenWrappedUnderNew = await wrapOldGenUnderNew(currentHubKey, newHubKey, hubId, newGen)

  // 3. HPKE-wrap new key to each remaining device
  const deviceEnvelopes = await wrapHubKeyForDevices(newHubKey, remainingDevices, hubId)

  // 4. Compute commitment hashes: SHA-256(deviceId || envelope.ct) as hex
  const deviceCommitments = deviceEnvelopes.map(({ deviceId, envelope }) => {
    const deviceIdBytes = new TextEncoder().encode(deviceId)
    const ctBytes = new TextEncoder().encode(envelope.ct)
    const preimage = new Uint8Array(deviceIdBytes.length + ctBytes.length)
    preimage.set(deviceIdBytes)
    preimage.set(ctBytes, deviceIdBytes.length)
    const hash = sha256(preimage)
    return { deviceId, commitmentHash: bytesToHex(hash) }
  })

  return {
    newHubKey,
    newGeneration: newGen,
    oldGenWrappedUnderNew,
    deviceEnvelopes,
    deviceCommitments,
  }
}
