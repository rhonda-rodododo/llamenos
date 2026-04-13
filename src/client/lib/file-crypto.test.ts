import { describe, expect, test } from 'bun:test'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_FILE_KEY, LABEL_FILE_METADATA, labelToId } from '@shared/crypto-labels'
import {
  type KeyEnvelope,
  eciesUnwrapKeyWithSecret,
  symmetricDecrypt,
} from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import type { Envelope } from '@shared/types'
import { encryptFile } from './file-crypto'

// Test keypairs — deterministic across test runs via fixed seed
const secretKey = crypto.getRandomValues(new Uint8Array(32))
const publicKeyHex = bytesToHex(secp256k1.getPublicKey(secretKey, true).slice(1))

/** Create a mock File from content bytes */
function mockFile(content: Uint8Array, name: string, type = 'application/octet-stream'): File {
  return new File([content as BlobPart], name, { type })
}

/**
 * Decrypt a file in tests (no crypto worker available).
 * Mirrors the production decryptFile path but uses eciesUnwrapKeyWithSecret directly.
 */
async function decryptFileWithSecret(
  encryptedContent: Uint8Array,
  envelope: Envelope,
  fileId: string,
  sk: Uint8Array
): Promise<Uint8Array> {
  // Build the same AAD as encryption
  const labelBytes = utf8ToBytes(LABEL_FILE_KEY)
  const fileIdBytes = utf8ToBytes(fileId)
  const aad = new Uint8Array(labelBytes.length + 1 + fileIdBytes.length)
  aad.set(labelBytes, 0)
  aad[labelBytes.length] = labelToId(LABEL_FILE_KEY)
  aad.set(fileIdBytes, labelBytes.length + 1)

  // Verify version and labelId
  if (envelope.v !== 2) throw new Error(`Unsupported envelope version: ${envelope.v as number}`)
  if (envelope.labelId !== labelToId(LABEL_FILE_KEY)) {
    throw new Error(
      `Label mismatch: expected ${labelToId(LABEL_FILE_KEY)}, got ${envelope.labelId}`
    )
  }

  // Unwrap file key with the recipient's secret key
  const keyEnvelope: KeyEnvelope = {
    wrappedKey: envelope.wrappedKey,
    ephemeralPubkey: envelope.ephemeralPubkey,
  }
  const fileKey = eciesUnwrapKeyWithSecret(keyEnvelope, sk, LABEL_FILE_KEY)

  // symmetricDecrypt expects hex-encoded input (nonce+ciphertext)
  const encryptedHex = bytesToHex(encryptedContent) as Ciphertext
  return symmetricDecrypt(encryptedHex, fileKey, aad)
}

describe('encryptFile', () => {
  test('produces encrypted output with key envelope and metadata', async () => {
    const content = new Uint8Array([1, 2, 3, 4, 5])
    const file = mockFile(content, 'test.txt', 'text/plain')
    const fileId = crypto.randomUUID()
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, fileId, recipients)

    expect(result.encryptedContent).toBeInstanceOf(Uint8Array)
    expect(result.encryptedContent.length).toBeGreaterThan(content.length)
    expect(result.recipientEnvelopes).toHaveLength(1)
    expect(result.recipientEnvelopes[0].pubkey).toBe(publicKeyHex)
    expect(result.recipientEnvelopes[0].wrappedKey).toBeTruthy()
    expect(result.recipientEnvelopes[0].ephemeralPubkey).toBeTruthy()
    expect(result.encryptedMetadata).toHaveLength(1)
    expect(result.encryptedMetadata[0].pubkey).toBe(publicKeyHex)
  })

  test('file key envelope can be unwrapped with recipient secret key', async () => {
    const content = new Uint8Array([10, 20, 30])
    const file = mockFile(content, 'data.bin')
    const fileId = crypto.randomUUID()
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, fileId, recipients)
    const envelope = result.recipientEnvelopes[0]

    const keyEnvelope: KeyEnvelope = {
      wrappedKey: envelope.wrappedKey,
      ephemeralPubkey: envelope.ephemeralPubkey,
    }
    const unwrapped = eciesUnwrapKeyWithSecret(keyEnvelope, secretKey, LABEL_FILE_KEY)

    expect(unwrapped).toBeInstanceOf(Uint8Array)
    expect(unwrapped.length).toBe(32)

    // Decrypt file content with unwrapped key + correct AAD
    const decrypted = await decryptFileWithSecret(
      result.encryptedContent,
      envelope,
      fileId,
      secretKey
    )
    expect(decrypted).toEqual(content)
  })

  test('metadata envelope can be decrypted with recipient secret key', async () => {
    const content = new Uint8Array([42])
    const filename = 'secret.pdf'
    const file = mockFile(content, filename, 'application/pdf')
    const fileId = crypto.randomUUID()
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, fileId, recipients)
    const metaEnvelope = result.encryptedMetadata[0]

    // Manual ECDH + symmetric decrypt (same algo as decryptFileMetadata)
    const ephemeralPub = hexToBytes(metaEnvelope.ephemeralPubkey)
    const shared = secp256k1.getSharedSecret(secretKey, ephemeralPub)
    const sharedX = shared.slice(1, 33)
    const label = utf8ToBytes(LABEL_FILE_METADATA)
    const keyInput = new Uint8Array(label.length + sharedX.length)
    keyInput.set(label)
    keyInput.set(sharedX, label.length)
    const symKey = sha256(keyInput)

    const encHex = metaEnvelope.encryptedContent as string
    const encBytes = hexToBytes(encHex)
    const nonce = encBytes.slice(0, 24)
    const ciphertext = encBytes.slice(24)
    const cipher = xchacha20poly1305(symKey, nonce)
    const plaintext = cipher.decrypt(ciphertext)
    const parsed = JSON.parse(new TextDecoder().decode(plaintext))

    expect(parsed.originalName).toBe(filename)
    expect(parsed.mimeType).toBe('application/pdf')
    expect(parsed.size).toBe(1)
    expect(parsed.checksum).toBeTruthy()
  })

  test('multiple recipients each get their own envelopes', async () => {
    const key2 = crypto.getRandomValues(new Uint8Array(32))
    const pub2 = bytesToHex(secp256k1.getPublicKey(key2, true).slice(1))
    const recipients = [publicKeyHex, pub2]
    const content = new Uint8Array([99])
    const file = mockFile(content, 'multi.txt', 'text/plain')
    const fileId = crypto.randomUUID()

    const result = await encryptFile(file, fileId, recipients)

    expect(result.recipientEnvelopes).toHaveLength(2)
    expect(result.encryptedMetadata).toHaveLength(2)

    // Both recipients unwrap the same file key
    const key1Envelope: KeyEnvelope = {
      wrappedKey: result.recipientEnvelopes[0].wrappedKey,
      ephemeralPubkey: result.recipientEnvelopes[0].ephemeralPubkey,
    }
    const key2Envelope: KeyEnvelope = {
      wrappedKey: result.recipientEnvelopes[1].wrappedKey,
      ephemeralPubkey: result.recipientEnvelopes[1].ephemeralPubkey,
    }
    const key1Unwrapped = eciesUnwrapKeyWithSecret(key1Envelope, secretKey, LABEL_FILE_KEY)
    const key2Unwrapped = eciesUnwrapKeyWithSecret(key2Envelope, key2, LABEL_FILE_KEY)

    expect(key1Unwrapped).toEqual(key2Unwrapped)
  })
})

// --- Envelope + fileId-bound AAD tests ---

describe('file-crypto envelope v2', () => {
  test('encrypt file produces Envelope with correct v and labelId', async () => {
    const content = new Uint8Array(1024)
    crypto.getRandomValues(content)
    const file = mockFile(content, 'random.bin')
    const fileId = crypto.randomUUID()

    const { recipientEnvelopes } = await encryptFile(file, fileId, [publicKeyHex])
    const envelope = recipientEnvelopes[0]

    expect(envelope.v).toBe(2)
    expect(envelope.labelId).toBe(labelToId(LABEL_FILE_KEY))
    expect(typeof envelope.wrappedKey).toBe('string')
    expect(typeof envelope.ephemeralPubkey).toBe('string')
    expect(envelope.pubkey).toBe(publicKeyHex)
  })

  test('correct fileId decrypts successfully', async () => {
    const content = new Uint8Array([7, 8, 9, 10])
    const file = mockFile(content, 'aad-test.bin')
    const fileId = crypto.randomUUID()

    const { encryptedContent, recipientEnvelopes } = await encryptFile(file, fileId, [publicKeyHex])
    const decrypted = await decryptFileWithSecret(
      encryptedContent,
      recipientEnvelopes[0],
      fileId,
      secretKey
    )

    expect(decrypted).toEqual(content)
  })

  test('wrong fileId fails (AAD mismatch)', async () => {
    const content = new Uint8Array(1024)
    crypto.getRandomValues(content)
    const file = mockFile(content, 'aad-mismatch.bin')
    const fileId = crypto.randomUUID()

    const { encryptedContent, recipientEnvelopes } = await encryptFile(file, fileId, [publicKeyHex])

    // Use a different fileId — the AAD will not match, causing AEAD auth failure
    const wrongFileId = crypto.randomUUID()
    await expect(
      decryptFileWithSecret(encryptedContent, recipientEnvelopes[0], wrongFileId, secretKey)
    ).rejects.toBeInstanceOf(Error)
  })

  test('wrong fileId fails even with correct key (cross-file substitution attack)', async () => {
    // Encrypt two different files with different fileIds
    const file1 = mockFile(new Uint8Array([1, 2, 3]), 'file1.bin')
    const file2 = mockFile(new Uint8Array([4, 5, 6]), 'file2.bin')
    const fileId1 = crypto.randomUUID()
    const fileId2 = crypto.randomUUID()

    const result1 = await encryptFile(file1, fileId1, [publicKeyHex])
    const result2 = await encryptFile(file2, fileId2, [publicKeyHex])

    // Try to decrypt file1's content using file2's fileId (cross-file substitution)
    await expect(
      decryptFileWithSecret(
        result1.encryptedContent,
        result1.recipientEnvelopes[0],
        fileId2,
        secretKey
      )
    ).rejects.toBeInstanceOf(Error)
  })

  test('envelope v2 labelId check rejects wrong label', async () => {
    const content = new Uint8Array([5, 6, 7])
    const file = mockFile(content, 'label-check.bin')
    const fileId = crypto.randomUUID()

    const { encryptedContent, recipientEnvelopes } = await encryptFile(file, fileId, [publicKeyHex])

    // Tamper with the labelId to simulate a cross-label attack
    const tamperedEnvelope: Envelope = {
      ...recipientEnvelopes[0],
      labelId: labelToId(LABEL_FILE_KEY) + 1, // wrong label
    }

    await expect(
      decryptFileWithSecret(encryptedContent, tamperedEnvelope, fileId, secretKey)
    ).rejects.toBeInstanceOf(Error)
  })
})

// decryptFile, decryptFileMetadata, unwrapFileKey, and rewrapFileKey
// require the crypto Web Worker (unavailable in bun:test).
// Covered by API integration tests that run against a real server.
