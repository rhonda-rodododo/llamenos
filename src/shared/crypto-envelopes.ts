/**
 * Higher-level envelope encryption helpers for blasts, drafts, and exports.
 *
 * Note and message envelope encryption has been removed — both now use MLS.
 * Blast content uses HPKE per-recipient seal.
 * Drafts and exports use AES-256-GCM with HKDF-derived keys.
 */

import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm'
import {
  HKDF_CONTEXT_DRAFTS,
  HKDF_CONTEXT_EXPORT,
  HKDF_SALT,
  LABEL_BLAST_CONTENT,
} from './crypto-labels'
import { hkdfDerive } from './crypto-primitives'
import type { Ciphertext } from './crypto-types'
import type { BlastContent, RecipientEnvelope } from './types'

// --- Blast Content Encryption (HPKE) ---

export interface EncryptedBlastContentPayload {
  encryptedContent: Ciphertext
  contentEnvelopes: RecipientEnvelope[]
}

/**
 * Encrypt blast content for multiple recipients using HPKE single-shot seal.
 * Each recipient gets their own HPKE envelope — no shared symmetric key.
 */
export async function encryptBlastContent(
  content: BlastContent,
  recipientPubkeyHexes: string[]
): Promise<EncryptedBlastContentPayload> {
  const { createHpkeSuite } = await import('./crypto-suite')
  const { asX25519EncryptionKey } = await import('./types')
  const { hpkeSeal, buildAad } = await import('./hpke-primitives')
  const suite = createHpkeSuite()

  const plaintext = new TextEncoder().encode(JSON.stringify(content))
  // Use empty string as recordId — blast id isn't known at encrypt time
  const aad = buildAad(LABEL_BLAST_CONTENT, '', 'content')

  const contentEnvelopes: RecipientEnvelope[] = await Promise.all(
    recipientPubkeyHexes.map(async (pubkey) => {
      const recipientKey = asX25519EncryptionKey(
        (await suite.kem.deserializePublicKey(hexToBytes(pubkey))) as CryptoKey
      )
      const envelope = await hpkeSeal(plaintext, recipientKey, LABEL_BLAST_CONTENT, aad)
      return { pubkey, ...envelope }
    })
  )

  return {
    encryptedContent: '' as Ciphertext,
    contentEnvelopes,
  }
}

/**
 * Decrypt blast content from a recipient's HPKE envelope.
 * Uses the recipient's X25519 private key (via the crypto suite).
 */
export async function decryptBlastContentWithKey(
  _encryptedContent: string,
  contentEnvelopes: RecipientEnvelope[],
  secretKey: Uint8Array,
  readerPubkey: string
): Promise<BlastContent | null> {
  try {
    const envelope = contentEnvelopes.find((e) => e.pubkey === readerPubkey)
    if (!envelope) return null

    const { createHpkeSuite } = await import('./crypto-suite')
    const { asX25519EncryptionKey } = await import('./types')
    const { hpkeOpen, buildAad } = await import('./hpke-primitives')
    const { LABEL_USER_HPKE_KEY, LABEL_USER_HPKE_KEY_INFO } = await import('./crypto-labels')

    // Derive X25519 HPKE private key from nsec
    const enc = new TextEncoder()
    const ikm = hkdfDerive(
      secretKey,
      enc.encode(LABEL_USER_HPKE_KEY),
      enc.encode(LABEL_USER_HPKE_KEY_INFO),
      32
    )
    const suite = createHpkeSuite()
    const kp = (await suite.kem.deriveKeyPair(ikm)) as CryptoKeyPair
    const hpkePrivateKey = asX25519EncryptionKey(kp.privateKey)
    ikm.fill(0)

    const aad = buildAad(LABEL_BLAST_CONTENT, '', 'content')
    const pt = await hpkeOpen(envelope, hpkePrivateKey, LABEL_BLAST_CONTENT, aad)
    return JSON.parse(new TextDecoder().decode(pt)) as BlastContent
  } catch {
    return null
  }
}

// --- Draft Encryption (AES-256-GCM) ---

export async function encryptDraft(plaintext: string, secretKey: Uint8Array): Promise<string> {
  const key = hkdfDerive(secretKey, utf8ToBytes(HKDF_SALT), utf8ToBytes(HKDF_CONTEXT_DRAFTS), 32)
  return aesGcmEncrypt(utf8ToBytes(plaintext), key, new Uint8Array(0))
}

export async function decryptDraft(packed: string, secretKey: Uint8Array): Promise<string | null> {
  try {
    const key = hkdfDerive(secretKey, utf8ToBytes(HKDF_SALT), utf8ToBytes(HKDF_CONTEXT_DRAFTS), 32)
    const plaintext = await aesGcmDecrypt(packed, key, new Uint8Array(0))
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

// --- Export Encryption (AES-256-GCM) ---

export async function encryptExport(
  jsonString: string,
  secretKey: Uint8Array
): Promise<Uint8Array> {
  const key = hkdfDerive(secretKey, utf8ToBytes(HKDF_SALT), utf8ToBytes(HKDF_CONTEXT_EXPORT), 32)
  const packed = await aesGcmEncrypt(utf8ToBytes(jsonString), key, new Uint8Array(0))
  return hexToBytes(packed)
}
