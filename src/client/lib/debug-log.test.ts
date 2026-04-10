import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { matchesDebug } from './debug-log'

// Polyfill localStorage for bun:test (node environment)
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string) {
    return this.store.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.store.set(k, v)
  }
  removeItem(k: string) {
    this.store.delete(k)
  }
  clear() {
    this.store.clear()
  }
  key(i: number) {
    return Array.from(this.store.keys())[i] ?? null
  }
  get length() {
    return this.store.size
  }
}
// biome-ignore lint/suspicious/noExplicitAny: test-scoped globalThis poke
;(globalThis as any).localStorage = new MemoryStorage()

// NOTE: createDebugLog wraps matchesDebug behind import.meta.env.DEV, which is a
// Vite build-time constant unavailable in bun:test. The matching logic is fully
// covered via matchesDebug below — the DEV guard is validated by Vite's dead-code
// elimination at build time, not at unit-test time.

describe('matchesDebug — exact match', () => {
  test('matches exact namespace', () => {
    expect(matchesDebug('llamenos:crypto', 'llamenos:crypto')).toBe(true)
  })

  test('no match when namespace differs', () => {
    expect(matchesDebug('llamenos:crypto', 'llamenos:sip')).toBe(false)
  })
})

describe('matchesDebug — wildcard patterns', () => {
  test('ns:* matches namespace with that prefix', () => {
    expect(matchesDebug('llamenos:sip', 'llamenos:*')).toBe(true)
  })

  test('ns:* matches deeper subnamespace', () => {
    expect(matchesDebug('llamenos:sip:ws', 'llamenos:*')).toBe(true)
  })

  test('ns:* does not match unrelated namespace', () => {
    expect(matchesDebug('other:sip', 'llamenos:*')).toBe(false)
  })

  test('ns* (no colon) matches prefix', () => {
    expect(matchesDebug('llamenos:sip', 'llamenos*')).toBe(true)
  })

  test('ns* does not match unrelated prefix', () => {
    expect(matchesDebug('other:sip', 'llamenos*')).toBe(false)
  })
})

describe('matchesDebug — empty / null env', () => {
  test('null debugEnv = no match (localStorage not set)', () => {
    expect(matchesDebug('llamenos:crypto', null)).toBe(false)
  })

  test('empty string debugEnv = no match', () => {
    expect(matchesDebug('llamenos:crypto', '')).toBe(false)
  })
})

describe('matchesDebug — comma-separated list', () => {
  test('matches when namespace is one of many patterns', () => {
    expect(matchesDebug('llamenos:crypto', 'llamenos:sip,llamenos:crypto')).toBe(true)
  })

  test('no match when namespace is not in list', () => {
    expect(matchesDebug('llamenos:other', 'llamenos:sip,llamenos:crypto')).toBe(false)
  })

  test('trims whitespace around patterns', () => {
    expect(matchesDebug('llamenos:crypto', '  llamenos:crypto  ')).toBe(true)
    expect(matchesDebug('llamenos:crypto', 'llamenos:sip , llamenos:crypto')).toBe(true)
  })
})

describe('matchesDebug — localStorage integration', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  afterEach(() => {
    globalThis.localStorage.clear()
  })

  test('reads debug patterns from localStorage', () => {
    globalThis.localStorage.setItem('debug', 'llamenos:crypto,llamenos:sip')
    const debugVal = globalThis.localStorage.getItem('debug')
    expect(matchesDebug('llamenos:crypto', debugVal)).toBe(true)
    expect(matchesDebug('llamenos:other', debugVal)).toBe(false)
  })

  test('wildcard from localStorage matches prefix', () => {
    globalThis.localStorage.setItem('debug', 'llamenos:*')
    const debugVal = globalThis.localStorage.getItem('debug')
    expect(matchesDebug('llamenos:sip', debugVal)).toBe(true)
  })

  test('no localStorage entry = silent (null = no patterns)', () => {
    const debugVal = globalThis.localStorage.getItem('debug')
    expect(debugVal).toBeNull()
    expect(matchesDebug('llamenos:crypto', debugVal)).toBe(false)
  })
})
