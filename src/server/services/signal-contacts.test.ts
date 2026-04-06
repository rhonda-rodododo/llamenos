import { describe, expect, test } from 'bun:test'
import { normalizeSignalIdentifier } from '../../shared/signal-identifier-normalize'
import { hashSignalIdentifier } from './signal-contacts'

describe('normalizeSignalIdentifier', () => {
  test('normalizes phone by stripping formatting', () => {
    expect(normalizeSignalIdentifier('+1 (555) 123-4567', 'phone')).toBe('+15551234567')
  })

  test('lowercases usernames', () => {
    expect(normalizeSignalIdentifier('@Handle.01', 'username')).toBe('@handle.01')
  })

  test('adds @ prefix to usernames missing it', () => {
    expect(normalizeSignalIdentifier('alice.42', 'username')).toBe('@alice.42')
  })

  test('adds + to phone numbers missing it', () => {
    expect(normalizeSignalIdentifier('15551234567', 'phone')).toBe('+15551234567')
  })
})

describe('hashSignalIdentifier', () => {
  test('is deterministic given same inputs', () => {
    const a = hashSignalIdentifier('+15551234567', 'secret-xyz')
    const b = hashSignalIdentifier('+15551234567', 'secret-xyz')
    expect(a).toBe(b)
  })

  test('differs with different secrets', () => {
    const a = hashSignalIdentifier('+15551234567', 'secret1')
    const b = hashSignalIdentifier('+15551234567', 'secret2')
    expect(a).not.toBe(b)
  })

  test('returns hex of expected length', () => {
    const h = hashSignalIdentifier('+15551234567', 'secret-xyz')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
