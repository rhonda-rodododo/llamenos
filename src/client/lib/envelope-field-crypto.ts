/**
 * Envelope Field Crypto Helpers
 *
 * Client-side decryption of ECIES envelope-encrypted PII fields
 * (user names, ban phone/reason, caller IDs, device labels, etc.).
 *
 * These fields are envelope-encrypted for the relevant actor + admin pubkeys.
 * The client decrypts when the key is unlocked (after PIN entry), or shows
 * a placeholder when locked.
 */

import { type CryptoLabel, LABEL_USER_PII } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { ClientCryptoService } from './crypto-service'

/**
 * Decrypt an ECIES envelope-encrypted field using the user's secret key.
 * Returns null if decryption fails (wrong key, no matching envelope, not unlocked).
 */
export function decryptEnvelopeField(
  encrypted: string | null | undefined,
  envelopes: RecipientEnvelope[] | null | undefined,
  secretKey: Uint8Array,
  pubkey: string,
  label: CryptoLabel = LABEL_USER_PII
): string | null {
  if (!encrypted || !envelopes?.length) return null
  try {
    const crypto = new ClientCryptoService(secretKey, pubkey)
    return crypto.envelopeDecrypt(encrypted as Ciphertext, envelopes, label)
  } catch {
    return null // Not an authorized recipient, or wrong key
  }
}
