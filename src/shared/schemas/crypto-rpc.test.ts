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

describe('CryptoRpcRequestSchema', () => {
  test('accepts a valid decryptEnvelope request', () => {
    const parsed = CryptoRpcRequestSchema.parse({
      op: 'decryptEnvelope',
      id: UUID,
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
    const parsed = CryptoRpcRequestSchema.parse({ op: 'isUnlocked', id: UUID })
    expect(parsed.op).toBe('isUnlocked')
  })

  test('accepts unlock with full KEK material', () => {
    const parsed = CryptoRpcRequestSchema.parse({
      op: 'unlock',
      id: UUID,
      kekHex: HEX64,
      nonceHex: HEX48,
      ciphertextHex: 'ab'.repeat(100),
    })
    expect(parsed.op).toBe('unlock')
  })

  test('accepts encryptHubField at exactly the 64 KiB boundary', () => {
    const parsed = CryptoRpcRequestSchema.parse({
      op: 'encryptHubField',
      id: UUID,
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
    expect(() => CryptoRpcRequestSchema.parse({ op: 'nukeEverything', id: UUID })).toThrow()
  })

  test('rejects invalid UUID', () => {
    expect(() => CryptoRpcRequestSchema.parse({ op: 'lock', id: 'not-a-uuid' })).toThrow()
  })

  test('rejects fieldName with path traversal characters', () => {
    expect(() =>
      CryptoRpcRequestSchema.parse({
        op: 'decryptHubField',
        id: UUID,
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
      result: false,
    })
    expect(parsed.kind).toBe('success')
  })

  test('error response has coded error enum', () => {
    const parsed = CryptoRpcErrorSchema.parse({
      kind: 'error',
      id: UUID,
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
