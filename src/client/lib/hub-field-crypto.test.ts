import { describe, expect, test } from 'bun:test'
import { decryptHubField, encryptHubField } from './hub-field-crypto'
import { clearHubKeyCache, setHubKeyForTest } from './hub-key-cache'

// Ensure the module-level hub key cache is empty so the "no key" branch runs.
clearHubKeyCache()

const HUB_ID = 'test-hub'

function randomHubKey(): Uint8Array {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return b
}

describe('decryptHubField ciphertext detection (no hub key)', () => {
  test('v3-shaped base64url ciphertext → returns placeholder', async () => {
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

  test('plaintext "Hub Admin" → returns input (not ciphertext-shaped)', async () => {
    clearHubKeyCache()
    const result = await decryptHubField(
      'Hub Admin',
      HUB_ID,
      'row-1',
      'encrypted_name',
      'PLACEHOLDER'
    )
    expect(result).toBe('Hub Admin')
  })

  test('short v3-alphabet string → treated as plaintext', async () => {
    clearHubKeyCache()
    const short = 'deadbeef' // 8 chars, below v3 min length
    const result = await decryptHubField(short, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe(short)
  })

  test('non-alphabet string → treated as plaintext', async () => {
    clearHubKeyCache()
    const bogus = `hello world ${'!'.repeat(40)}`
    const result = await decryptHubField(bogus, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe(bogus)
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

describe('hub-field AAD binding (v3 AES-GCM)', () => {
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

  test('encryptHubField returns undefined when hub key absent', async () => {
    clearHubKeyCache()
    const ct = await encryptHubField('value', 'no-such-hub', 'row-1', 'encrypted_name')
    expect(ct).toBeUndefined()
  })
})
