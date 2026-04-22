import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  LABEL_FILE_KEY,
  LABEL_FILE_METADATA,
  labelToId,
} from '@shared/crypto-labels'
import { symmetricDecrypt, symmetricEncrypt } from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type {
  EncryptedFileMetadata,
  EncryptedMetaItem,
  Envelope,
  FileKeyEnvelope,
} from '@shared/types'
import { cryptoWorker } from './crypto-worker-client'

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

/**
 * Build the AAD for file content encryption.
 * Format: labelBytes || labelId (1 byte) || fileId bytes
 * This triple-redundant binding prevents cross-context and cross-file ciphertext reuse.
 */
function buildFileAad(fileId: string): Uint8Array {
  const labelBytes = utf8ToBytes(LABEL_FILE_KEY)
  const fileIdBytes = utf8ToBytes(fileId)
  const aad = new Uint8Array(labelBytes.length + 1 + fileIdBytes.length)
  aad.set(labelBytes, 0)
  aad[labelBytes.length] = labelToId(LABEL_FILE_KEY)
  aad.set(fileIdBytes, labelBytes.length + 1)
  return aad
}

/**
 * Encrypt a file's metadata for a recipient using HPKE direct seal.
 */
async function encryptMetadataForPubkey(
  metadata: EncryptedFileMetadata,
  recipientPubkeyHex: string
): Promise<EncryptedMetaItem> {
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
  const { hpkeSeal } = await import('@shared/hpke-primitives')
  const suite = createHpkeSuite()

  const recipientKey = asX25519(
    (await suite.kem.deserializePublicKey(hexToBytes(recipientPubkeyHex))) as CryptoKey
  )
  const plaintext = new TextEncoder().encode(JSON.stringify(metadata))
  const envelope = await hpkeSeal(plaintext, recipientKey, LABEL_FILE_METADATA, new Uint8Array(0))

  return {
    pubkey: recipientPubkeyHex,
    ...envelope,
  }
}

/**
 * Decrypt file metadata using the recipient's HPKE private key (via crypto worker).
 */
export async function decryptFileMetadata(
  envelope: Envelope
): Promise<EncryptedFileMetadata | null> {
  try {
    const worker = cryptoWorker
    const resultHex = await worker.hpkeOpenRawAad(envelope, LABEL_FILE_METADATA, new Uint8Array(0))
    const plaintext = hexToBytes(resultHex)
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    return null
  }
}

interface EncryptedFileUpload {
  /** Raw bytes of the encrypted content (nonce+ciphertext from symmetricEncrypt, decoded from hex). */
  encryptedContent: Uint8Array
  /** Per-recipient key envelopes with pubkey tag. */
  recipientEnvelopes: FileKeyEnvelope[]
  encryptedMetadata: EncryptedMetaItem[]
}

/**
 * Encrypt a file for multiple recipients (HPKE key-wrap + fileId-bound AAD).
 *
 * The file content is encrypted with XChaCha20-Poly1305 using an AAD that binds
 * the ciphertext to both LABEL_FILE_KEY and the fileId, preventing cross-file
 * ciphertext substitution attacks. Each recipient gets an HPKE envelope wrapping
 * the same file key.
 *
 * The fileId must be a client-generated UUID (crypto.randomUUID()) on new uploads
 * and the server-provided file identifier on re-encryption / re-sharing.
 */
export async function encryptFile(
  file: File,
  fileId: string,
  recipientPubkeys: string[]
): Promise<EncryptedFileUpload> {
  const plaintextBytes = new Uint8Array(await file.arrayBuffer())

  // Compute checksum of the plaintext for integrity verification on decrypt
  const hashBuffer = await crypto.subtle.digest('SHA-256', plaintextBytes)
  const checksum = bytesToHex(new Uint8Array(hashBuffer))

  const metadata: EncryptedFileMetadata = {
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    checksum,
  }

  // Generate a random per-file symmetric key
  const fileKey = randomBytes(32)

  // Build AAD: labelBytes || labelId byte || fileId bytes
  const aad = buildFileAad(fileId)

  // Encrypt file content with mandatory AAD binding
  // symmetricEncrypt returns hex — decode to bytes for the upload API
  const encryptedHex = symmetricEncrypt(plaintextBytes, fileKey, aad)
  const encryptedContent = hexToBytes(encryptedHex)

  // Wrap the file key for each recipient using HPKE seal
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
  const { hpkeSeal } = await import('@shared/hpke-primitives')
  const suite = createHpkeSuite()

  const recipientEnvelopes: FileKeyEnvelope[] = await Promise.all(
    recipientPubkeys.map(async (pubkey) => {
      const recipientKey = asX25519(
        (await suite.kem.deserializePublicKey(hexToBytes(pubkey))) as CryptoKey
      )
      const envelope = await hpkeSeal(fileKey, recipientKey, LABEL_FILE_KEY, new Uint8Array(0))
      return { pubkey, ...envelope }
    })
  )

  // Zero the file key immediately after use
  fileKey.fill(0)

  // Encrypt metadata for each recipient
  const encryptedMetadata = await Promise.all(
    recipientPubkeys.map((pubkey) => encryptMetadataForPubkey(metadata, pubkey))
  )

  return { encryptedContent, recipientEnvelopes, encryptedMetadata }
}

/**
 * Decrypt a file given the encrypted content, a key envelope, and the fileId.
 *
 * The fileId is required to reconstruct the AAD that was used during encryption —
 * passing the wrong fileId causes an AEAD authentication failure (throws).
 * Secret key operations are delegated to the crypto worker.
 */
export async function decryptFile(
  encryptedContent: ArrayBuffer,
  envelope: Envelope,
  fileId: string
): Promise<{ blob: Blob; checksum: string }> {
  // Build the same AAD used during encryption
  const aad = buildFileAad(fileId)

  // Unwrap the file key via the crypto worker using HPKE open with raw AAD.
  const fileKey = await cryptoWorker
    .hpkeOpenRawAad(envelope, LABEL_FILE_KEY, new Uint8Array(0))
    .then(hexToBytes)

  // Convert raw bytes to hex for symmetricDecrypt (which expects hex-encoded input)
  const encryptedHex = bytesToHex(new Uint8Array(encryptedContent)) as Ciphertext
  const plaintext = symmetricDecrypt(encryptedHex, fileKey, aad)

  // Compute checksum for integrity verification
  const hashBuffer = await crypto.subtle.digest('SHA-256', plaintext.buffer as ArrayBuffer)
  const checksum = bytesToHex(new Uint8Array(hashBuffer))

  return {
    blob: new Blob([plaintext.buffer as ArrayBuffer]),
    checksum,
  }
}

/**
 * Re-wrap a file's symmetric key for a new recipient.
 * Admin decrypts the key via worker, then re-encrypts for the new pubkey.
 *
 * @knipignore — file key re-wrapping scaffolding for future file sharing / access transfer UI
 */
export async function rewrapFileKey(
  envelope: Envelope,
  newRecipientPubkeyHex: string
): Promise<FileKeyEnvelope> {
  // Unwrap file key via worker HPKE open with raw AAD
  const fileKey = await cryptoWorker
    .hpkeOpenRawAad(envelope, LABEL_FILE_KEY, new Uint8Array(0))
    .then(hexToBytes)

  // Re-seal for new recipient
  const { createHpkeSuite } = await import('@shared/crypto-suite')
  const { asX25519EncryptionKey: asX25519 } = await import('@shared/types')
  const { hpkeSeal } = await import('@shared/hpke-primitives')
  const suite = createHpkeSuite()
  const recipientKey = asX25519(
    (await suite.kem.deserializePublicKey(hexToBytes(newRecipientPubkeyHex))) as CryptoKey
  )
  const newEnvelope = await hpkeSeal(fileKey, recipientKey, LABEL_FILE_KEY, new Uint8Array(0))
  fileKey.fill(0)

  return {
    pubkey: newRecipientPubkeyHex,
    ...newEnvelope,
  }
}
