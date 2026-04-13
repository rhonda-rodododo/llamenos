import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  type EncryptedKeyData,
  type KEKFactors,
  SYNTHETIC_ISSUERS,
  clearStoredKey,
  decryptNsec,
  deriveKEK,
  encryptNsec,
  hasStoredKey,
  isValidPin,
  loadEncryptedKey,
  storeEncryptedKey,
  syntheticIdpValue,
} from './key-store'

// Mock localStorage for Bun (no browser)
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v)
  },
  removeItem: (k: string) => {
    store.delete(k)
  },
  clear: () => store.clear(),
  get length() {
    return store.size
  },
  key: (i: number) => [...store.keys()][i] ?? null,
} as Storage

beforeEach(() => store.clear())

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeSalt(): Uint8Array {
  const salt = new Uint8Array(32)
  crypto.getRandomValues(salt)
  return salt
}

function makeIdpValue(): Uint8Array {
  const v = new Uint8Array(32)
  crypto.getRandomValues(v)
  return v
}

function makePrfOutput(): Uint8Array {
  const p = new Uint8Array(32)
  crypto.getRandomValues(p)
  return p
}

/** A valid 64-hex-char nsec for testing */
const TEST_NSEC_HEX = 'a'.repeat(64)
const TEST_PUBKEY = 'b'.repeat(64)

// ---------------------------------------------------------------------------
// deriveKEK
// ---------------------------------------------------------------------------

describe('deriveKEK', () => {
  const salt = makeSalt()
  const idpValue = makeIdpValue()

  test('2-factor: PIN + IdP value produces 32-byte output', () => {
    const kek = deriveKEK({ pin: '123456', idpValue, salt })
    expect(kek).toBeInstanceOf(Uint8Array)
    expect(kek.length).toBe(32)
  })

  test('2-factor: same inputs produce same output (deterministic)', () => {
    const factors: KEKFactors = { pin: '123456', idpValue, salt }
    const kek1 = deriveKEK(factors)
    const kek2 = deriveKEK(factors)
    expect(bytesToHex(kek1)).toBe(bytesToHex(kek2))
  })

  test('different PINs produce different KEKs', () => {
    const kek1 = deriveKEK({ pin: '123456', idpValue, salt })
    const kek2 = deriveKEK({ pin: '654321', idpValue, salt })
    expect(bytesToHex(kek1)).not.toBe(bytesToHex(kek2))
  })

  test('different IdP values produce different KEKs', () => {
    const idpValue2 = makeIdpValue()
    const kek1 = deriveKEK({ pin: '123456', idpValue, salt })
    const kek2 = deriveKEK({ pin: '123456', idpValue: idpValue2, salt })
    expect(bytesToHex(kek1)).not.toBe(bytesToHex(kek2))
  })

  test('different salts produce different KEKs', () => {
    const salt2 = makeSalt()
    const kek1 = deriveKEK({ pin: '123456', idpValue, salt })
    const kek2 = deriveKEK({ pin: '123456', idpValue, salt: salt2 })
    expect(bytesToHex(kek1)).not.toBe(bytesToHex(kek2))
  })

  test('3-factor: PIN + IdP value + PRF output produces 32-byte output', () => {
    const prfOutput = makePrfOutput()
    const kek = deriveKEK({ pin: '123456', idpValue, prfOutput, salt })
    expect(kek).toBeInstanceOf(Uint8Array)
    expect(kek.length).toBe(32)
  })

  test('3-factor produces different output than 2-factor with same PIN + IdP', () => {
    const prfOutput = makePrfOutput()
    const kek2f = deriveKEK({ pin: '123456', idpValue, salt })
    const kek3f = deriveKEK({ pin: '123456', idpValue, prfOutput, salt })
    expect(bytesToHex(kek2f)).not.toBe(bytesToHex(kek3f))
  })

  test('3-factor: same inputs produce same output (deterministic)', () => {
    const prfOutput = makePrfOutput()
    const factors: KEKFactors = { pin: '123456', idpValue, prfOutput, salt }
    const kek1 = deriveKEK(factors)
    const kek2 = deriveKEK(factors)
    expect(bytesToHex(kek1)).toBe(bytesToHex(kek2))
  })

  test('3-factor: different PRF outputs produce different KEKs', () => {
    const prf1 = makePrfOutput()
    const prf2 = makePrfOutput()
    const kek1 = deriveKEK({ pin: '123456', idpValue, prfOutput: prf1, salt })
    const kek2 = deriveKEK({ pin: '123456', idpValue, prfOutput: prf2, salt })
    expect(bytesToHex(kek1)).not.toBe(bytesToHex(kek2))
  })
})

// ---------------------------------------------------------------------------
// encryptNsec + decryptNsec round-trip
// ---------------------------------------------------------------------------

describe('encryptNsec', () => {
  test('produces a valid EncryptedKeyData blob', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const kek = deriveKEK({ pin: '123456', idpValue, salt })

    const blob = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'https://idp.example', salt)

    expect(blob.version).toBe(2)
    expect(blob.kdf).toBe('pbkdf2-sha256')
    expect(blob.cipher).toBe('xchacha20-poly1305')
    expect(blob.prfUsed).toBe(false)
    expect(blob.idpIssuer).toBe('https://idp.example')
    expect(blob.salt).toBe(bytesToHex(salt))
    // nonce should be 24 bytes = 48 hex chars
    expect(blob.nonce.length).toBe(48)
    // ciphertext should be non-empty
    expect(blob.ciphertext.length).toBeGreaterThan(0)
    // pubkeyHash should be 16 hex chars (truncated SHA-256)
    expect(blob.pubkeyHash.length).toBe(16)
  })

  test('round-trip: encryptNsec -> decryptNsec recovers original nsec', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const kek = deriveKEK({ pin: '123456', idpValue, salt })

    const blob = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'https://idp.example', salt)
    const recovered = decryptNsec(blob, kek)

    expect(recovered).toBe(TEST_NSEC_HEX)
  })

  test('decrypt with wrong KEK returns null', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const kek = deriveKEK({ pin: '123456', idpValue, salt })
    const wrongKek = deriveKEK({ pin: '654321', idpValue, salt })

    const blob = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'https://idp.example', salt)
    const result = decryptNsec(blob, wrongKek)

    expect(result).toBeNull()
  })

  test('prfUsed flag is preserved in blob', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const prfOutput = makePrfOutput()
    const kek = deriveKEK({ pin: '123456', idpValue, prfOutput, salt })

    const blob = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, true, 'https://idp.example', salt)
    expect(blob.prfUsed).toBe(true)

    const recovered = decryptNsec(blob, kek)
    expect(recovered).toBe(TEST_NSEC_HEX)
  })

  test('each encryption produces different ciphertext (random nonce)', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const kek = deriveKEK({ pin: '123456', idpValue, salt })

    const blob1 = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'test', salt)
    const blob2 = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'test', salt)

    expect(blob1.nonce).not.toBe(blob2.nonce)
    expect(blob1.ciphertext).not.toBe(blob2.ciphertext)
  })
})

// ---------------------------------------------------------------------------
// storeEncryptedKey + loadEncryptedKey — localStorage round-trip
// ---------------------------------------------------------------------------

describe('storeEncryptedKey / loadEncryptedKey', () => {
  test('round-trip: store then load returns same blob', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const kek = deriveKEK({ pin: '123456', idpValue, salt })
    const blob = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'test-issuer', salt)

    storeEncryptedKey(blob)
    const loaded = loadEncryptedKey()

    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(2)
    expect(loaded!.salt).toBe(blob.salt)
    expect(loaded!.nonce).toBe(blob.nonce)
    expect(loaded!.ciphertext).toBe(blob.ciphertext)
    expect(loaded!.pubkeyHash).toBe(blob.pubkeyHash)
    expect(loaded!.prfUsed).toBe(blob.prfUsed)
    expect(loaded!.idpIssuer).toBe(blob.idpIssuer)
  })

  test('loadEncryptedKey returns null when nothing stored', () => {
    expect(loadEncryptedKey()).toBeNull()
  })

  test('loadEncryptedKey returns null for non-JSON data', () => {
    localStorage.setItem('llamenos-encrypted-key-v2', 'not-json')
    expect(loadEncryptedKey()).toBeNull()
  })

  test('loadEncryptedKey returns null for wrong version', () => {
    localStorage.setItem(
      'llamenos-encrypted-key-v2',
      JSON.stringify({ version: 1, salt: 'aa', nonce: 'bb', ciphertext: 'cc' })
    )
    expect(loadEncryptedKey()).toBeNull()
  })

  test('hasStoredKey returns false when empty', () => {
    expect(hasStoredKey()).toBe(false)
  })

  test('hasStoredKey returns true after store', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const kek = deriveKEK({ pin: '123456', idpValue, salt })
    const blob = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'test', salt)
    storeEncryptedKey(blob)
    expect(hasStoredKey()).toBe(true)
  })

  test('clearStoredKey removes the key', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const kek = deriveKEK({ pin: '123456', idpValue, salt })
    const blob = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'test', salt)
    storeEncryptedKey(blob)
    expect(hasStoredKey()).toBe(true)

    clearStoredKey()
    expect(hasStoredKey()).toBe(false)
    expect(loadEncryptedKey()).toBeNull()
  })

  test('full round-trip: store, load, decrypt recovers nsec', () => {
    const salt = makeSalt()
    const idpValue = makeIdpValue()
    const kek = deriveKEK({ pin: '123456', idpValue, salt })
    const blob = encryptNsec(TEST_NSEC_HEX, kek, TEST_PUBKEY, false, 'test', salt)

    storeEncryptedKey(blob)
    const loaded = loadEncryptedKey()!
    const recovered = decryptNsec(loaded, kek)

    expect(recovered).toBe(TEST_NSEC_HEX)
  })
})

// ---------------------------------------------------------------------------
// syntheticIdpValue
// ---------------------------------------------------------------------------

describe('syntheticIdpValue', () => {
  test('returns a 32-byte Uint8Array', () => {
    const val = syntheticIdpValue('device-link')
    expect(val).toBeInstanceOf(Uint8Array)
    expect(val.length).toBe(32)
  })

  test('same issuer produces same value (deterministic)', () => {
    const val1 = syntheticIdpValue('device-link')
    const val2 = syntheticIdpValue('device-link')
    expect(bytesToHex(val1)).toBe(bytesToHex(val2))
  })

  test('different issuers produce different values', () => {
    const val1 = syntheticIdpValue('device-link')
    const val2 = syntheticIdpValue('recovery')
    expect(bytesToHex(val1)).not.toBe(bytesToHex(val2))
  })

  test('can be used as idpValue in deriveKEK for 2-factor mode', () => {
    const salt = makeSalt()
    const idpValue = syntheticIdpValue('device-link')
    const kek = deriveKEK({ pin: '123456', idpValue, salt })
    expect(kek).toBeInstanceOf(Uint8Array)
    expect(kek.length).toBe(32)
  })

  test('synthetic value differs from a real IdP value', () => {
    const synthetic = syntheticIdpValue('device-link')
    const real = makeIdpValue()
    // They are different with overwhelming probability
    expect(bytesToHex(synthetic)).not.toBe(bytesToHex(real))
  })
})

// ---------------------------------------------------------------------------
// isValidPin
// ---------------------------------------------------------------------------

describe('isValidPin', () => {
  test('accepts 6 digits', () => {
    expect(isValidPin('123456')).toBe(true)
  })

  test('accepts 7 digits', () => {
    expect(isValidPin('1234567')).toBe(true)
  })

  test('accepts 8 digits', () => {
    expect(isValidPin('12345678')).toBe(true)
  })

  test('rejects 5 digits', () => {
    expect(isValidPin('12345')).toBe(false)
  })

  test('rejects 9 digits', () => {
    expect(isValidPin('123456789')).toBe(false)
  })

  test('rejects letters', () => {
    expect(isValidPin('abcdef')).toBe(false)
  })

  test('rejects mixed alphanumeric', () => {
    expect(isValidPin('123abc')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isValidPin('')).toBe(false)
  })

  test('rejects spaces', () => {
    expect(isValidPin('123 456')).toBe(false)
  })

  test('rejects special characters', () => {
    expect(isValidPin('12345!')).toBe(false)
  })

  test('accepts all-zeros', () => {
    expect(isValidPin('000000')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SYNTHETIC_ISSUERS — identifying synthetic vs real issuers
// ---------------------------------------------------------------------------

describe('SYNTHETIC_ISSUERS', () => {
  test('contains device-link', () => {
    expect(SYNTHETIC_ISSUERS).toContain('device-link')
  })

  test('is a readonly tuple', () => {
    expect(Array.isArray(SYNTHETIC_ISSUERS)).toBe(true)
    expect(SYNTHETIC_ISSUERS.length).toBeGreaterThan(0)
  })

  test('can identify synthetic issuers', () => {
    const isSynthetic = (issuer: string) =>
      (SYNTHETIC_ISSUERS as readonly string[]).includes(issuer)

    expect(isSynthetic('device-link')).toBe(true)
    expect(isSynthetic('https://accounts.google.com')).toBe(false)
    expect(isSynthetic('https://login.microsoftonline.com')).toBe(false)
    expect(isSynthetic('')).toBe(false)
  })
})
