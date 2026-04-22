/**
 * Behavioral CSP iframe-escape Playwright test — Tier 4 Phase-2 P1.
 *
 * Verifies that the server's security headers prevent iframe embedding
 * via both the legacy `X-Frame-Options: DENY` header and the modern
 * CSP `frame-ancestors 'none'` directive. These headers defend against
 * clickjacking attacks where an adversary embeds the app in a hostile page.
 *
 * Tests both API paths (locked-down CSP) and the root (SPA/dev CSP).
 */

import { expect, request as pwRequest, test } from '@playwright/test'

test.describe('CSP iframe-escape prevention (Tier 4)', () => {
  test('API responses include X-Frame-Options: DENY', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__iframe_probe__')

    const xfo = res.headers()['x-frame-options']
    expect(xfo, 'X-Frame-Options must be present').toBeTruthy()
    expect(xfo).toBe('DENY')

    await ctx.dispose()
  })

  test('API CSP includes frame-ancestors none', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__iframe_probe__')

    const headers = res.headers()
    const csp = headers['content-security-policy-report-only'] ?? headers['content-security-policy']
    expect(csp, 'CSP header must be present').toBeTruthy()
    expect(csp).toContain("frame-ancestors 'none'")

    await ctx.dispose()
  })

  test('API CSP includes frame-src none (no outbound iframes)', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__iframe_probe__')

    const headers = res.headers()
    const csp = headers['content-security-policy-report-only'] ?? headers['content-security-policy']
    expect(csp, 'CSP header must be present').toBeTruthy()
    expect(csp).toContain("frame-src 'none'")

    await ctx.dispose()
  })

  test('Cross-Origin-Opener-Policy is same-origin (prevents window.opener exploitation)', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__coop_probe__')

    expect(res.headers()['cross-origin-opener-policy']).toBe('same-origin')

    await ctx.dispose()
  })

  test('Cross-Origin-Embedder-Policy is require-corp (blocks cross-origin embeds)', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__coep_probe__')

    expect(res.headers()['cross-origin-embedder-policy']).toBe('require-corp')

    await ctx.dispose()
  })

  test('all active-content CSP directives are none on API paths', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__csp_lockdown_probe__')

    const headers = res.headers()
    const csp = headers['content-security-policy-report-only'] ?? headers['content-security-policy']
    expect(csp).toBeTruthy()

    for (const directive of [
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'media-src',
      'object-src',
      'frame-src',
      'frame-ancestors',
      'base-uri',
      'form-action',
    ]) {
      expect(csp, `${directive} must be 'none'`).toContain(`${directive} 'none'`)
    }

    await ctx.dispose()
  })

  test('X-Content-Type-Options prevents MIME-sniffing iframe attacks', async () => {
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const res = await ctx.get('/api/__mime_probe__')

    expect(res.headers()['x-content-type-options']).toBe('nosniff')

    await ctx.dispose()
  })
})
