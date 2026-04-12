import { describe, expect, test } from 'bun:test'
import { decryptHubFieldV3, encryptHubFieldV3, generateHubKeyV3 } from './hub-field-crypto-v3.js'

describe('hub-field-crypto-v3', () => {
  test('generateHubKeyV3 returns a non-extractable AES-GCM key', async () => {
    const k = await generateHubKeyV3()
    expect(k.algorithm.name).toBe('AES-GCM')
    expect(k.extractable).toBe(false)
    expect(k.usages).toContain('encrypt')
    expect(k.usages).toContain('decrypt')
  })

  test('encrypt/decrypt round trip', async () => {
    const k = await generateHubKeyV3()
    const ct = await encryptHubFieldV3('Hello Shift', k, 'shift-1', 'name')
    const pt = await decryptHubFieldV3(ct, k, 'shift-1', 'name')
    expect(pt).toBe('Hello Shift')
  })

  test('wrong recordId fails (row swap rejected)', async () => {
    const k = await generateHubKeyV3()
    const ct = await encryptHubFieldV3('Value', k, 'row-A', 'name')
    const pt = await decryptHubFieldV3(ct, k, 'row-B', 'name')
    expect(pt).toBeNull()
  })

  test('wrong fieldName fails (column swap rejected)', async () => {
    const k = await generateHubKeyV3()
    const ct = await encryptHubFieldV3('Value', k, 'row-A', 'name')
    const pt = await decryptHubFieldV3(ct, k, 'row-A', 'description')
    expect(pt).toBeNull()
  })

  test('wrong key fails', async () => {
    const k1 = await generateHubKeyV3()
    const k2 = await generateHubKeyV3()
    const ct = await encryptHubFieldV3('Value', k1, 'r', 'f')
    const pt = await decryptHubFieldV3(ct, k2, 'r', 'f')
    expect(pt).toBeNull()
  })

  test('tampered ciphertext fails', async () => {
    const k = await generateHubKeyV3()
    const ct = await encryptHubFieldV3('Value', k, 'r', 'f')
    const tampered = `${ct.slice(0, -2)}AA`
    const pt = await decryptHubFieldV3(tampered, k, 'r', 'f')
    expect(pt).toBeNull()
  })

  test('nonce is random — two ciphertexts for the same input differ', async () => {
    const k = await generateHubKeyV3()
    const a = await encryptHubFieldV3('same', k, 'r', 'f')
    const b = await encryptHubFieldV3('same', k, 'r', 'f')
    expect(a).not.toBe(b)
    expect(await decryptHubFieldV3(a, k, 'r', 'f')).toBe('same')
    expect(await decryptHubFieldV3(b, k, 'r', 'f')).toBe('same')
  })
})
