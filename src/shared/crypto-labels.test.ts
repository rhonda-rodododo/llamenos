import { describe, expect, test } from 'bun:test'
import * as labels from '@shared/crypto-labels'

describe('crypto-labels', () => {
  const entries = Object.entries(labels).filter(([, v]) => typeof v === 'string')
  const values = entries.map(([, v]) => v)

  test('all constants are non-empty strings', () => {
    for (const [name, value] of entries) {
      expect(typeof value, `${name} must be a string`).toBe('string')
      expect((value as string).length, `${name} must be non-empty`).toBeGreaterThan(0)
    }
  })

  test('all constants start with llamenos:', () => {
    for (const [name, value] of entries) {
      expect(value as string, `${name} must start with 'llamenos:'`).toMatch(/^llamenos:/)
    }
  })

  test('all constants are unique (no cross-context collision)', () => {
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })
})
