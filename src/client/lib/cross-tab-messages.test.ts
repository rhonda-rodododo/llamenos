import { describe, expect, test } from 'bun:test'
import { parseLockMessage, parseSyncMessage } from './cross-tab-messages'

const HEX16 = 'abcdef0123456789'
const HEX64 = 'a'.repeat(64)

describe('parseSyncMessage — request-token', () => {
  test('accepts a well-formed request', () => {
    const msg = parseSyncMessage({
      type: 'request-token',
      nonce: 'nonce-123',
      pubkeyHash: HEX16,
    })
    expect(msg).toEqual({
      type: 'request-token',
      nonce: 'nonce-123',
      pubkeyHash: HEX16 as never,
    })
  })

  test('rejects missing nonce', () => {
    expect(parseSyncMessage({ type: 'request-token', pubkeyHash: HEX16 })).toBeNull()
  })

  test('rejects empty nonce', () => {
    expect(parseSyncMessage({ type: 'request-token', nonce: '', pubkeyHash: HEX16 })).toBeNull()
  })

  test('rejects non-hex pubkeyHash', () => {
    expect(
      parseSyncMessage({
        type: 'request-token',
        nonce: 'nonce-123',
        pubkeyHash: 'not-hex-not-hex!',
      })
    ).toBeNull()
  })

  test('rejects wrong-length pubkeyHash', () => {
    expect(
      parseSyncMessage({
        type: 'request-token',
        nonce: 'nonce-123',
        pubkeyHash: 'abc',
      })
    ).toBeNull()
  })
})

describe('parseSyncMessage — token-response', () => {
  test('accepts a well-formed response', () => {
    const msg = parseSyncMessage({
      type: 'token-response',
      nonce: 'nonce-123',
      pubkeyHash: HEX16,
      token: HEX64,
    })
    expect(msg?.type).toBe('token-response')
    if (msg?.type === 'token-response') {
      expect(msg.nonce).toBe('nonce-123')
      expect(msg.pubkeyHash).toBe(HEX16 as never)
      expect(msg.token).toBe(HEX64 as never)
    }
  })

  test('rejects 48-char token (capsule-nonce length)', () => {
    expect(
      parseSyncMessage({
        type: 'token-response',
        nonce: 'nonce-123',
        pubkeyHash: HEX16,
        token: 'b'.repeat(48),
      })
    ).toBeNull()
  })

  test('rejects missing token', () => {
    expect(
      parseSyncMessage({
        type: 'token-response',
        nonce: 'nonce-123',
        pubkeyHash: HEX16,
      })
    ).toBeNull()
  })
})

describe('parseSyncMessage — rejects unknown / malformed input', () => {
  test('rejects null', () => {
    expect(parseSyncMessage(null)).toBeNull()
  })

  test('rejects undefined', () => {
    expect(parseSyncMessage(undefined)).toBeNull()
  })

  test('rejects a string payload', () => {
    expect(parseSyncMessage('request-token')).toBeNull()
  })

  test('rejects an unknown discriminant', () => {
    expect(parseSyncMessage({ type: 'hello', nonce: 'n', pubkeyHash: HEX16 })).toBeNull()
  })

  test('rejects a lock message shape', () => {
    expect(parseSyncMessage({ type: 'lock' })).toBeNull()
  })
})

describe('parseLockMessage', () => {
  test('accepts {type: "lock"}', () => {
    expect(parseLockMessage({ type: 'lock' })).toEqual({ type: 'lock' })
  })

  test('rejects unknown type', () => {
    expect(parseLockMessage({ type: 'unlock' })).toBeNull()
  })

  test('rejects sync message shape', () => {
    expect(parseLockMessage({ type: 'request-token', nonce: 'n', pubkeyHash: HEX16 })).toBeNull()
  })

  test('rejects null / undefined / primitives', () => {
    expect(parseLockMessage(null)).toBeNull()
    expect(parseLockMessage(undefined)).toBeNull()
    expect(parseLockMessage('lock')).toBeNull()
    expect(parseLockMessage(42)).toBeNull()
  })
})
