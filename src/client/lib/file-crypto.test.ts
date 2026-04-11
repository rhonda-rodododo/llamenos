import { describe, expect, test } from 'bun:test'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_FILE_KEY, LABEL_FILE_METADATA } from '@shared/crypto-labels'
import { type KeyEnvelope, eciesUnwrapKeyWithSecret } from '@shared/crypto-primitives'
import type { Ciphertext } from '@shared/crypto-types'
import { encryptFile } from './file-crypto'

// Test keypairs
const secretKey = crypto.getRandomValues(new Uint8Array(32))
const publicKeyHex = bytesToHex(secp256k1.getPublicKey(secretKey, true).slice(1))

/** Create a mock File from content bytes */
function mockFile(content: Uint8Array, name: string, type = 'application/octet-stream'): File {
  return new File([content as BlobPart], name, { type })
}

describe('encryptFile', () => {
  test('produces encrypted output with key envelope and metadata', async () => {
    const content = new Uint8Array([1, 2, 3, 4, 5])
    const file = mockFile(content, 'test.txt', 'text/plain')
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, recipients)

    expect(result.encryptedContent).toBeInstanceOf(Uint8Array)
    expect(result.encryptedContent.length).toBeGreaterThan(content.length)
    expect(result.recipientEnvelopes).toHaveLength(1)
    expect(result.recipientEnvelopes[0].pubkey).toBe(publicKeyHex)
    expect(result.recipientEnvelopes[0].encryptedFileKey).toBeTruthy()
    expect(result.recipientEnvelopes[0].ephemeralPubkey).toBeTruthy()
    expect(result.encryptedMetadata).toHaveLength(1)
    expect(result.encryptedMetadata[0].pubkey).toBe(publicKeyHex)
  })

  test('file key envelope can be unwrapped with recipient secret key', async () => {
    const content = new Uint8Array([10, 20, 30])
    const file = mockFile(content, 'data.bin')
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, recipients)
    const envelope = result.recipientEnvelopes[0]

    const unwrapped = eciesUnwrapKeyWithSecret(
      { wrappedKey: envelope.encryptedFileKey, ephemeralPubkey: envelope.ephemeralPubkey },
      secretKey,
      LABEL_FILE_KEY
    )

    expect(unwrapped).toBeInstanceOf(Uint8Array)
    expect(unwrapped.length).toBe(32)

    // Decrypt file content with unwrapped key
    const encData = result.encryptedContent
    const nonce = encData.slice(0, 24)
    const ciphertext = encData.slice(24)
    const cipher = xchacha20poly1305(unwrapped, nonce)
    const decrypted = cipher.decrypt(ciphertext)

    expect(decrypted).toEqual(content)
  })

  test('metadata envelope can be decrypted with recipient secret key', async () => {
    const content = new Uint8Array([42])
    const filename = 'secret.pdf'
    const file = mockFile(content, filename, 'application/pdf')
    const recipients = [publicKeyHex]

    const result = await encryptFile(file, recipients)
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

    const result = await encryptFile(file, recipients)

    expect(result.recipientEnvelopes).toHaveLength(2)
    expect(result.encryptedMetadata).toHaveLength(2)

    // Both recipients unwrap the same file key
    const key1Unwrapped = eciesUnwrapKeyWithSecret(
      {
        wrappedKey: result.recipientEnvelopes[0].encryptedFileKey,
        ephemeralPubkey: result.recipientEnvelopes[0].ephemeralPubkey,
      },
      secretKey,
      LABEL_FILE_KEY
    )
    const key2Unwrapped = eciesUnwrapKeyWithSecret(
      {
        wrappedKey: result.recipientEnvelopes[1].encryptedFileKey,
        ephemeralPubkey: result.recipientEnvelopes[1].ephemeralPubkey,
      },
      key2,
      LABEL_FILE_KEY
    )

    expect(key1Unwrapped).toEqual(key2Unwrapped)
  })
})

// decryptFile, decryptFileMetadata, unwrapFileKey, and rewrapFileKey
// require the crypto Web Worker (unavailable in bun:test).
// Covered by API integration tests that run against a real server.
