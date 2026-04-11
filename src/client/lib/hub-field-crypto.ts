/**
 * Hub Field Crypto Helpers
 *
 * Client-side decryption/encryption of hub-scoped organizational metadata
 * (hub names, role names, custom field labels, etc.).
 *
 * All org metadata is now encrypted-only. The client decrypts when the hub key
 * is available (after PIN unlock), or shows a placeholder.
 *
 * AAD binding: every ciphertext is bound to `(recordId, fieldName)` to prevent
 * ciphertexts from being transplanted between rows or columns.
 */

import type { Ciphertext } from '@shared/crypto-types'
import { hubFieldAad } from '@shared/lib/hub-field-aad'
import { getHubKeyForId } from './hub-key-cache'
import { decryptFromHub, encryptForHub } from './hub-key-manager'

/**
 * A real ciphertext is an even-length hex string of at least 48 chars
 * (24-byte nonce + 16-byte poly1305 tag in hex). If the stored "encrypted"
 * value is NOT a valid ciphertext, it's plaintext (fallback path on the server
 * when the client has no hub key). Safe to surface to UI either way.
 */
function looksLikeCiphertext(s: string): boolean {
  return s.length >= 48 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s)
}

/**
 * Decrypt a hub-encrypted field.
 *
 * Boundary adapter: accepts unbranded `string` from API responses and casts to
 * `Ciphertext` for the crypto layer. Once shared API types are branded (tracked
 * in field-encryption backlog), this cast can be removed.
 *
 * The AAD `(recordId, fieldName)` must match what was used at encrypt time.
 * If it doesn't, the ChaCha20-Poly1305 authentication tag will not verify and
 * decryption returns null → placeholder is shown.
 *
 * @param encrypted - Hex ciphertext from the server (encryptedName, etc.)
 * @param hubId - Hub ID to look up the hub key
 * @param recordId - The server-assigned ID of the record (e.g. `item.id`)
 * @param fieldName - The DB column name of the encrypted field (e.g. `'encrypted_name'`)
 * @param placeholder - Fallback when decryption fails or hub key absent (default: empty string)
 * @returns Decrypted string, or placeholder
 */
export function decryptHubField(
  encrypted: string | null | undefined,
  hubId: string,
  recordId: string,
  fieldName: string,
  placeholder = ''
): string {
  if (!encrypted) return placeholder
  const hubKey = getHubKeyForId(hubId)
  if (!hubKey) {
    // If the stored value looks like real ciphertext, we can't decrypt it without
    // the key — show placeholder rather than leaking hex to the UI. If it's not
    // ciphertext (plaintext server-fallback path), surface the readable value.
    return looksLikeCiphertext(encrypted) ? placeholder : encrypted
  }
  const aad = hubFieldAad(recordId, fieldName)
  const decrypted = decryptFromHub(encrypted as Ciphertext, hubKey, aad)
  // Decryption succeeded → return plaintext.
  // Decryption failed on a ciphertext-looking value → placeholder (don't leak hex).
  // Decryption failed on a plaintext value → surface it (test/plaintext fallback).
  return decrypted ?? (looksLikeCiphertext(encrypted) ? placeholder : encrypted)
}

/**
 * Encrypt a value with the hub key for sending to the server.
 *
 * The AAD `(recordId, fieldName)` binds the ciphertext to the specific row and
 * column it belongs to — a ciphertext cannot be moved to another row or column
 * without failing authentication on decrypt.
 *
 * For UPDATE operations, `recordId` is the existing record's server-assigned ID.
 * For CREATE operations, pass `crypto.randomUUID()` as `recordId` — the first
 * read-back will fall through to the plaintext server fallback (if the server
 * also stores a plaintext copy), and on the next update the ciphertext will be
 * re-encrypted with the real ID. This is an inherent limitation of client-side
 * AAD when the server generates IDs; it is preferred over omitting AAD entirely.
 *
 * Returns the ciphertext, or undefined if the hub key is not available.
 */
export function encryptHubField(
  value: string,
  hubId: string,
  recordId: string,
  fieldName: string
): Ciphertext | undefined {
  const hubKey = getHubKeyForId(hubId)
  if (!hubKey) return undefined
  const aad = hubFieldAad(recordId, fieldName)
  return encryptForHub(value, hubKey, aad)
}
