import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'

const RATCHET_SALT = utf8ToBytes('llamenos:sframe-ratchet:v1')

/**
 * Forward-secret ratchet: derive the next call secret when a new device joins.
 * The joining device ID is mixed into the HKDF `info` so the new secret is
 * unique to this rotation event.
 *
 * HKDF is preimage-resistant, so a device that obtains the new secret cannot
 * recover the previous secret — defense against late-join plaintext recovery.
 */
export function ratchetOnJoin(current: Uint8Array, joiningDeviceId: string): Uint8Array {
  const info = utf8ToBytes(`join:${joiningDeviceId}`)
  return hkdf(sha256, current, RATCHET_SALT, info, 32)
}

/**
 * Fresh random secret for departure-triggered rotation. We do NOT derive from
 * the previous secret — the departing device knew it, so any derivation would
 * leak. Instead, generate a completely independent 32-byte random secret.
 */
export function freshSecretOnLeave(): Uint8Array {
  const s = new Uint8Array(32)
  crypto.getRandomValues(s)
  return s
}

/**
 * Reject any key rotation that is not strictly `current + 1`. Prevents
 * out-of-order or replayed rotation events from desyncing receivers.
 */
export function assertKeyIdContiguous(currentKeyId: number, newKeyId: number): void {
  if (newKeyId !== currentKeyId + 1) {
    throw new Error(`key_rotation_gap: expected keyId ${currentKeyId + 1}, got ${newKeyId}`)
  }
}
