/**
 * Tier 0 + Tier 4 PR-A — API-host CSP + /api/csp-report endpoint.
 *
 * The `ui` Playwright project has baseURL http://localhost:3000, which in
 * Tier 4 is the API-only Bun/Hono backend. The server no longer serves the
 * SPA; `/` returns a JSON 404 but still carries the locked-down API CSP via
 * the `securityHeaders` middleware. These tests verify:
 *
 *   1. Any response from the API host — even a 404 — carries the API-locked
 *      `Content-Security-Policy-Report-Only` header (`script-src 'none'`, every
 *      active-content directive denied, `report-uri /api/csp-report`).
 *
 *   2. The `/api/csp-report` endpoint accepts a synthetic legacy CSP report
 *      (application/csp-report JSON body) with a 204.
 *
 *   3. The `/api/csp-report` endpoint accepts a Reporting API batch with 204.
 *
 * A unique `x-forwarded-for` IP is used so this test's synthetic report
 * cannot trip the per-IP rate limiter (60/min) shared with other tests.
 */

import { expect, request as pwRequest, test } from '@playwright/test'

test.describe('API-host CSP', () => {
  test('API host responses carry the locked-down CSP with /api/csp-report endpoint', async () => {
    // Don't use page.goto — the API host returns 404 for `/` and Playwright
    // flags document 4xx as failures. Drive the request layer directly.
    const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000' })
    const response = await ctx.get('/')
    expect(response.status()).toBe(404)

    const headers = response.headers()
    const csp = headers['content-security-policy-report-only'] ?? headers['content-security-policy']
    expect(csp, 'API-locked CSP header must be present on API host').toBeTruthy()
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'none'")
    expect(csp).toContain("style-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('report-uri /api/csp-report')
    expect(csp).toContain('report-to csp-endpoint')

    const reportTo = headers['report-to']
    expect(reportTo, 'Report-To header must be present').toBeTruthy()
    expect(reportTo).toContain('csp-endpoint')
    expect(reportTo).toContain('/api/csp-report')

    await ctx.dispose()
  })

  test('POST /api/csp-report accepts a synthetic legacy CSP violation with 204', async ({
    request,
  }) => {
    // Unique x-forwarded-for so we don't collide with the endpoint's 60/min
    // per-IP rate limit used by any concurrent test.
    const syntheticIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`

    const response = await request.post('/api/csp-report', {
      headers: {
        'content-type': 'application/csp-report',
        'x-forwarded-for': syntheticIp,
      },
      data: {
        'csp-report': {
          'document-uri': 'http://localhost:3000/',
          referrer: '',
          'violated-directive': 'script-src',
          'effective-directive': 'script-src',
          'original-policy': "default-src 'self'; script-src 'self'",
          disposition: 'report',
          'blocked-uri': 'inline',
          'line-number': 1,
          'column-number': 1,
          'source-file': 'http://localhost:3000/',
          'status-code': 200,
          'script-sample': '',
        },
      },
    })

    expect(response.status()).toBe(204)
  })

  test('POST /api/csp-report accepts a Reporting API batch with 204', async ({ request }) => {
    const syntheticIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`

    const response = await request.post('/api/csp-report', {
      headers: {
        'content-type': 'application/reports+json',
        'x-forwarded-for': syntheticIp,
      },
      data: [
        {
          age: 0,
          type: 'csp-violation',
          url: 'http://localhost:3000/',
          user_agent: 'playwright-test',
          body: {
            documentURL: 'http://localhost:3000/',
            referrer: '',
            blockedURL: 'inline',
            effectiveDirective: 'script-src',
            violatedDirective: 'script-src',
            originalPolicy: "default-src 'self'; script-src 'self'",
            disposition: 'report',
            statusCode: 200,
            sample: '',
          },
        },
      ],
    })

    expect(response.status()).toBe(204)
  })
})
