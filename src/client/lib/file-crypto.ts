import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  type CryptoLabel,
  LABEL_FILE_KEY,
  LABEL_FILE_METADATA,
  labelToId,
} from '@shared/crypto-labels'
import {
  decryptEnvelope,
  eciesWrapKey,
  symmetricDecrypt,
  symmetricEncrypt,
} from '@shared/crypto-primitives'
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
 * Encrypt a file's metadata for a recipient (ECIES with LABEL_FILE_METADATA domain separation).
 * Unlike key wrapping, this encrypts arbitrary-length data, so it uses raw ECDH+XChaCha20.
 */
function encryptMetadataForPubkey(
  metadata: EncryptedFileMetadata,
  recipientPubkeyHex: string
): EncryptedMetaItem {
  const ephemeralSecret = randomBytes(32)
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralSecret, true)

  const recipientCompressed = hexToBytes(`02${recipientPubkeyHex}`)
  const shared = secp256k1.getSharedSecret(ephemeralSecret, recipientCompressed)
  const sharedX = shared.slice(1, 33)

  const label = utf8ToBytes(LABEL_FILE_METADATA)
  const keyInput = new Uint8Array(label.length + sharedX.length)
  keyInput.set(label)
  keyInput.set(sharedX, label.length)
  const symmetricKey = sha256(keyInput)

  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  const plaintext = utf8ToBytes(JSON.stringify(metadata))
  const ciphertext = cipher.encrypt(plaintext)

  const packed = new Uint8Array(nonce.length + ciphertext.length)
  packed.set(nonce)
  packed.set(ciphertext, nonce.length)

  return {
    pubkey: recipientPubkeyHex,
    // @ts-expect-error Slice 5: file crypto ECIES → HPKE migration
    encryptedContent: bytesToHex(packed) as Ciphertext,
    ephemeralPubkey: bytesToHex(ephemeralPublicKey),
  }
}

/**
 * Decrypt file metadata using the recipient's secret key (via crypto worker ECDH).
 */
export async function decryptFileMetadata(
  encryptedContentHex: string,
  ephemeralPubkeyHex: string
): Promise<EncryptedFileMetadata | null> {
  try {
    const worker = cryptoWorker
    // TODO(tier-1 per-record-aad): File metadata envelopes were sealed by
    // `encryptMetadataForPubkey` with empty inner AAD (legacy wire format).
    // Migrate to `buildAad(LABEL_FILE_METADATA, fileId, 'metadata')` alongside
    // POST_OVERHAUL_GAPS_2026-04-13.md Tier 1 P1 "Per-record AAD migration".
    const resultHex = await worker.decrypt(
      ephemeralPubkeyHex,
      encryptedContentHex,
      LABEL_FILE_METADATA,
      new Uint8Array(0)
    )
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
 * Encrypt a file for multiple recipients (Envelope + fileId-bound AAD).
 *
 * The file content is encrypted with XChaCha20-Poly1305 using an AAD that binds
 * the ciphertext to both LABEL_FILE_KEY and the fileId, preventing cross-file
 * ciphertext substitution attacks. Each recipient gets an Envelope wrapping
 * the same file key via ECIES.
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

  // Wrap the file key for each recipient using Envelope (ECIES + wire-format label)
  const labelId = labelToId(LABEL_FILE_KEY)
  // @ts-expect-error Slice 5: file crypto ECIES → HPKE migration
  const recipientEnvelopes: FileKeyEnvelope[] = recipientPubkeys.map((pubkey) => {
    const { wrappedKey, ephemeralPubkey } = eciesWrapKey(fileKey, pubkey, LABEL_FILE_KEY)
    return { v: 2, labelId, pubkey, wrappedKey, ephemeralPubkey }
  })

  // Zero the file key immediately after use
  fileKey.fill(0)

  // Encrypt metadata for each recipient
  const encryptedMetadata = recipientPubkeys.map((pubkey) =>
    encryptMetadataForPubkey(metadata, pubkey)
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

  // Unwrap the file key via the crypto worker using decryptEnvelope (version + label checks).
  // TODO(tier-1 per-record-aad): The ECIES key-wrap on-disk was sealed with
  // empty inner AAD via `eciesWrapKey` in crypto-primitives. Migrate both
  // sides to `buildAad(LABEL_FILE_KEY, fileId, 'file-key')` alongside
  // POST_OVERHAUL_GAPS_2026-04-13.md Tier 1 P1 "Per-record AAD migration".
  const fileKey = await decryptEnvelope(
    envelope,
    (ephemeralPubkey, wrappedKey, label) =>
      cryptoWorker
        .decrypt(ephemeralPubkey, wrappedKey, label as CryptoLabel, new Uint8Array(0))
        .then(hexToBytes),
    LABEL_FILE_KEY
  )

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
  // Unwrap with version + label check via the crypto worker.
  // TODO(tier-1 per-record-aad): see note in decryptFile above.
  const fileKey = await decryptEnvelope(
    envelope,
    (ephemeralPubkey, wrappedKey, label) =>
      cryptoWorker
        .decrypt(ephemeralPubkey, wrappedKey, label as CryptoLabel, new Uint8Array(0))
        .then(hexToBytes),
    LABEL_FILE_KEY
  )

  // Re-encrypt for new recipient
  const { wrappedKey, ephemeralPubkey } = eciesWrapKey(
    fileKey,
    newRecipientPubkeyHex,
    LABEL_FILE_KEY
  )
  fileKey.fill(0)

  return {
    // @ts-expect-error Slice 5: file crypto ECIES → HPKE migration
    v: 2,
    labelId: labelToId(LABEL_FILE_KEY),
    pubkey: newRecipientPubkeyHex,
    wrappedKey,
    ephemeralPubkey,
  }
}
