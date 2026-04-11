import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_FILE_KEY, LABEL_FILE_METADATA } from '@shared/crypto-labels'
import { eciesWrapKey } from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type { EncryptedFileMetadata, EncryptedMetaItem, FileKeyEnvelope } from '@shared/types'
import { cryptoWorker } from './crypto-worker-client'
import { eciesUnwrapKey } from './crypto-worker-helpers'

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

/**
 * Unwrap a symmetric file key using the crypto worker (secret key never touches main thread).
 */
export async function unwrapFileKey(
  encryptedFileKeyHex: string,
  ephemeralPubkeyHex: string
): Promise<Uint8Array> {
  return eciesUnwrapKey(
    { wrappedKey: encryptedFileKeyHex as Ciphertext, ephemeralPubkey: ephemeralPubkeyHex },
    LABEL_FILE_KEY
  )
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
    // Delegate ECDH to the crypto worker — secret key never touches main thread
    const worker = cryptoWorker
    const resultHex = await worker.decrypt(
      ephemeralPubkeyHex,
      encryptedContentHex,
      LABEL_FILE_METADATA
    )
    const plaintext = hexToBytes(resultHex)
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    return null
  }
}

export interface EncryptedFileUpload {
  encryptedContent: Uint8Array
  recipientEnvelopes: FileKeyEnvelope[]
  encryptedMetadata: EncryptedMetaItem[]
}

/**
 * Encrypt a file for multiple recipients.
 * Uses a single random symmetric key to encrypt the file content once,
 * then wraps that key for each recipient using ECIES.
 */
export async function encryptFile(
  file: File,
  recipientPubkeys: string[]
): Promise<EncryptedFileUpload> {
  const plaintextBytes = new Uint8Array(await file.arrayBuffer())

  // Compute checksum
  const hashBuffer = await crypto.subtle.digest('SHA-256', plaintextBytes)
  const checksum = bytesToHex(new Uint8Array(hashBuffer))

  const metadata: EncryptedFileMetadata = {
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    checksum,
  }

  // Generate random symmetric key for file content
  const fileKey = randomBytes(32)
  const fileNonce = randomBytes(24)
  const cipher = xchacha20poly1305(fileKey, fileNonce)
  const encryptedContent = cipher.encrypt(plaintextBytes)

  // Pack: nonce (24) + ciphertext
  const packed = new Uint8Array(fileNonce.length + encryptedContent.length)
  packed.set(fileNonce)
  packed.set(encryptedContent, fileNonce.length)

  // Wrap the file key for each recipient using shared ECIES
  const recipientEnvelopes: FileKeyEnvelope[] = recipientPubkeys.map((pubkey) => {
    const { wrappedKey, ephemeralPubkey } = eciesWrapKey(fileKey, pubkey, LABEL_FILE_KEY)
    return { pubkey, encryptedFileKey: wrappedKey, ephemeralPubkey }
  })

  // Encrypt metadata for each recipient
  const encryptedMetadataList = recipientPubkeys.map((pubkey) =>
    encryptMetadataForPubkey(metadata, pubkey)
  )

  return {
    encryptedContent: packed,
    recipientEnvelopes,
    encryptedMetadata: encryptedMetadataList,
  }
}

/**
 * Decrypt a file given the encrypted content and key envelope.
 * Secret key operations are delegated to the crypto worker.
 */
export async function decryptFile(
  encryptedContent: ArrayBuffer,
  envelope: FileKeyEnvelope
): Promise<{ blob: Blob; checksum: string }> {
  // Unwrap the file key via worker
  const fileKey = await unwrapFileKey(envelope.encryptedFileKey, envelope.ephemeralPubkey)

  // Extract nonce and decrypt
  const data = new Uint8Array(encryptedContent)
  const nonce = data.slice(0, 24)
  const ciphertext = data.slice(24)
  const cipher = xchacha20poly1305(fileKey, nonce)
  const plaintext = cipher.decrypt(ciphertext)

  // Compute checksum for verification
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
 */
export async function rewrapFileKey(
  encryptedFileKeyHex: string,
  ephemeralPubkeyHex: string,
  newRecipientPubkeyHex: string
): Promise<FileKeyEnvelope> {
  // Decrypt with admin key via worker
  const fileKey = await unwrapFileKey(encryptedFileKeyHex, ephemeralPubkeyHex)

  // Re-encrypt for new recipient
  const { wrappedKey: encryptedFileKey, ephemeralPubkey } = eciesWrapKey(
    fileKey,
    newRecipientPubkeyHex,
    LABEL_FILE_KEY
  )

  return {
    pubkey: newRecipientPubkeyHex,
    encryptedFileKey,
    ephemeralPubkey,
  }
}
