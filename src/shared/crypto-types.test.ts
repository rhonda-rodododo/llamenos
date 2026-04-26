import { describe, expect, test } from 'bun:test'
import {
  asCapsuleNonce,
  asEncryptedNsec,
  asHex,
  asPubkeyHash16,
  asSessionToken,
  isHex,
  tryCapsuleNonce,
  tryEncryptedNsec,
  tryHex,
  tryPubkeyHash16,
  trySessionToken,
} from './crypto-types'

const HEX64 = 'a'.repeat(64)
const HEX48 = 'b'.repeat(48)
const HEX24 = 'b'.repeat(24)
const HEX16 = 'c'.repeat(16)

describe('isHex', () => {
  test('accepts lowercase hex', () => {
    expect(isHex('deadbeef')).toBe(true)
  })

  test('accepts uppercase hex', () => {
    expect(isHex('DEADBEEF')).toBe(true)
  })

  test('accepts mixed case hex', () => {
    expect(isHex('DeadBeef')).toBe(true)
  })

  test('accepts empty string when no length requested', () => {
    // Empty string matches the regex — callers that want non-empty use
    // `isHex(s, length)` or `asEncryptedNsec`.
    expect(isHex('')).toBe(true)
  })

  test('rejects non-hex characters', () => {
    expect(isHex('ghijklmn')).toBe(false)
    expect(isHex('deadbee!')).toBe(false)
    expect(isHex('0x1234')).toBe(false)
  })

  test('length check matches exactly', () => {
    expect(isHex(HEX64, 64)).toBe(true)
    expect(isHex(HEX64, 63)).toBe(false)
    expect(isHex(HEX64, 65)).toBe(false)
  })

  test('length check with non-hex content fails', () => {
    expect(isHex('g'.repeat(64), 64)).toBe(false)
  })
})

describe('asHex / tryHex generic', () => {
  test('asHex returns the branded value on match', () => {
    const v = asHex(HEX64, 64)
    // Branded type narrows at assignment — this also verifies runtime identity.
    expect(v as string).toBe(HEX64)
  })

  test('asHex throws on length mismatch', () => {
    expect(() => asHex(HEX64, 48)).toThrow(/expected 48 hex chars/)
  })

  test('asHex throws on non-hex content', () => {
    expect(() => asHex('z'.repeat(64), 64)).toThrow(/expected 64 hex chars/)
  })

  test('tryHex returns null on wrong length', () => {
    expect(tryHex(HEX64, 48)).toBeNull()
  })

  test('tryHex returns null on non-string input', () => {
    expect(tryHex(1234, 64)).toBeNull()
    expect(tryHex(null, 64)).toBeNull()
    expect(tryHex(undefined, 64)).toBeNull()
    expect(tryHex({}, 64)).toBeNull()
  })

  test('tryHex returns branded value on match', () => {
    const v = tryHex(HEX64, 64)
    expect(v).not.toBeNull()
    expect(v as unknown as string).toBe(HEX64)
  })
})

describe('SessionToken brand', () => {
  test('asSessionToken accepts 64 hex chars', () => {
    expect(asSessionToken(HEX64) as string).toBe(HEX64)
  })

  test('asSessionToken rejects 48 hex chars (capsule-nonce length)', () => {
    expect(() => asSessionToken(HEX48)).toThrow()
  })

  test('trySessionToken returns null on wrong length', () => {
    expect(trySessionToken(HEX48)).toBeNull()
    expect(trySessionToken(HEX16)).toBeNull()
  })

  test('trySessionToken returns value on match', () => {
    expect(trySessionToken(HEX64) as unknown as string).toBe(HEX64)
  })
})

describe('CapsuleNonceHex brand', () => {
  test('asCapsuleNonce accepts 24 hex chars (12-byte AES-GCM nonce)', () => {
    expect(asCapsuleNonce(HEX24) as string).toBe(HEX24)
  })

  test('asCapsuleNonce rejects 48 hex chars (old XChaCha20 nonce length)', () => {
    expect(() => asCapsuleNonce(HEX48)).toThrow()
  })

  test('asCapsuleNonce rejects SessionToken-shaped input', () => {
    expect(() => asCapsuleNonce(HEX64)).toThrow()
  })

  test('tryCapsuleNonce returns null for wrong length', () => {
    expect(tryCapsuleNonce(HEX64)).toBeNull()
  })
})

describe('PubkeyHash16 brand', () => {
  test('asPubkeyHash16 accepts 16 hex chars', () => {
    expect(asPubkeyHash16(HEX16) as string).toBe(HEX16)
  })

  test('asPubkeyHash16 rejects 17 hex chars', () => {
    expect(() => asPubkeyHash16(`${HEX16}f`)).toThrow()
  })

  test('tryPubkeyHash16 accepts mixed case', () => {
    expect(tryPubkeyHash16('AbCdEf0123456789') as unknown as string).toBe('AbCdEf0123456789')
  })
})

describe('EncryptedNsecHex brand', () => {
  test('asEncryptedNsec accepts arbitrary hex length', () => {
    expect(asEncryptedNsec('deadbeef') as string).toBe('deadbeef')
    expect(asEncryptedNsec('a'.repeat(200)) as string).toBe('a'.repeat(200))
  })

  test('asEncryptedNsec rejects empty string', () => {
    expect(() => asEncryptedNsec('')).toThrow()
  })

  test('asEncryptedNsec rejects non-hex characters', () => {
    expect(() => asEncryptedNsec('notevenhex!')).toThrow()
  })

  test('tryEncryptedNsec returns null on non-string', () => {
    expect(tryEncryptedNsec(null)).toBeNull()
    expect(tryEncryptedNsec(undefined)).toBeNull()
    expect(tryEncryptedNsec(12345)).toBeNull()
    expect(tryEncryptedNsec({})).toBeNull()
  })

  test('tryEncryptedNsec returns null on empty string', () => {
    expect(tryEncryptedNsec('')).toBeNull()
  })

  test('tryEncryptedNsec returns value on hex match', () => {
    expect(tryEncryptedNsec('deadbeef') as string).toBe('deadbeef')
  })
})
