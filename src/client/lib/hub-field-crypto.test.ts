import { describe, expect, test } from 'bun:test'
import { decryptHubField, encryptHubField } from './hub-field-crypto'
import { clearHubKeyCache, setHubKeyForTest } from './hub-key-cache'
import { generateHubKey } from './hub-key-manager'

// Ensure the module-level hub key cache is empty so getHubKeyForId returns null.
// Every "no hub key" test runs with an empty cache, exercising the fallback path
// that distinguishes ciphertext from plaintext via looksLikeCiphertext.
clearHubKeyCache()

const HUB_ID = 'test-hub'

describe('decryptHubField ciphertext detection (no hub key)', () => {
  test('valid-shape hex ciphertext → returns placeholder', () => {
    clearHubKeyCache()
    // 48+ chars, even length, all hex → treated as ciphertext
    const hex = 'a'.repeat(80)
    const result = decryptHubField(hex, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe('PLACEHOLDER')
  })

  test('longer valid-shape hex ciphertext → returns placeholder (not leaked)', () => {
    clearHubKeyCache()
    const hex = '0123456789abcdef'.repeat(8) // 128 chars, even, all hex
    const result = decryptHubField(hex, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe('PLACEHOLDER')
  })

  test('plaintext "Hub Admin" → returns input (not hex)', () => {
    clearHubKeyCache()
    const result = decryptHubField('Hub Admin', HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe('Hub Admin')
  })

  test('odd-length hex → treated as plaintext, returned as-is', () => {
    clearHubKeyCache()
    const oddHex = 'a'.repeat(81) // odd length, fails even-length check
    const result = decryptHubField(oddHex, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe(oddHex)
  })

  test('short hex (< 48 chars) → treated as plaintext, returned as-is', () => {
    clearHubKeyCache()
    const shortHex = 'deadbeef' // 8 chars, below 48 threshold
    const result = decryptHubField(shortHex, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe(shortHex)
  })

  test('short hex 46 chars (just below 48) → treated as plaintext', () => {
    clearHubKeyCache()
    const justUnder = 'a'.repeat(46)
    const result = decryptHubField(justUnder, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe(justUnder)
  })

  test('hex with non-hex chars → treated as plaintext', () => {
    clearHubKeyCache()
    // Long enough & even length but contains 'z' — not valid hex
    const bogus = `${'a'.repeat(47)}z`
    const result = decryptHubField(bogus, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')
    expect(result).toBe(bogus)
  })

  test('null → returns placeholder', () => {
    clearHubKeyCache()
    expect(decryptHubField(null, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')).toBe(
      'PLACEHOLDER'
    )
  })

  test('undefined → returns placeholder', () => {
    clearHubKeyCache()
    expect(decryptHubField(undefined, HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')).toBe(
      'PLACEHOLDER'
    )
  })

  test('empty string → returns placeholder', () => {
    clearHubKeyCache()
    expect(decryptHubField('', HUB_ID, 'row-1', 'encrypted_name', 'PLACEHOLDER')).toBe(
      'PLACEHOLDER'
    )
  })
})

describe('hub-field AAD', () => {
  test('encrypt+decrypt with recordId/fieldName AAD', () => {
    clearHubKeyCache()
    const key = generateHubKey()
    setHubKeyForTest(HUB_ID, key)
    const ct = encryptHubField('value', HUB_ID, 'row-42', 'encrypted_name')
    expect(ct).toBeDefined()
    const pt = decryptHubField(ct!, HUB_ID, 'row-42', 'encrypted_name')
    expect(pt).toBe('value')
  })

  test('mismatched recordId returns placeholder (not plaintext)', () => {
    clearHubKeyCache()
    const key = generateHubKey()
    setHubKeyForTest(HUB_ID, key)
    const ct = encryptHubField('value', HUB_ID, 'row-A', 'encrypted_name')
    expect(ct).toBeDefined()
    const pt = decryptHubField(ct!, HUB_ID, 'row-B', 'encrypted_name', '[locked]')
    expect(pt).toBe('[locked]')
  })

  test('mismatched fieldName returns placeholder (not plaintext)', () => {
    clearHubKeyCache()
    const key = generateHubKey()
    setHubKeyForTest(HUB_ID, key)
    const ct = encryptHubField('value', HUB_ID, 'row-42', 'encrypted_name')
    expect(ct).toBeDefined()
    const pt = decryptHubField(ct!, HUB_ID, 'row-42', 'encrypted_description', '[locked]')
    expect(pt).toBe('[locked]')
  })

  test('correct hubId but absent key returns placeholder for ciphertext', () => {
    clearHubKeyCache()
    const key = generateHubKey()
    setHubKeyForTest('hub-with-key', key)
    const ct = encryptHubField('value', 'hub-with-key', 'row-1', 'encrypted_name')
    expect(ct).toBeDefined()
    clearHubKeyCache()
    const pt = decryptHubField(ct!, 'hub-with-key', 'row-1', 'encrypted_name', '[locked]')
    expect(pt).toBe('[locked]')
  })

  test('encryptHubField returns undefined when hub key absent', () => {
    clearHubKeyCache()
    const ct = encryptHubField('value', 'no-such-hub', 'row-1', 'encrypted_name')
    expect(ct).toBeUndefined()
  })
})
