/**
 * Async crypto helpers that delegate secret-key operations to the crypto worker.
 * The secret key never touches the main thread — all HPKE operations are
 * performed inside the worker.
 *
 * These functions require a browser context (Web Worker + cryptoWorker singleton).
 * For pure/server-side usage, see @shared/hpke-primitives.
 *
 * Slice 2: Migrated from ECIES (eciesUnwrapKey + XChaCha20 symmetric decrypt)
 * to HPKE single-shot open. Each helper now takes an HpkeEnvelope directly —
 * the per-recipient envelope IS the ciphertext (no separate encryptedContent
 * blob + key-wrapped symmetric key).
 */

import type { CryptoLabel } from '@shared/crypto-labels'
import { LABEL_BLAST_CONTENT, LABEL_CALL_META, LABEL_TRANSCRIPTION } from '@shared/crypto-labels'
import type { HpkeEnvelope } from '@shared/hpke-envelope'
import type { BlastContent, NotePayload } from '@shared/types'
import { cryptoWorker } from './crypto-worker-client'

/**
 * HPKE open a per-recipient envelope via the crypto worker.
 * The worker holds the non-extractable HPKE private key — secret key
 * never touches the main thread.
 *
 * @param envelope      The HpkeEnvelope for the current user.
 * @param label         The domain-separation CryptoLabel.
 * @param recordId      Record ID used in AAD binding.
 * @param fieldName     Field name used in AAD binding.
 * @returns Decrypted plaintext string.
 */
export async function hpkeOpenField(
  envelope: HpkeEnvelope,
  label: CryptoLabel,
  recordId: string,
  fieldName: string
): Promise<string> {
  return cryptoWorker.hpkeOpen(envelope, label, recordId, fieldName)
}

/**
 * Decrypt blast content from an HPKE envelope.
 * Returns parsed BlastContent or null on failure.
 *
 * @param envelope  The current user's HPKE envelope from the blast's contentEnvelopes.
 * @param blastId   Blast record ID for AAD binding.
 */
export async function decryptBlastContent(
  envelope: HpkeEnvelope,
  blastId: string
): Promise<BlastContent | null> {
  try {
    const plaintext = await cryptoWorker.hpkeOpen(envelope, LABEL_BLAST_CONTENT, blastId, 'content')
    return JSON.parse(plaintext) as BlastContent
  } catch {
    return null
  }
}

/**
 * Decrypt a call record's encrypted metadata from an HPKE envelope.
 * Returns the decrypted fields or null if decryption fails.
 *
 * @param envelope  The current user's HPKE envelope from the call's adminEnvelopes.
 * @param callId    Call record ID for AAD binding.
 */
export async function decryptCallRecord(
  envelope: HpkeEnvelope,
  callId: string
): Promise<{ answeredBy: string | null; callerNumber: string } | null> {
  try {
    const plaintext = await cryptoWorker.hpkeOpen(envelope, LABEL_CALL_META, callId, 'call-meta')
    return JSON.parse(plaintext)
  } catch {
    return null
  }
}

/**
 * Decrypt a transcription from an HPKE envelope.
 *
 * @param envelope  The current user's HPKE envelope for the transcription.
 * @param noteId    Note/call record ID for AAD binding.
 */
export async function decryptTranscription(
  envelope: HpkeEnvelope,
  noteId: string
): Promise<string | null> {
  try {
    return await cryptoWorker.hpkeOpen(envelope, LABEL_TRANSCRIPTION, noteId, 'transcript')
  } catch {
    return null
  }
}
