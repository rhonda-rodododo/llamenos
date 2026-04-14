/**
 * Async crypto helpers that delegate secret-key operations to the crypto worker.
 * The secret key never touches the main thread — all ECDH is performed inside the worker.
 *
 * These functions require a browser context (Web Worker + cryptoWorker singleton).
 * For pure/server-side usage, see @shared/crypto-envelopes and @shared/crypto-primitives.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import {
  type CryptoLabel,
  LABEL_BLAST_CONTENT,
  LABEL_CALL_META,
  LABEL_MESSAGE,
  LABEL_NOTE_KEY,
  LABEL_TRANSCRIPTION,
} from '@shared/crypto-labels'
import type { KeyEnvelope, RecipientKeyEnvelope } from '@shared/crypto-primitives'
import type { BlastContent, NotePayload } from '@shared/types'
import { cryptoWorker } from './crypto-worker-client'

/**
 * Unwrap a 32-byte symmetric key from an ECIES envelope via the crypto worker.
 * The secret key never touches the main thread.
 * Must use the same `label` that was used during wrapping.
 */
export async function eciesUnwrapKey(
  envelope: KeyEnvelope,
  label: CryptoLabel
): Promise<Uint8Array> {
  // TODO(tier-1 per-record-aad): ECIES key-wraps produced by
  // `@shared/crypto-primitives` `eciesWrapKey` today seal with an empty
  // inner AEAD AAD. Migrate both sides to
  // `buildAad(label, recordId, fieldName)` alongside
  // POST_OVERHAUL_GAPS_2026-04-13.md Tier 1 P1 "Per-record AAD migration".
  const resultHex = await cryptoWorker.decrypt(
    envelope.ephemeralPubkey,
    envelope.wrappedKey,
    label,
    new Uint8Array(0)
  )
  return hexToBytes(resultHex)
}

/**
 * Decrypt a note using the appropriate envelope for the current user.
 * Secret key operations are delegated to the crypto worker.
 */
export async function decryptNote(
  encryptedContent: string,
  envelope: KeyEnvelope
): Promise<NotePayload | null> {
  try {
    const noteKey = await eciesUnwrapKey(envelope, LABEL_NOTE_KEY)
    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(noteKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    const decoded = new TextDecoder().decode(plaintext)
    try {
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        return parsed as NotePayload
      }
    } catch {
      // Not JSON
    }
    return { text: decoded }
  } catch {
    return null
  }
}

/**
 * Decrypt a message using the reader's envelope.
 * Finds the envelope matching the reader's pubkey and unwraps the message key.
 * Secret key operations are delegated to the crypto worker.
 *
 * @param encryptedContent - hex: nonce(24) + ciphertext
 * @param readerEnvelopes - array of per-reader ECIES envelopes
 * @param readerPubkey - reader's x-only pubkey (hex) to find the matching envelope
 */
export async function decryptMessage(
  encryptedContent: string,
  readerEnvelopes: RecipientKeyEnvelope[],
  readerPubkey: string
): Promise<string | null> {
  try {
    const envelope = readerEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    const messageKey = await eciesUnwrapKey(envelope, LABEL_MESSAGE)

    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(messageKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

/**
 * Decrypt blast content using the crypto worker (main thread, no secret key access).
 * Used by the client UI when the worker is unlocked.
 */
export async function decryptBlastContent(
  encryptedContent: string,
  contentEnvelopes: RecipientKeyEnvelope[],
  readerPubkey: string
): Promise<BlastContent | null> {
  try {
    const envelope = contentEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    const blastKey = await eciesUnwrapKey(envelope, LABEL_BLAST_CONTENT)

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

/**
 * Decrypt a call record's encrypted metadata.
 * Returns the decrypted fields or null if decryption fails.
 * Secret key operations are delegated to the crypto worker.
 */
export async function decryptCallRecord(
  encryptedContent: string,
  adminEnvelopes: RecipientKeyEnvelope[],
  readerPubkey: string
): Promise<{ answeredBy: string | null; callerNumber: string } | null> {
  try {
    const envelope = adminEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    const recordKey = await eciesUnwrapKey(envelope, LABEL_CALL_META)
    const data = hexToBytes(encryptedContent)
    const nonce = data.slice(0, 24)
    const ciphertext = data.slice(24)
    const cipher = xchacha20poly1305(recordKey, nonce, utf8ToBytes(LABEL_CALL_META))
    const plaintext = cipher.decrypt(ciphertext)
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    return null
  }
}

/**
 * Decrypt a transcription using the crypto worker.
 * The worker performs ECDH + domain-separated key derivation + XChaCha20-Poly1305 decrypt.
 */
export async function decryptTranscription(
  packed: string,
  ephemeralPubkeyHex: string
): Promise<string | null> {
  try {
    // TODO(tier-1 per-record-aad): transcription wire format seals with
    // empty inner AEAD AAD. Migrate to
    // `buildAad(LABEL_TRANSCRIPTION, callId, 'transcript')` alongside
    // POST_OVERHAUL_GAPS_2026-04-13.md Tier 1 P1 "Per-record AAD migration".
    const resultHex = await cryptoWorker.decrypt(
      ephemeralPubkeyHex,
      packed,
      LABEL_TRANSCRIPTION,
      new Uint8Array(0)
    )
    return new TextDecoder().decode(hexToBytes(resultHex))
  } catch {
    return null
  }
}
