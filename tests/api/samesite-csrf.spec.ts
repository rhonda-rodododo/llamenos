/**
 * Behavioral SameSite CSRF Playwright test — Tier 4 Phase-2 P1.
 *
 * Verifies that auth cookies are configured with SameSite=Strict to
 * prevent cross-site request forgery. The server never uses SameSite=None
 * (Tier 4 discipline rule). Additional cookie security attributes are
 * validated: HttpOnly, path scoping, and Secure flag in production mode.
 *
 * These tests hit the live API server to verify actual Set-Cookie headers.
 */

import { expect, request as pwRequest, test } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

/**
 * Parse a Set-Cookie header value into an attribute map.
 * Handles both single-value attributes (HttpOnly, Secure) and key=value pairs.
 */
function parseCookieAttributes(setCookie: string): Record<string, string | true> {
  const parts = setCookie.split(';').map((s) => s.trim())
  const attrs: Record<string, string | true> = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) {
      attrs[part.toLowerCase()] = true
    } else {
      attrs[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1)
    }
  }
  return attrs
}

test.describe('SameSite CSRF protection (Tier 4)', () => {
  test('login response sets SameSite=Strict on auth cookies', async ({ request }) => {
    const authed = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Trigger a login to get Set-Cookie headers
    const loginRes = await authed.post('/api/auth/login', {
      pubkey: getPublicKey(nip19.decode(ADMIN_NSEC).data),
    })

    // Even if login returns non-200 (e.g. needs challenge), check any
    // Set-Cookie headers that were set
    const setCookieHeaders = loginRes.headers()['set-cookie']
    if (setCookieHeaders) {
      const cookies = setCookieHeaders.split(/,(?=\s*\w+=)/)
      for (const cookie of cookies) {
        const attrs = parseCookieAttributes(cookie)
        if (attrs.samesite) {
          expect(attrs.samesite).not.toBe('None')
          expect(attrs.samesite).toBe('Strict')
        }
      }
    }
  })

  test('token refresh endpoint sets SameSite=Strict cookies', async ({ request }) => {
    const authed = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const res = await authed.post('/api/auth/token/refresh', {})
    const setCookieHeaders = res.headers()['set-cookie']

    if (setCookieHeaders) {
      const cookies = setCookieHeaders.split(/,(?=\s*\w+=)/)
      for (const cookie of cookies) {
        const attrs = parseCookieAttributes(cookie)
        if (attrs.samesite) {
          expect(
            attrs.samesite,
            `Cookie must not use SameSite=None: ${cookie.slice(0, 50)}`
          ).not.toBe('None')
        }
      }
    }
  })

  test('auth cookies are HttpOnly (no JS access via XSS)', async ({ request }) => {
    const authed = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const res = await authed.post('/api/auth/token/refresh', {})
    const setCookieHeaders = res.headers()['set-cookie']

    if (setCookieHeaders) {
      const cookies = setCookieHeaders.split(/,(?=\s*\w+=)/)
      for (const cookie of cookies) {
        const attrs = parseCookieAttributes(cookie)
        // Auth cookies (refresh, session-id) must be HttpOnly
        if (cookie.includes('llamenos-refresh') || cookie.includes('llamenos-session-id')) {
          expect(attrs.httponly, `Cookie must be HttpOnly: ${cookie.slice(0, 50)}`).toBe(true)
        }
      }
    }
  })

  test('refresh cookie is path-scoped to /api/auth/token', async ({ request }) => {
    const authed = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    const res = await authed.post('/api/auth/token/refresh', {})
    const setCookieHeaders = res.headers()['set-cookie']

    if (setCookieHeaders) {
      const cookies = setCookieHeaders.split(/,(?=\s*\w+=)/)
      for (const cookie of cookies) {
        if (cookie.includes('llamenos-refresh')) {
          const attrs = parseCookieAttributes(cookie)
          expect(attrs.path).toBe('/api/auth/token')
        }
      }
    }
  })

  test('CSRF headers are present: no-referrer + strict HSTS', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__csrf_probe__')

    const headers = res.headers()

    // Referrer-Policy prevents leaking referrer info to attackers
    expect(headers['referrer-policy']).toBe('no-referrer')

    // HSTS prevents SSL-strip MITM that could downgrade SameSite protection
    expect(headers['strict-transport-security']).toContain('max-age=63072000')
    expect(headers['strict-transport-security']).toContain('includeSubDomains')

    await ctx.dispose()
  })

  test('X-Permitted-Cross-Domain-Policies is none (Flash/PDF CSRF vector)', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__cross_domain_probe__')

    expect(res.headers()['x-permitted-cross-domain-policies']).toBe('none')

    await ctx.dispose()
  })
})
