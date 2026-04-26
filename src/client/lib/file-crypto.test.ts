import { describe, expect, test } from 'bun:test'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_FILE_KEY, LABEL_FILE_METADATA, labelToId } from '@shared/crypto-labels'
import { symmetricDecrypt } from '@shared/crypto-primitives'
import { createHpkeSuite } from '@shared/crypto-suite'
import type { Ciphertext } from '@shared/crypto-types'
import { hpkeOpen } from '@shared/hpke-primitives'
import type { Envelope } from '@shared/types'
import { asX25519EncryptionKey } from '@shared/types'
import { encryptFile } from './file-crypto'

// Generate test X25519 keypair
async function generateTestHpkeKeypair() {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  const publicKeyBytes = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))
  return { privateKey: kp.privateKey, publicKeyHex: bytesToHex(publicKeyBytes) }
}

/** Create a mock File from content bytes */
function mockFile(content: Uint8Array, name: string, type = 'application/octet-stream'): File {
  return new File([content as BlobPart], name, { type })
}

/**
 * Decrypt a file in tests (no crypto worker available).
 * Uses HPKE open directly with the test private key.
 */
async function decryptFileWithSecret(
  encryptedContent: Uint8Array,
  envelope: Envelope,
  fileId: string,
  privateKey: CryptoKey
): Promise<Uint8Array> {
  // Build the same AAD as encryption
  const labelBytes = new TextEncoder().encode(LABEL_FILE_KEY)
  const fileIdBytes = new TextEncoder().encode(fileId)
  const aad = new Uint8Array(labelBytes.length + 1 + fileIdBytes.length)
  aad.set(labelBytes, 0)
  aad[labelBytes.length] = labelToId(LABEL_FILE_KEY)
  aad.set(fileIdBytes, labelBytes.length + 1)

  // Verify version and labelId
  expect(envelope.v).toBe(3)
  if (envelope.labelId !== labelToId(LABEL_FILE_KEY)) {
    throw new Error(
      `Label mismatch: expected ${labelToId(LABEL_FILE_KEY)}, got ${envelope.labelId}`
    )
  }

  // Unwrap file key with HPKE open
  const fileKey = await hpkeOpen(
    envelope,
    asX25519EncryptionKey(privateKey),
    LABEL_FILE_KEY,
    new Uint8Array(0)
  )

  // symmetricDecrypt expects hex-encoded input (nonce+ciphertext)
  const encryptedHex = bytesToHex(encryptedContent) as Ciphertext
  return symmetricDecrypt(encryptedHex, fileKey, aad)
}

describe('encryptFile', () => {
  test('produces encrypted output with key envelope and metadata', async () => {
    const { publicKeyHex } = await generateTestHpkeKeypair()
    const content = new Uint8Array([1, 2, 3, 4, 5])
    const file = mockFile(content, 'test.txt', 'text/plain')
    const fileId = crypto.randomUUID()
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, fileId, recipients)

    expect(result.encryptedContent).toBeInstanceOf(Uint8Array)
    expect(result.encryptedContent.length).toBeGreaterThan(content.length)
    expect(result.recipientEnvelopes).toHaveLength(1)
    expect(result.recipientEnvelopes[0].pubkey).toBe(publicKeyHex)
    expect(result.recipientEnvelopes[0].v).toBe(3)
    expect(result.recipientEnvelopes[0].enc).toBeTruthy()
    expect(result.recipientEnvelopes[0].ct).toBeTruthy()
    expect(result.encryptedMetadata).toHaveLength(1)
    expect(result.encryptedMetadata[0].pubkey).toBe(publicKeyHex)
  })

  test('file key envelope can be unwrapped with recipient private key', async () => {
    const { privateKey, publicKeyHex } = await generateTestHpkeKeypair()
    const content = new Uint8Array([10, 20, 30])
    const file = mockFile(content, 'data.bin')
    const fileId = crypto.randomUUID()
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, fileId, recipients)
    const envelope = result.recipientEnvelopes[0]

    const fileKey = await hpkeOpen(
      envelope,
      asX25519EncryptionKey(privateKey),
      LABEL_FILE_KEY,
      new Uint8Array(0)
    )

    expect(fileKey).toBeInstanceOf(Uint8Array)
    expect(fileKey.length).toBe(32)

    // Decrypt file content with unwrapped key + correct AAD
    const decrypted = await decryptFileWithSecret(
      result.encryptedContent,
      envelope,
      fileId,
      privateKey
    )
    expect(decrypted).toEqual(content)
  })

  test('metadata envelope can be decrypted with recipient private key', async () => {
    const { privateKey, publicKeyHex } = await generateTestHpkeKeypair()
    const content = new Uint8Array([42])
    const filename = 'secret.pdf'
    const file = mockFile(content, filename, 'application/pdf')
    const fileId = crypto.randomUUID()
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, fileId, recipients)
    const metaEnvelope = result.encryptedMetadata[0]

    // HPKE open the metadata envelope directly
    const plaintext = await hpkeOpen(
      metaEnvelope,
      asX25519EncryptionKey(privateKey),
      LABEL_FILE_METADATA,
      new Uint8Array(0)
    )
    const parsed = JSON.parse(new TextDecoder().decode(plaintext))

    expect(parsed.originalName).toBe(filename)
    expect(parsed.mimeType).toBe('application/pdf')
    expect(parsed.size).toBe(1)
    expect(parsed.checksum).toBeTruthy()
  })

  test('multiple recipients each get their own envelopes', async () => {
    const kp1 = await generateTestHpkeKeypair()
    const kp2 = await generateTestHpkeKeypair()
    const recipients = [kp1.publicKeyHex, kp2.publicKeyHex]
    const content = new Uint8Array([99])
    const file = mockFile(content, 'multi.txt', 'text/plain')
    const fileId = crypto.randomUUID()

    const result = await encryptFile(file, fileId, recipients)

    expect(result.recipientEnvelopes).toHaveLength(2)
    expect(result.encryptedMetadata).toHaveLength(2)

    // Both recipients unwrap the same file key
    const key1Unwrapped = await hpkeOpen(
      result.recipientEnvelopes[0],
      asX25519EncryptionKey(kp1.privateKey),
      LABEL_FILE_KEY,
      new Uint8Array(0)
    )
    const key2Unwrapped = await hpkeOpen(
      result.recipientEnvelopes[1],
      asX25519EncryptionKey(kp2.privateKey),
      LABEL_FILE_KEY,
      new Uint8Array(0)
    )

    expect(key1Unwrapped).toEqual(key2Unwrapped)
  })
})

// --- Envelope + fileId-bound AAD tests ---

describe('file-crypto envelope', () => {
  test('encrypt file produces Envelope with correct v and labelId', async () => {
    const { publicKeyHex } = await generateTestHpkeKeypair()
    const content = new Uint8Array(1024)
    crypto.getRandomValues(content)
    const file = mockFile(content, 'random.bin')
    const fileId = crypto.randomUUID()

    const { recipientEnvelopes } = await encryptFile(file, fileId, [publicKeyHex])
    const envelope = recipientEnvelopes[0]

    expect(envelope.v).toBe(3)
    expect(envelope.labelId).toBe(labelToId(LABEL_FILE_KEY))
    expect(typeof envelope.enc).toBe('string')
    expect(typeof envelope.ct).toBe('string')
    expect(envelope.pubkey).toBe(publicKeyHex)
  })

  test('correct fileId decrypts successfully', async () => {
    const { privateKey, publicKeyHex } = await generateTestHpkeKeypair()
    const content = new Uint8Array([7, 8, 9, 10])
    const file = mockFile(content, 'aad-test.bin')
    const fileId = crypto.randomUUID()

    const { encryptedContent, recipientEnvelopes } = await encryptFile(file, fileId, [publicKeyHex])
    const decrypted = await decryptFileWithSecret(
      encryptedContent,
      recipientEnvelopes[0],
      fileId,
      privateKey
    )

    expect(decrypted).toEqual(content)
  })

  test('wrong fileId fails (AAD mismatch)', async () => {
    const { privateKey, publicKeyHex } = await generateTestHpkeKeypair()
    const content = new Uint8Array(1024)
    crypto.getRandomValues(content)
    const file = mockFile(content, 'aad-mismatch.bin')
    const fileId = crypto.randomUUID()

    const { encryptedContent, recipientEnvelopes } = await encryptFile(file, fileId, [publicKeyHex])

    // Use a different fileId — the AAD will not match, causing AEAD auth failure
    const wrongFileId = crypto.randomUUID()
    await expect(
      decryptFileWithSecret(encryptedContent, recipientEnvelopes[0], wrongFileId, privateKey)
    ).rejects.toBeInstanceOf(Error)
  })

  test('wrong fileId fails even with correct key (cross-file substitution attack)', async () => {
    const { privateKey, publicKeyHex } = await generateTestHpkeKeypair()
    // Encrypt two different files with different fileIds
    const file1 = mockFile(new Uint8Array([1, 2, 3]), 'file1.bin')
    const file2 = mockFile(new Uint8Array([4, 5, 6]), 'file2.bin')
    const fileId1 = crypto.randomUUID()
    const fileId2 = crypto.randomUUID()

    const result1 = await encryptFile(file1, fileId1, [publicKeyHex])
    const _result2 = await encryptFile(file2, fileId2, [publicKeyHex])

    // Try to decrypt file1's content using file2's fileId (cross-file substitution)
    await expect(
      decryptFileWithSecret(
        result1.encryptedContent,
        result1.recipientEnvelopes[0],
        fileId2,
        privateKey
      )
    ).rejects.toBeInstanceOf(Error)
  })

  test('envelope labelId check rejects wrong label', async () => {
    const { privateKey, publicKeyHex } = await generateTestHpkeKeypair()
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
      decryptFileWithSecret(encryptedContent, tamperedEnvelope, fileId, privateKey)
    ).rejects.toBeInstanceOf(Error)
  })
})

// decryptFile, decryptFileMetadata, and rewrapFileKey
// require the crypto Web Worker (unavailable in bun:test).
// Covered by API integration tests that run against a real server.
