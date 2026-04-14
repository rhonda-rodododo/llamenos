/**
 * Shared helper to build the AAD bytes for hub-key–encrypted record fields.
 *
 * A hub-field ciphertext is bound to `(recordId, fieldName)` so it cannot be
 * transplanted between rows or columns: moving the ciphertext changes the
 * AAD that decrypt will recompute, the Poly1305 tag fails, and decryption
 * errors cleanly.
 *
 * Both client and server MUST use this single source of truth when computing
 * AAD for hub-field encrypt/decrypt. Divergent formulas (e.g. server passing
 * a bare label while client passes `label:id:field`) produce silent decrypt
 * failures that show up as blank labels in the UI. See PR #68 post-review.
 */
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { LABEL_HUB_FIELD } from '../crypto-labels'

/**
 * Build the AAD bytes that bind a hub-field ciphertext to a specific
 * `(recordId, fieldName)` tuple.
 *
 * Format: `llamenos:hub-field:<recordId>:<fieldName>`
 */
export function hubFieldAad(recordId: string, fieldName: string): Uint8Array {
  return utf8ToBytes(`${LABEL_HUB_FIELD}:${recordId}:${fieldName}`)
}
