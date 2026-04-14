import { describe, expect, test } from 'bun:test'
import {
  CryptoRpcErrorSchema,
  CryptoRpcReadySchema,
  CryptoRpcRequestSchema,
  CryptoRpcResponseSchema,
  CryptoRpcSuccessSchema,
} from './crypto-rpc'

const UUID = 'a1b2c3d4-5678-4abc-89ef-1234567890ab'
const HEX64 = 'de'.repeat(32)
const HEX48 = 'de'.repeat(24)
const HEX66 = `02${'ab'.repeat(32)}`
const NONCE = 'ab'.repeat(32) // 64 hex chars = 32 bytes

describe('CryptoRpcRequestSchema', () => {
  test('accepts a valid decryptEnvelope request', () => {
    const parsed = CryptoRpcRequestSchema.parse({
      op: 'decryptEnvelope',
      id: UUID,
      nonceHex: NONCE,
      envelope: {
        v: 2,
        labelId: 0,
        wrappedKey: 'deadbeef'.repeat(12),
        ephemeralPubkey: HEX66,
      },
      expectedLabel: 'llamenos:note-key',
      recordId: 'note-42',
    })
    expect(parsed.op).toBe('decryptEnvelope')
  })

  test('accepts isUnlocked with minimal payload', () => {
    const parsed = CryptoRpcRequestSchema.parse({
      op: 'isUnlocked',
      id: UUID,
      nonceHex: NONCE,
    })
    expect(parsed.op).toBe('isUnlocked')
  })

  test('accepts unlock with full KEK material', () => {
    const parsed = CryptoRpcRequestSchema.parse({
      op: 'unlock',
      id: UUID,
      nonceHex: NONCE,
      kekHex: HEX64,
      unlockNonceHex: HEX48,
      ciphertextHex: 'ab'.repeat(100),
    })
    expect(parsed.op).toBe('unlock')
  })

  test('rejects request missing required nonceHex', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({
        op: 'isUnlocked',
        id: UUID,
      })
    ).toThrow()
  })

  test('rejects request with non-64-char nonceHex', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({
        op: 'isUnlocked',
        id: UUID,
        nonceHex: 'ab'.repeat(16), // 32 chars, too short
      })
    ).toThrow()
  })

  test('accepts encryptHubField at exactly the 64 KiB boundary', () => {
    const parsed = CryptoRpcRequestSchema.parse({
      op: 'encryptHubField',
      id: UUID,
      nonceHex: NONCE,
      hubId: UUID,
      plaintext: 'x'.repeat(64 * 1024),
      recordId: 'rec-1',
      fieldName: 'display_name',
    })
    expect(parsed.op).toBe('encryptHubField')
  })

  test('rejects encryptHubField plaintext larger than 64 KiB', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({
        op: 'encryptHubField',
        id: UUID,
        nonceHex: NONCE,
        hubId: UUID,
        plaintext: 'x'.repeat(64 * 1024 + 1),
        recordId: 'rec-1',
        fieldName: 'display_name',
      })
    ).toThrow()
  })

  test('rejects a decryptEnvelope with an odd-length ephemeralPubkey', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({
        op: 'decryptEnvelope',
        id: UUID,
        nonceHex: NONCE,
        envelope: {
          v: 2,
          labelId: 0,
          wrappedKey: 'ab',
          ephemeralPubkey: 'abcd', // too short, not 66 hex chars
        },
        expectedLabel: 'llamenos:note-key',
      })
    ).toThrow()
  })

  test('rejects an unknown op', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({ op: 'nukeEverything', id: UUID, nonceHex: NONCE })
    ).toThrow()
  })

  test('rejects invalid UUID', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({ op: 'lock', id: 'not-a-uuid', nonceHex: NONCE })
    ).toThrow()
  })

  test('rejects fieldName with path traversal characters', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({
        op: 'decryptHubField',
        id: UUID,
        nonceHex: NONCE,
        hubId: UUID,
        ciphertextHex: 'ab',
        recordId: 'rec-1',
        fieldName: '../etc/passwd',
      })
    ).toThrow()
  })
})

describe('CryptoRpcResponseSchema', () => {
  test('parses a success response', () => {
    const parsed = CryptoRpcResponseSchema.parse({
      kind: 'success',
      id: UUID,
      nonceHex: NONCE,
      result: false,
    })
    expect(parsed.kind).toBe('success')
  })

  test('rejects success response missing echoed nonceHex', () => {
    expect(() =>
      CryptoRpcSuccessSchema.parse({
        kind: 'success',
        id: UUID,
        result: false,
      })
    ).toThrow()
  })

  test('error response has coded error enum', () => {
    const parsed = CryptoRpcErrorSchema.parse({
      kind: 'error',
      id: UUID,
      nonceHex: NONCE,
      code: 'label_mismatch',
      message: 'expected llamenos:note-key, got llamenos:message',
    })
    expect(parsed.kind).toBe('error')
  })

  test('rejects an unknown error code', () => {
    expect(() =>
      CryptoRpcErrorSchema.parse({
        kind: 'error',
        id: UUID,
        nonceHex: NONCE,
        code: 'mystery_error',
        message: 'oops',
      })
    ).toThrow()
  })

  test('success schema is disjoint from error schema', () => {
    expect(() =>
      CryptoRpcSuccessSchema.parse({
        kind: 'error',
        id: UUID,
        nonceHex: NONCE,
        code: 'internal',
        message: 'x',
      })
    ).toThrow()
  })
})

describe('CryptoRpcReadySchema', () => {
  test('accepts a v1 ready broadcast', () => {
    const parsed = CryptoRpcReadySchema.parse({ kind: 'ready', protocol: 1 })
    expect(parsed.protocol).toBe(1)
  })

  test('rejects a ready broadcast with an unexpected protocol version', () => {
    expect(() => CryptoRpcReadySchema.parse({ kind: 'ready', protocol: 99 })).toThrow()
  })
})
