import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { areCookiesBlocked, resetCookieDetection } from './cookie-detection'

// biome-ignore lint/suspicious/noExplicitAny: test needs to mutate globalThis
const g = globalThis as any

const originalNavigator = g.navigator
const originalDocument = g.document

beforeEach(() => {
  resetCookieDetection()
})

afterEach(() => {
  Object.defineProperty(g, 'navigator', { configurable: true, value: originalNavigator })
  Object.defineProperty(g, 'document', { configurable: true, value: originalDocument })
})

function installFakeCookieJar(): { set: (v: string) => void; clear: () => void } {
  let store = ''
  Object.defineProperty(g, 'document', {
    configurable: true,
    value: {
      get cookie() {
        return store
      },
      set cookie(v: string) {
        // Cheap parse: if max-age=0 remove matching name, else append "name=value"
        const eq = v.indexOf('=')
        const name = v.slice(0, eq).trim()
        if (/max-age=0/.test(v)) {
          store = store
            .split(';')
            .map((s) => s.trim())
            .filter((s) => !s.startsWith(`${name}=`))
            .join('; ')
        } else {
          const pair = v.split(';')[0].trim()
          store = store ? `${store}; ${pair}` : pair
        }
      },
    },
  })
  return {
    set: (v: string) => {
      store = v
    },
    clear: () => {
      store = ''
    },
  }
}

function installNoopCookieJar(): void {
  // Writes are silently dropped — simulates blocked first-party cookies.
  Object.defineProperty(g, 'document', {
    configurable: true,
    value: {
      get cookie() {
        return ''
      },
      set cookie(_v: string) {
        // drop
      },
    },
  })
}

describe('areCookiesBlocked', () => {
  test('returns true when navigator.cookieEnabled is false', () => {
    Object.defineProperty(g, 'navigator', { configurable: true, value: { cookieEnabled: false } })
    installFakeCookieJar()
    expect(areCookiesBlocked()).toBe(true)
  })

  test('returns false when probe cookie round-trips successfully', () => {
    Object.defineProperty(g, 'navigator', { configurable: true, value: { cookieEnabled: true } })
    installFakeCookieJar()
    expect(areCookiesBlocked()).toBe(false)
  })

  test('returns true when writes are silently dropped', () => {
    Object.defineProperty(g, 'navigator', { configurable: true, value: { cookieEnabled: true } })
    installNoopCookieJar()
    expect(areCookiesBlocked()).toBe(true)
  })

  test('memoizes result across calls', () => {
    Object.defineProperty(g, 'navigator', { configurable: true, value: { cookieEnabled: false } })
    installFakeCookieJar()
    const first = areCookiesBlocked()
    Object.defineProperty(g, 'navigator', { configurable: true, value: { cookieEnabled: true } })
    expect(areCookiesBlocked()).toBe(first)
  })

  test('resetCookieDetection clears the cache', () => {
    Object.defineProperty(g, 'navigator', { configurable: true, value: { cookieEnabled: false } })
    installFakeCookieJar()
    expect(areCookiesBlocked()).toBe(true)
    Object.defineProperty(g, 'navigator', { configurable: true, value: { cookieEnabled: true } })
    resetCookieDetection()
    expect(areCookiesBlocked()).toBe(false)
  })
})
