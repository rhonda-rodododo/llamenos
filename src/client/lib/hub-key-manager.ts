/**
 * Hub Key Manager
 *
 * Hub-wide symmetric encryption key management. Each hub has a random 32-byte
 * key that is ECIES-wrapped individually for each member who needs it.
 *
 * Key lifecycle:
 *   1. Admin generates hub key via generateHubKey()
 *   2. Key is wrapped for each member via wrapHubKeyForMember()
 *   3. Members fetch their wrapped key from GET /api/hub/key
 *   4. Members unwrap with their secret key via unwrapHubKey()
 *   5. Hub key encrypts/decrypts hub-scoped data via encryptForHub()/decryptFromHub()
 *   6. On rotation, admin generates new key + re-wraps for all members
 */

import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { LABEL_HUB_KEY_WRAP } from '@shared/crypto-labels'
import {
  type KeyEnvelope,
  type RecipientKeyEnvelope,
  eciesWrapKey,
  symmetricDecrypt,
  symmetricEncrypt,
} from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import { eciesUnwrapKey } from './crypto-worker-helpers'

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

/**
 * Generate a random 32-byte hub key.
 * This is NOT derived from any user key — it's pure random.
 */
export function generateHubKey(): Uint8Array {
  return randomBytes(32)
}

/**
 * Wrap a hub key for a specific member using ECIES.
 * Uses LABEL_HUB_KEY_WRAP domain separation to prevent cross-context attacks.
 */
export function wrapHubKeyForMember(
  hubKey: Uint8Array,
  memberPubkeyHex: string
): RecipientKeyEnvelope {
  return {
    pubkey: memberPubkeyHex,
    ...eciesWrapKey(hubKey, memberPubkeyHex, LABEL_HUB_KEY_WRAP),
  }
}

/**
 * Wrap a hub key for multiple members at once.
 * Returns an array of RecipientKeyEnvelopes.
 */
export function wrapHubKeyForMembers(
  hubKey: Uint8Array,
  memberPubkeys: string[]
): RecipientKeyEnvelope[] {
  return memberPubkeys.map((pk) => wrapHubKeyForMember(hubKey, pk))
}

/**
 * Unwrap a hub key from an ECIES envelope.
 * Secret key operations are delegated to the crypto worker.
 */
export async function unwrapHubKey(envelope: KeyEnvelope): Promise<Uint8Array> {
  return eciesUnwrapKey(envelope, LABEL_HUB_KEY_WRAP)
}

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

/**
 * Rotate the hub key: generate a new key and wrap it for all current members.
 * Returns the new key and all member envelopes.
 *
 * The caller is responsible for:
 * 1. Re-encrypting any hub-scoped data with the new key
 * 2. Storing the new envelopes server-side
 * 3. Distributing via GET /api/hub/key
 */
export function rotateHubKey(memberPubkeys: string[]): {
  hubKey: Uint8Array
  envelopes: RecipientKeyEnvelope[]
} {
  const hubKey = generateHubKey()
  const envelopes = wrapHubKeyForMembers(hubKey, memberPubkeys)
  return { hubKey, envelopes }
}
