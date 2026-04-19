/**
 * Higher-level envelope encryption helpers for messages, blasts, and drafts.
 *
 * These are pure (no DOM, no crypto worker) so they can run in server, worker, and test contexts.
 * All async/worker-delegating variants live in src/client/lib/crypto-worker-helpers.ts.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  HKDF_CONTEXT_DRAFTS,
  HKDF_CONTEXT_EXPORT,
  HKDF_SALT,
  LABEL_BLAST_CONTENT,
  LABEL_MESSAGE,
} from './crypto-labels'
import {
  type RecipientKeyEnvelope,
  eciesUnwrapKeyWithSecret,
  eciesWrapKey,
  hkdfDerive,
} from './crypto-primitives'
import type { Ciphertext } from './crypto-types'
import type { BlastContent } from './types'

// --- Internal helpers ---

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

// --- E2EE Message Encryption ---
// Same envelope pattern as notes, using LABEL_MESSAGE for domain separation.
// Used for SMS, WhatsApp, Signal, and web report messages.

export interface EncryptedMessagePayload {
  encryptedContent: Ciphertext // hex: nonce(24) + ciphertext
  readerEnvelopes: RecipientKeyEnvelope[] // message key wrapped for each reader
}

/**
 * Encrypt a message for multiple readers using the envelope pattern.
 * Generates a random per-message symmetric key, wraps it for each reader via ECIES.
 *
 * @param plaintext - Message text to encrypt
 * @param readerPubkeys - Array of reader x-only pubkeys (author + admins)
 */
export function encryptMessage(
  plaintext: string,
  readerPubkeys: string[]
): EncryptedMessagePayload {
  const messageKey = randomBytes(32)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(messageKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext))

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encryptedContent: bytesToHex(packed) as Ciphertext,
    readerEnvelopes: readerPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(messageKey, pk, LABEL_MESSAGE),
    })),
  }
}

// --- Blast Content Encryption ---

export interface EncryptedBlastContentPayload {
  encryptedContent: Ciphertext
  contentEnvelopes: RecipientKeyEnvelope[]
}

export function encryptBlastContent(
  content: BlastContent,
  recipientPubkeys: string[]
): EncryptedBlastContentPayload {
  const blastKey = randomBytes(32)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(blastKey, nonce)
  const ciphertext = cipher.encrypt(utf8ToBytes(JSON.stringify(content)))

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    encryptedContent: bytesToHex(packed) as Ciphertext,
    contentEnvelopes: recipientPubkeys.map((pk) => ({
      pubkey: pk,
      ...eciesWrapKey(blastKey, pk, LABEL_BLAST_CONTENT),
    })),
  }
}

/**
 * Decrypt blast content with an explicit secret key (no worker needed).
 * Used by server-side code and unit tests where the secret key is directly available.
 */
export function decryptBlastContentWithKey(
  encryptedContent: string,
  contentEnvelopes: RecipientKeyEnvelope[],
  secretKey: Uint8Array,
  readerPubkey: string
): BlastContent | null {
  try {
    const envelope = contentEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    const blastKey = eciesUnwrapKeyWithSecret(envelope, secretKey, LABEL_BLAST_CONTENT)

    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(blastKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return JSON.parse(new TextDecoder().decode(plaintext)) as BlastContent
  } catch {
    return null
  }
}

// --- Draft Encryption ---
// Same as notes but with "drafts" domain separation for local draft auto-save

export function encryptDraft(plaintext: string, secretKey: Uint8Array): string {
  const key = hkdfDerive(secretKey, utf8ToBytes(HKDF_SALT), utf8ToBytes(HKDF_CONTEXT_DRAFTS), 32)
  const nonce = randomBytes(24)
  const data = utf8ToBytes(plaintext)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(data)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return bytesToHex(packed)
}

export function decryptDraft(packed: string, secretKey: Uint8Array): string | null {
  try {
    const key = hkdfDerive(secretKey, utf8ToBytes(HKDF_SALT), utf8ToBytes(HKDF_CONTEXT_DRAFTS), 32)
    const data = hexToBytes(packed)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(key, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

// --- Export Encryption ---
// Encrypts a JSON export blob so it can only be read with the user's key

export function encryptExport(jsonString: string, secretKey: Uint8Array): Uint8Array {
  const key = hkdfDerive(secretKey, utf8ToBytes(HKDF_SALT), utf8ToBytes(HKDF_CONTEXT_EXPORT), 32)
  const nonce = randomBytes(24)
  const data = utf8ToBytes(jsonString)
  const cipher = xchacha20poly1305(key, nonce)
  const ciphertext = cipher.encrypt(data)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)
  return packed
}
