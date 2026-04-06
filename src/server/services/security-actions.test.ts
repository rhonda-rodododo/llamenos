import { describe, expect, test } from 'bun:test'
import { generateRecoveryKey } from './security-actions'

describe('generateRecoveryKey', () => {
  test('generates 128-bit key formatted with dashes', () => {
    const key = generateRecoveryKey()
    // 16 bytes → 128 bits → 26 base32 chars in 4-char groups (last group has 2)
    expect(key).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}-[A-Z2-7]{2}$/)
    expect(key.replace(/-/g, '')).toHaveLength(26)
  })

  test('generates different keys each call', () => {
    expect(generateRecoveryKey()).not.toBe(generateRecoveryKey())
  })
})
