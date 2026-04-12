/**
 * Hub Field Crypto — Tier 1 async wrappers.
 *
 * The public surface `encryptHubField(value, hubId, recordId, fieldName)` and
 * `decryptHubField(encrypted, hubId, recordId, fieldName, placeholder)` are
 * identical in shape to Tier 0 except both are now `async` and both route
 * through `hub-field-crypto-v3.ts` (WebCrypto AES-256-GCM on a non-extractable
 * `CryptoKey`). The raw 32-byte hub key never flows through the AEAD call —
 * only the `CryptoKey` handle from `hub-key-cache.ts`.
 *
 * Wire format is base64url `nonce12 || ct+tag16`, chosen by v3. Migration 0053
 * wiped every pre-existing hub-field ciphertext when Tier 1 PR-A landed, so
 * there is no mixed on-disk state: every row that is non-NULL today is a v3
 * base64url blob.
 *
 * AAD binding: every ciphertext is bound to `(recordId, fieldName)` via
 * `hubFieldAad` — the same helper that drove the Tier 0 AAD. A ciphertext
 * cannot be transplanted between rows or columns without failing AES-GCM
 * authentication.
 */

import type { Ciphertext } from '@shared/crypto-types'
import { decryptHubFieldV3, encryptHubFieldV3 } from './hub-field-crypto-v3'
import { getHubKeyCryptoKeyForId, getHubKeyForId } from './hub-key-cache'

/**
 * A "plaintext fallback" heuristic: during initial hub setup the server may
 * round-trip a plaintext value back to the client before the hub key has
 * been loaded. If that happens, surface the readable value instead of
 * dropping it on the floor. A v3 ciphertext is base64url — the probe is
 * length-based (nonce 12 + tag 16 ≈ 40 base64url chars minimum) plus an
 * alphabet check.
 */
function looksLikeV3Ciphertext(s: string): boolean {
  if (s.length < 40) return false
  return /^[A-Za-z0-9_-]+$/.test(s)
}

/**
 * Encrypt a value with the hub key for sending to the server.
 *
 * The AAD `(recordId, fieldName)` binds the ciphertext to the specific row
 * and column it belongs to — a ciphertext cannot be moved to another row or
 * column without failing authentication on decrypt.
 *
 * For UPDATE operations, `recordId` is the existing record's server-assigned
 * ID. For CREATE operations, prefer client-generated UUIDs so the ciphertext
 * is bound to the final row ID from the moment it is written. Callers that
 * cannot use client-generated IDs can pass `crypto.randomUUID()`; the server
 * fallback path (plaintext column) handles the rare read-before-rewrite edge.
 *
 * Returns the ciphertext, or `undefined` if the hub key is not yet loaded.
 * Callers must tolerate the `undefined` case — pass plaintext to the server
 * as a fallback so the write still succeeds.
 */
export async function encryptHubField(
  value: string,
  hubId: string,
  recordId: string,
  fieldName: string
): Promise<Ciphertext | undefined> {
  const hubKey = getHubKeyCryptoKeyForId(hubId)
  if (!hubKey) return undefined
  return (await encryptHubFieldV3(value, hubKey, recordId, fieldName)) as Ciphertext
}

/**
 * Decrypt a hub-encrypted field.
 *
 * Boundary adapter: accepts unbranded `string` from API responses and casts
 * to `Ciphertext` for the crypto layer. The AAD `(recordId, fieldName)` must
 * match what was used at encrypt time. If it doesn't, AES-GCM authentication
 * will fail and the placeholder is returned.
 */
export async function decryptHubField(
  encrypted: string | null | undefined,
  hubId: string,
  recordId: string,
  fieldName: string,
  placeholder = ''
): Promise<string> {
  if (!encrypted) return placeholder
  const hubKey = getHubKeyCryptoKeyForId(hubId)
  if (!hubKey) {
    return looksLikeV3Ciphertext(encrypted) ? placeholder : encrypted
  }
  const decrypted = await decryptHubFieldV3(encrypted, hubKey, recordId, fieldName)
  if (decrypted !== null) return decrypted
  return looksLikeV3Ciphertext(encrypted) ? placeholder : encrypted
}

/**
 * Legacy raw-bytes accessor kept for the Nostr event decryption path which
 * still needs the 32-byte hub key. Removed once the Nostr path also moves
 * to CryptoKey-only (tracked as a follow-up in `HPKE_MIGRATION_NOTES.md`).
 */
export function getHubKeyRawBytesForLegacyPath(hubId: string): Uint8Array | null {
  return getHubKeyForId(hubId)
}
