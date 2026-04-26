/**
 * Hub-event encryption for Nostr relay events.
 *
 * The hub key is client-side only (HPKE-wrapped per member); the server never
 * holds the raw hub key. For server-published events, we derive a symmetric
 * event encryption key from SERVER_NOSTR_SECRET so that relay content is
 * encrypted at rest. Clients receive this key via the hub key distribution
 * envelope (the admin wraps it alongside the hub key).
 *
 * Derivation:
 *   event_key = HKDF(SHA-256, SERVER_NOSTR_SECRET, salt=empty, info="llamenos:hub-event", 32)
 *   nonce = random(12)
 *   ciphertext = AES-256-GCM(event_key, nonce).encrypt(UTF-8(json))
 *   output = hex(nonce || ciphertext+tag)
 *
 * Clients receive the server's event key via GET /api/auth/me (serverEventKeyHex).
 */

import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { aesGcmDecrypt, aesGcmEncrypt } from '@shared/aes-gcm'
import { LABEL_HUB_EVENT } from '@shared/crypto-labels'

/**
 * Derive the server event encryption key from SERVER_NOSTR_SECRET.
 * Deterministic — same secret always produces the same key.
 */
export function deriveServerEventKey(serverSecret: string): Uint8Array {
  return hkdf(sha256, hexToBytes(serverSecret), new Uint8Array(0), utf8ToBytes(LABEL_HUB_EVENT), 32)
}

/**
 * Decrypt event content from Nostr relay.
 * Returns parsed object, or null on failure (wrong key, corrupted data).
 */
export async function decryptHubEvent(
  packed: string,
  eventKey: Uint8Array
): Promise<Record<string, unknown> | null> {
  try {
    const plaintext = await aesGcmDecrypt(packed, eventKey, new Uint8Array(0))
    return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Encrypt event content for Nostr relay publication.
 * Returns hex-encoded nonce || ciphertext+tag.
 */
export async function encryptHubEvent(
  content: Record<string, unknown>,
  eventKey: Uint8Array
): Promise<string> {
  return aesGcmEncrypt(utf8ToBytes(JSON.stringify(content)), eventKey, new Uint8Array(0))
}
