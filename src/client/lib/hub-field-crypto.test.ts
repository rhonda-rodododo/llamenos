import { describe, expect, test } from 'bun:test'
import {
  HubFieldTamperError,
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

describe('decryptHubField — missing input returns empty string', () => {
  test('null → empty string', async () => {
    clearHubKeyCache()
    expect(await decryptHubField(null, HUB_ID, 'row-1', 'encrypted_name')).toBe('')
  })

  test('undefined → empty string', async () => {
    clearHubKeyCache()
    expect(await decryptHubField(undefined, HUB_ID, 'row-1', 'encrypted_name')).toBe('')
  })

  test('empty string → empty string', async () => {
    clearHubKeyCache()
    expect(await decryptHubField('', HUB_ID, 'row-1', 'encrypted_name')).toBe('')
  })
})

describe('decryptHubField — hub key not loaded', () => {
  test('ciphertext-shaped value with no hub key → empty string (cannot verify without key)', async () => {
    clearHubKeyCache()
    // 60 base64url chars — indistinguishable from a real envelope. Without
    // the hub key we cannot authenticate it, so we must not leak it to the UI.
    const looksCipher = 'A'.repeat(60)
    const result = await decryptHubField(looksCipher, HUB_ID, 'row-1', 'encrypted_name')
    expect(result).toBe('')
  })

  test('plaintext-shaped value with no hub key → returned as-is (bootstrap seed)', async () => {
    clearHubKeyCache()
    // Short values with spaces cannot be confused with a ciphertext envelope,
    // so they pass through as legitimate pre-encryption bootstrap seeds.
    const result = await decryptHubField('Hub Admin', HUB_ID, 'row-1', 'encrypted_name')
    expect(result).toBe('Hub Admin')
  })
})

describe('decryptHubField — AEAD success returns plaintext', () => {
  test('encrypt+decrypt round-trip', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    const ct = await encryptHubField('value', HUB_ID, 'row-42', 'encrypted_name')
    expect(ct).toBeDefined()
    const pt = await decryptHubField(ct!, HUB_ID, 'row-42', 'encrypted_name')
    expect(pt).toBe('value')
  })
})

describe('decryptHubField — AEAD failure on ciphertext-shaped values throws', () => {
  test('mismatched recordId throws (row swap rejected)', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    const ct = await encryptHubField('value', HUB_ID, 'row-A', 'encrypted_name')
    expect(ct).toBeDefined()
    await expect(decryptHubField(ct!, HUB_ID, 'row-B', 'encrypted_name')).rejects.toBeInstanceOf(
      HubFieldTamperError
    )
  })

  test('mismatched fieldName throws (column swap rejected)', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    const ct = await encryptHubField('value', HUB_ID, 'row-42', 'encrypted_name')
    expect(ct).toBeDefined()
    await expect(
      decryptHubField(ct!, HUB_ID, 'row-42', 'encrypted_description')
    ).rejects.toBeInstanceOf(HubFieldTamperError)
  })

  test('wrong hub key throws (cross-hub ciphertext rejected)', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    const ct = await encryptHubField('value', HUB_ID, 'row-1', 'encrypted_name')
    expect(ct).toBeDefined()
    // Replace the hub key underneath — the ciphertext was sealed under the
    // previous key, so decrypt must fail with a tamper error.
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    await expect(decryptHubField(ct!, HUB_ID, 'row-1', 'encrypted_name')).rejects.toBeInstanceOf(
      HubFieldTamperError
    )
  })

  test('ciphertext-shaped garbage with key loaded throws (tamper rejected)', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    // A 60-char base64url string that is NOT a valid envelope: this is the
    // exact attack shape — a malicious server replacing a real ciphertext
    // with ciphertext-looking garbage. Must throw, not leak.
    const fake = 'A'.repeat(60)
    await expect(decryptHubField(fake, HUB_ID, 'row-1', 'encrypted_name')).rejects.toBeInstanceOf(
      HubFieldTamperError
    )
  })

  test('HubFieldTamperError carries hubId/recordId/fieldName for diagnostics', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    try {
      await decryptHubField('A'.repeat(60), HUB_ID, 'row-42', 'encrypted_name')
      throw new Error('expected tamper error')
    } catch (err) {
      expect(err).toBeInstanceOf(HubFieldTamperError)
      const tamper = err as HubFieldTamperError
      expect(tamper.hubId).toBe(HUB_ID)
      expect(tamper.recordId).toBe('row-42')
      expect(tamper.fieldName).toBe('encrypted_name')
    }
  })
})

describe('decryptHubField — plaintext-shaped seeds pass through with key loaded', () => {
  test('plaintext-shaped value with key loaded → returned as-is (bootstrap row)', async () => {
    clearHubKeyCache()
    await setHubKeyForTest(HUB_ID, randomHubKey())
    // Default roles are seeded as plaintext before a hub key exists. Once the
    // client unlocks, those rows must still render — they were never encrypted,
    // not tampered. Short values containing spaces cannot masquerade as a
    // ciphertext envelope, so the passthrough is safe.
    const result = await decryptHubField('Hub Admin', HUB_ID, 'role-hub-admin', 'encrypted_name')
    expect(result).toBe('Hub Admin')
  })
})

describe('encryptHubField', () => {
  test('returns undefined when hub key absent', async () => {
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
