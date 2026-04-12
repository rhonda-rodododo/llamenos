import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { buildApiCsp, securityHeaders } from './security-headers'

function makeApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    // biome-ignore lint/suspicious/noExplicitAny: env injection for middleware tests
    ;(c as any).env = {}
    await next()
  })
  app.use('*', securityHeaders)
  app.get('/ok', (c) => c.json({ ok: true }))
  return app
}

describe('buildApiCsp (Tier 4 PR-A)', () => {
  test('script-src is none', () => {
    const csp = buildApiCsp()
    expect(csp).toContain("script-src 'none'")
  })

  test('every active-content directive is explicitly none', () => {
    const csp = buildApiCsp()
    for (const directive of [
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'media-src',
      'worker-src',
      'manifest-src',
      'object-src',
      'frame-src',
      'frame-ancestors',
      'base-uri',
      'form-action',
    ]) {
      expect(csp).toContain(`${directive} 'none'`)
    }
  })

  test('has no unsafe-inline or unsafe-eval', () => {
    const csp = buildApiCsp()
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
  })

  test('retains CSP reporter endpoint', () => {
    const csp = buildApiCsp()
    expect(csp).toContain('report-uri /api/csp-report')
    expect(csp).toContain('report-to csp-endpoint')
  })
})

describe('securityHeaders middleware (Tier 4 PR-A)', () => {
  test('attaches locked-down CSP to JSON responses', async () => {
    const app = makeApp()
    const res = await app.request('/ok')
    const csp =
      res.headers.get('content-security-policy') ??
      res.headers.get('content-security-policy-report-only')
    expect(csp).toBeTruthy()
    expect(csp).toContain("script-src 'none'")
  })

  test('Cross-Origin-Resource-Policy is cross-origin (app.* must fetch api.*)', async () => {
    const app = makeApp()
    const res = await app.request('/ok')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
  })

  test('preserves strict HSTS + referrer-policy + X-Frame-Options', async () => {
    const app = makeApp()
    const res = await app.request('/ok')
    expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('CSP defaults to enforcing when CSP_MODE is unset', async () => {
    const prev = process.env.CSP_MODE
    // biome-ignore lint/performance/noDelete: `process.env.X = undefined` coerces to the string "undefined" on Node; actual unset requires delete.
    delete process.env.CSP_MODE
    try {
      const app = makeApp()
      const res = await app.request('/ok')
      expect(res.headers.get('content-security-policy')).toContain("script-src 'none'")
      expect(res.headers.get('content-security-policy-report-only')).toBeNull()
    } finally {
      if (prev !== undefined) process.env.CSP_MODE = prev
    }
  })

  test('CSP_MODE=report-only downgrades to report-only header', async () => {
    const prev = process.env.CSP_MODE
    process.env.CSP_MODE = 'report-only'
    try {
      const app = makeApp()
      const res = await app.request('/ok')
      expect(res.headers.get('content-security-policy-report-only')).toContain("script-src 'none'")
      expect(res.headers.get('content-security-policy')).toBeNull()
    } finally {
      // biome-ignore lint/performance/noDelete: see note above — needed for real unset.
      if (prev === undefined) delete process.env.CSP_MODE
      else process.env.CSP_MODE = prev
    }
  })

  test('CSP_MODE=enforcing explicitly enforces', async () => {
    const prev = process.env.CSP_MODE
    process.env.CSP_MODE = 'enforcing'
    try {
      const app = makeApp()
      const res = await app.request('/ok')
      expect(res.headers.get('content-security-policy')).toContain("script-src 'none'")
      expect(res.headers.get('content-security-policy-report-only')).toBeNull()
    } finally {
      // biome-ignore lint/performance/noDelete: see note above — needed for real unset.
      if (prev === undefined) delete process.env.CSP_MODE
      else process.env.CSP_MODE = prev
    }
  })
})
