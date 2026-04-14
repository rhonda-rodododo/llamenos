import { describe, expect, test } from 'bun:test'
import {
  decryptHubField,
  decryptHubFieldAead,
  encryptHubField,
  encryptHubFieldAead,
  generateHubFieldCryptoKey,
} from './hub-field-crypto'
import { clearHubKeyCache, setHubKeyForTest } from './hub-key-cache'

// Ensure the module-level hub key cache is empty so the "no key" branch runs.
clearHubKeyCache()

const HUB_ID = 'test-hub'

function randomHubKey(): Uint8Array {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return b
}

describe('decryptHubField — no hub key loaded', () => {
  test('ciphertext-shaped base64url → returns placeholder', async () => {
    clearHubKeyCache()
    const looksCipher = `${'A'.repeat(40)}`
    const result = await decryptHubField(
      looksCipher,
      HUB_ID,
      'row-1',
      'encrypted_name',
      'PLACEHOLDER'
    )
    expect(result).toBe('PLACEHOLDER')
  })

  test('server plaintext "Hub Admin" → returns placeholder, never leaks server value (H1)', async () => {
    clearHubKeyCache()
    const result = await decryptHubField(
      'Hub Admin',
      HUB_ID,
      'row-1',
      'encrypted_name',
      'PLACEHOLDER'
    )
    expect(result).toBe('PLACEHOLDER')
  })

  test('short base64url-alphabet string → returns placeholder, never leaks server value (H1)', async () => {
    clearHubKeyCache()
    const short = 'deadbeef'
    const result = await decryptHubField(short, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe('PLACEHOLDER')
  })

  test('non-alphabet string → returns placeholder, never leaks server value (H1)', async () => {
    clearHubKeyCache()
    const bogus = `hello world ${'!'.repeat(40)}`
    const result = await decryptHubField(bogus, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe('PLACEHOLDER')
  })

  test('null → returns placeholder', async () => {
    clearHubKeyCache()
    expect(await decryptHubField(null, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')).toBe(
      'PLACEHOLDER'
    )
  })

  test('undefined → returns placeholder', async () => {
    clearHubKeyCache()
    expect(await decryptHubField(undefined, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')).toBe(
      'PLACEHOLDER'
    )
  })

  test('empty string → returns placeholder', async () => {
    clearHubKeyCache()
    expect(await decryptHubField('', HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')).toBe(
      'PLACEHOLDER'
    )
  })
})

describe('hub-field AAD binding (high-level wrapper)', () => {
  test('encrypt+decrypt round-trip', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    const ct = await encryptHubField('value', HUB_ID, 'row-42', 'encrypted_name')
    expect(ct).toBeDefined()
    const pt = await decryptHubField(ct!, HUB_ID, 'row-42', 'encrypted_name')
    expect(pt).toBe('value')
  })

  test('mismatched recordId returns placeholder (not plaintext)', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    const ct = await encryptHubField('value', HUB_ID, 'row-A', 'encrypted_name')
    expect(ct).toBeDefined()
    const pt = await decryptHubField(ct!, HUB_ID, 'row-B', 'encrypted_name', '[locked]')
    expect(pt).toBe('[locked]')
  })

  test('mismatched fieldName returns placeholder (not plaintext)', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    const ct = await encryptHubField('value', HUB_ID, 'row-42', 'encrypted_name')
    expect(ct).toBeDefined()
    const pt = await decryptHubField(ct!, HUB_ID, 'row-42', 'encrypted_description', '[locked]')
    expect(pt).toBe('[locked]')
  })

  test('hub key absent after encrypt returns placeholder for ciphertext', async () => {
    clearHubKeyCache()
    await setHubKeyForTest('hub-with-key', randomHubKey())
    const ct = await encryptHubField('value', 'hub-with-key', 'row-1', 'encrypted_name')
    expect(ct).toBeDefined()
    clearHubKeyCache()
    const pt = await decryptHubField(ct!, 'hub-with-key', 'row-1', 'encrypted_name', '[locked]')
    expect(pt).toBe('[locked]')
  })

  test('AEAD failure with hub key present → returns placeholder, never raw input (H1)', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    const notRealCiphertext = 'This is server plaintext that should never leak'
    const pt = await decryptHubField(
      notRealCiphertext,
      HUB_ID,
      'row-1',
      'encrypted_name',
      '[locked]'
    )
    expect(pt).toBe('[locked]')
  })

  test('encryptHubField returns undefined when hub key absent', async () => {
    clearHubKeyCache()
    const ct = await encryptHubField('value', 'no-such-hub', 'row-1', 'encrypted_name')
    expect(ct).toBeUndefined()
  })
})

describe('hub-field AEAD primitive', () => {
  test('generateHubFieldCryptoKey returns a non-extractable AES-GCM key', async () => {
    const k = await generateHubFieldCryptoKey()
    expect(k.algorithm.name).toBe('AES-GCM')
    expect(k.extractable).toBe(false)
    expect(k.usages).toContain('encrypt')
    expect(k.usages).toContain('decrypt')
  })

  test('encrypt/decrypt round trip', async () => {
    const k = await generateHubFieldCryptoKey()
    const ct = await encryptHubFieldAead('Hello Shift', k, 'shift-1', 'name')
    const pt = await decryptHubFieldAead(ct, k, 'shift-1', 'name')
    expect(pt).toBe('Hello Shift')
  })

  test('wrong recordId fails (row swap rejected)', async () => {
    const k = await generateHubFieldCryptoKey()
    const ct = await encryptHubFieldAead('Value', k, 'row-A', 'name')
    const pt = await decryptHubFieldAead(ct, k, 'row-B', 'name')
    expect(pt).toBeNull()
  })

  test('wrong fieldName fails (column swap rejected)', async () => {
    const k = await generateHubFieldCryptoKey()
    const ct = await encryptHubFieldAead('Value', k, 'row-A', 'name')
    const pt = await decryptHubFieldAead(ct, k, 'row-A', 'description')
    expect(pt).toBeNull()
  })

  test('wrong key fails', async () => {
    const k1 = await generateHubFieldCryptoKey()
    const k2 = await generateHubFieldCryptoKey()
    const ct = await encryptHubFieldAead('Value', k1, 'r', 'f')
    const pt = await decryptHubFieldAead(ct, k2, 'r', 'f')
    expect(pt).toBeNull()
  })

  test('tampered ciphertext fails', async () => {
    const k = await generateHubFieldCryptoKey()
    const ct = await encryptHubFieldAead('Value', k, 'r', 'f')
    const tampered = `${ct.slice(0, -2)}AA`
    const pt = await decryptHubFieldAead(tampered, k, 'r', 'f')
    expect(pt).toBeNull()
  })

  test('nonce is random — two ciphertexts for the same input differ', async () => {
    const k = await generateHubFieldCryptoKey()
    const a = await encryptHubFieldAead('same', k, 'r', 'f')
    const b = await encryptHubFieldAead('same', k, 'r', 'f')
    expect(a).not.toBe(b)
    expect(await decryptHubFieldAead(a, k, 'r', 'f')).toBe('same')
    expect(await decryptHubFieldAead(b, k, 'r', 'f')).toBe('same')
  })
})
