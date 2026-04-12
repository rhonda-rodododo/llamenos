import { describe, expect, test } from 'bun:test'
import { SFRAME_CIPHER_SUITE, deriveBaseKey, importAesKey } from './cipher-suite.js'

describe('SFrame cipher suite', () => {
  test('pins AES-128-GCM with SHA-256', () => {
    expect(SFRAME_CIPHER_SUITE.aead).toBe('AES-GCM')
    expect(SFRAME_CIPHER_SUITE.keyLength).toBe(16)
    expect(SFRAME_CIPHER_SUITE.tagLength).toBe(16)
    expect(SFRAME_CIPHER_SUITE.nonceLength).toBe(12)
    expect(SFRAME_CIPHER_SUITE.hash).toBe('SHA-256')
  })

  test('deriveBaseKey is deterministic for (secret,callId,senderId)', () => {
    const secret = new Uint8Array(32).fill(0x42)
    const a = deriveBaseKey(secret, 'call-1', 'sender-a')
    const b = deriveBaseKey(secret, 'call-1', 'sender-a')
    expect(a).toEqual(b)
    expect(a.length).toBe(16)
  })

  test('deriveBaseKey diverges on callId change', () => {
    const secret = new Uint8Array(32).fill(0x42)
    const a = deriveBaseKey(secret, 'call-1', 'sender-a')
    const b = deriveBaseKey(secret, 'call-2', 'sender-a')
    expect(a).not.toEqual(b)
  })

  test('deriveBaseKey diverges on senderId change', () => {
    const secret = new Uint8Array(32).fill(0x42)
    const a = deriveBaseKey(secret, 'call-1', 'sender-a')
    const b = deriveBaseKey(secret, 'call-1', 'sender-b')
    expect(a).not.toEqual(b)
  })

  test('deriveBaseKey diverges on secret change', () => {
    const a = deriveBaseKey(new Uint8Array(32).fill(0x01), 'c', 's')
    const b = deriveBaseKey(new Uint8Array(32).fill(0x02), 'c', 's')
    expect(a).not.toEqual(b)
  })

  test('importAesKey rejects wrong-length key', async () => {
    await expect(importAesKey(new Uint8Array(15))).rejects.toThrow()
    await expect(importAesKey(new Uint8Array(32))).rejects.toThrow()
  })

  test('importAesKey produces a non-extractable AES-GCM key', async () => {
    const raw = new Uint8Array(16).fill(0x11)
    const key = await importAesKey(raw)
    expect(key.algorithm.name).toBe('AES-GCM')
    expect(key.extractable).toBe(false)
    expect(key.usages).toContain('encrypt')
    expect(key.usages).toContain('decrypt')
  })
})
