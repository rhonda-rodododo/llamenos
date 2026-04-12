import { describe, expect, test } from 'bun:test'
import { generateDeviceKeypair, pubkeyToHex } from './device-identity'

describe('generateDeviceKeypair', () => {
  test('produces valid Ed25519 + X25519 keypairs', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    expect(kp.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(kp.signing.publicKey).toBeInstanceOf(Uint8Array)
    expect(kp.signing.publicKey.length).toBe(32)
    expect(kp.encryption.publicKey).toBeInstanceOf(Uint8Array)
    expect(kp.encryption.publicKey.length).toBe(32)
    expect(kp.isPaperKey).toBe(false)
  })

  test('signing private key is non-extractable', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await expect(crypto.subtle.exportKey('raw', kp.signing.privateKey)).rejects.toThrow()
    await expect(crypto.subtle.exportKey('pkcs8', kp.signing.privateKey)).rejects.toThrow()
  })

  test('encryption private key is non-extractable', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await expect(crypto.subtle.exportKey('raw', kp.encryption.privateKey)).rejects.toThrow()
  })

  test('multiple calls produce distinct keypairs', async () => {
    const a = await generateDeviceKeypair({ isPaperKey: false })
    const b = await generateDeviceKeypair({ isPaperKey: false })
    expect(a.deviceId).not.toBe(b.deviceId)
    expect(a.signing.publicKey).not.toEqual(b.signing.publicKey)
    expect(a.encryption.publicKey).not.toEqual(b.encryption.publicKey)
  })

  test('paper key flag is preserved', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: true })
    expect(kp.isPaperKey).toBe(true)
  })

  test('signing key can produce valid Ed25519 signatures', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    const message = new TextEncoder().encode('test message')
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, kp.signing.privateKey, message)
    expect(sig.byteLength).toBe(64)

    // Import the public key for verification
    const pubKey = await crypto.subtle.importKey(
      'raw',
      kp.signing.publicKey,
      { name: 'Ed25519' },
      true,
      ['verify']
    )
    const valid = await crypto.subtle.verify({ name: 'Ed25519' }, pubKey, sig, message)
    expect(valid).toBe(true)
  })
})

describe('pubkeyToHex', () => {
  test('converts 32-byte array to 64-char hex string', () => {
    const bytes = new Uint8Array(32).fill(0xab)
    expect(pubkeyToHex(bytes)).toBe('ab'.repeat(32))
  })
})
