import { describe, expect, test } from 'bun:test'
import { hexToBytes } from '@noble/hashes/utils.js'
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm'

describe('aes-gcm', () => {
  const key = new Uint8Array(32).fill(0x42)
  const aad = new Uint8Array(0)

  test('round-trip: encrypt then decrypt returns original plaintext', async () => {
    const plaintext = new TextEncoder().encode('hello world')
    const ct = await aesGcmEncrypt(plaintext, key, aad)
    const decrypted = await aesGcmDecrypt(ct, key, aad)
    expect(new TextDecoder().decode(decrypted)).toBe('hello world')
  })

  test('wire format: nonce(12) + ciphertext+tag', async () => {
    const plaintext = new Uint8Array(10)
    const ct = await aesGcmEncrypt(plaintext, key, aad)
    const raw = hexToBytes(ct)
    // 12 nonce + 10 plaintext + 16 tag = 38 bytes
    expect(raw.length).toBe(38)
    // hex string = 76 chars
    expect(ct.length).toBe(76)
  })

  test('empty plaintext round-trip', async () => {
    const plaintext = new Uint8Array(0)
    const ct = await aesGcmEncrypt(plaintext, key, aad)
    const decrypted = await aesGcmDecrypt(ct, key, aad)
    expect(decrypted.length).toBe(0)
  })

  test('wrong key fails to decrypt', async () => {
    const plaintext = new TextEncoder().encode('secret')
    const ct = await aesGcmEncrypt(plaintext, key, aad)
    const wrongKey = new Uint8Array(32).fill(0x99)
    await expect(aesGcmDecrypt(ct, wrongKey, aad)).rejects.toThrow()
  })

  test('wrong AAD fails to decrypt', async () => {
    const plaintext = new TextEncoder().encode('secret')
    const someAad = new TextEncoder().encode('context-a')
    const ct = await aesGcmEncrypt(plaintext, key, someAad)
    const wrongAad = new TextEncoder().encode('context-b')
    await expect(aesGcmDecrypt(ct, key, wrongAad)).rejects.toThrow()
  })

  test('tampered ciphertext fails to decrypt', async () => {
    const plaintext = new TextEncoder().encode('secret')
    const ct = await aesGcmEncrypt(plaintext, key, aad)
    // Flip a byte in the ciphertext portion (after the 24-char nonce hex)
    const tampered = ct.slice(0, 30) + 'ff' + ct.slice(32)
    await expect(aesGcmDecrypt(tampered, key, aad)).rejects.toThrow()
  })

  test('truncated ciphertext (shorter than nonce) fails', async () => {
    await expect(aesGcmDecrypt('aabb', key, aad)).rejects.toThrow()
  })

  test('sub-array view input works correctly', async () => {
    // Create a Uint8Array view with non-zero byteOffset
    const buffer = new ArrayBuffer(64)
    const view = new Uint8Array(buffer, 16, 32)
    view.fill(0x42) // same as our test key
    const plaintext = new TextEncoder().encode('test')
    const ct = await aesGcmEncrypt(plaintext, view, aad)
    const decrypted = await aesGcmDecrypt(ct, view, aad)
    expect(new TextDecoder().decode(decrypted)).toBe('test')
  })

  test('nonce is unique across encryptions', async () => {
    const plaintext = new TextEncoder().encode('same')
    const ct1 = await aesGcmEncrypt(plaintext, key, aad)
    const ct2 = await aesGcmEncrypt(plaintext, key, aad)
    // Same plaintext + key but different nonces -> different ciphertext
    expect(ct1).not.toBe(ct2)
    // First 24 hex chars are the nonce -- they should differ
    expect(ct1.slice(0, 24)).not.toBe(ct2.slice(0, 24))
  })
})
