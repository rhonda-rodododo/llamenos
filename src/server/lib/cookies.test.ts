import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearRefreshCookieOptions,
  clearSessionIdCookieOptions,
  refreshCookieOptions,
  sessionIdCookieOptions,
} from './cookies'

const ORIGINAL = process.env.API_COOKIE_DOMAIN

afterEach(() => {
  if (ORIGINAL === undefined) {
    process.env.API_COOKIE_DOMAIN = undefined
  } else {
    process.env.API_COOKIE_DOMAIN = ORIGINAL
  }
})

describe('auth cookie builder (Tier 4 PR-A)', () => {
  test('refresh cookie is HttpOnly + Secure + SameSite=Strict', () => {
    const opts = refreshCookieOptions(3600)
    expect(opts.httpOnly).toBe(true)
    expect(opts.secure).toBe(true)
    expect(opts.sameSite).toBe('Strict')
    expect(opts.path).toBe('/api/auth/token')
    expect(opts.maxAge).toBe(3600)
  })

  test('refresh cookie NEVER uses SameSite=None (discipline rule)', () => {
    process.env.API_COOKIE_DOMAIN = 'api.example.com'
    const opts = refreshCookieOptions()
    expect(opts.sameSite).not.toBe('None')
    expect(opts.sameSite).toBe('Strict')
  })

  test('session-id cookie is HttpOnly + Secure + SameSite=Strict + path=/', () => {
    const opts = sessionIdCookieOptions(3600)
    expect(opts.httpOnly).toBe(true)
    expect(opts.secure).toBe(true)
    expect(opts.sameSite).toBe('Strict')
    expect(opts.path).toBe('/')
    expect(opts.maxAge).toBe(3600)
  })

  test('cookies include Domain attribute when API_COOKIE_DOMAIN is set', () => {
    process.env.API_COOKIE_DOMAIN = 'api.llamenos.example'
    expect(refreshCookieOptions().domain).toBe('api.llamenos.example')
    expect(sessionIdCookieOptions().domain).toBe('api.llamenos.example')
  })

  test('cookies omit Domain attribute when API_COOKIE_DOMAIN is unset', () => {
    process.env.API_COOKIE_DOMAIN = undefined
    expect(refreshCookieOptions().domain).toBeUndefined()
    expect(sessionIdCookieOptions().domain).toBeUndefined()
  })

  test('clear helpers set maxAge=0 and otherwise match live options', () => {
    const cleared = clearRefreshCookieOptions()
    expect(cleared.maxAge).toBe(0)
    expect(cleared.path).toBe('/api/auth/token')
    expect(cleared.sameSite).toBe('Strict')

    const clearedSid = clearSessionIdCookieOptions()
    expect(clearedSid.maxAge).toBe(0)
    expect(clearedSid.path).toBe('/')
    expect(clearedSid.sameSite).toBe('Strict')
  })
})
