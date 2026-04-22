import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  __setStorageForTests,
  ConveniencePinFormatError,
  ConveniencePinLockedError,
  ConveniencePinMismatchError,
  clearConveniencePin,
  enterConveniencePin,
  hasConveniencePin,
  isConveniencePinLocked,
  isValidConveniencePin,
  setConveniencePin,
} from './convenience-pin'

function makeMapStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
}

describe('convenience-pin', () => {
  beforeEach(() => {
    __setStorageForTests(makeMapStorage())
  })

  afterEach(async () => {
    await clearConveniencePin()
  })

  test('set + enter round-trip succeeds', async () => {
    await setConveniencePin('1234')
    const ok = await enterConveniencePin('1234')
    expect(ok).toBe(true)
  })

  test('hasConveniencePin returns true after set', async () => {
    expect(hasConveniencePin()).toBe(false)
    await setConveniencePin('1234')
    expect(hasConveniencePin()).toBe(true)
  })

  test('wrong PIN throws ConveniencePinMismatchError', async () => {
    await setConveniencePin('1234')
    await expect(enterConveniencePin('9999')).rejects.toBeInstanceOf(ConveniencePinMismatchError)
  })

  test('5 wrong attempts locks the PIN gate', async () => {
    await setConveniencePin('1234')
    for (let i = 0; i < 5; i++) {
      await enterConveniencePin('0000').catch(() => {})
    }
    expect(isConveniencePinLocked()).toBe(true)
    await expect(enterConveniencePin('1234')).rejects.toBeInstanceOf(ConveniencePinLockedError)
  })

  test('clear removes the PIN', async () => {
    await setConveniencePin('1234')
    await clearConveniencePin()
    expect(hasConveniencePin()).toBe(false)
    await expect(enterConveniencePin('1234')).rejects.toBeInstanceOf(ConveniencePinMismatchError)
  })

  test('successful entry resets attempt counter', async () => {
    await setConveniencePin('5678')
    // 4 wrong attempts
    for (let i = 0; i < 4; i++) {
      await enterConveniencePin('0000').catch(() => {})
    }
    // Correct PIN resets counter
    await enterConveniencePin('5678')
    // 4 more wrong — should NOT lock because counter was reset
    for (let i = 0; i < 4; i++) {
      await enterConveniencePin('0000').catch(() => {})
    }
    // Still not locked
    const ok = await enterConveniencePin('5678')
    expect(ok).toBe(true)
  })

  test('isValidConveniencePin validates format', () => {
    expect(isValidConveniencePin('1234')).toBe(true)
    expect(isValidConveniencePin('12345678')).toBe(true)
    expect(isValidConveniencePin('123')).toBe(false) // too short
    expect(isValidConveniencePin('123456789')).toBe(false) // too long
    expect(isValidConveniencePin('abcd')).toBe(false) // not digits
    expect(isValidConveniencePin('')).toBe(false)
  })

  test('setConveniencePin rejects invalid format', async () => {
    await expect(setConveniencePin('abc')).rejects.toBeInstanceOf(ConveniencePinFormatError)
  })
})
