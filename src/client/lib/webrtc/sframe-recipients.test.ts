import { describe, expect, test } from 'bun:test'
import { resolveCallRecipients } from './sframe-recipients.js'

const fakeKey = {} as CryptoKey

describe('resolveCallRecipients', () => {
  test('pre-Tier-3 fallback: one recipient per user', () => {
    const result = resolveCallRecipients([
      { userId: 'a'.repeat(64), identityPublicKey: fakeKey, devices: undefined },
      { userId: 'b'.repeat(64), identityPublicKey: fakeKey, devices: undefined },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].deviceId).toBe('a'.repeat(64))
    expect(result[1].deviceId).toBe('b'.repeat(64))
  })

  test('pre-Tier-3 fallback for empty devices array', () => {
    const result = resolveCallRecipients([
      { userId: 'a'.repeat(64), identityPublicKey: fakeKey, devices: [] },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].deviceId).toBe('a'.repeat(64))
  })

  test('Tier 3: one recipient per device', () => {
    const result = resolveCallRecipients([
      {
        userId: 'a'.repeat(64),
        identityPublicKey: fakeKey,
        devices: [
          { deviceId: 'c'.repeat(64), publicKey: fakeKey },
          { deviceId: 'd'.repeat(64), publicKey: fakeKey },
        ],
      },
    ])
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.deviceId).sort()).toEqual(['c'.repeat(64), 'd'.repeat(64)])
  })

  test('mixes Tier 3 and pre-Tier-3 users', () => {
    const result = resolveCallRecipients([
      { userId: 'a'.repeat(64), identityPublicKey: fakeKey },
      {
        userId: 'b'.repeat(64),
        identityPublicKey: fakeKey,
        devices: [{ deviceId: 'c'.repeat(64), publicKey: fakeKey }],
      },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].deviceId).toBe('a'.repeat(64))
    expect(result[1].deviceId).toBe('c'.repeat(64))
  })

  test('throws on empty users list', () => {
    expect(() => resolveCallRecipients([])).toThrow(/at least one/)
  })
})
