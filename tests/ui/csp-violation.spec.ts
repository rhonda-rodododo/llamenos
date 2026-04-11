/**
 * Tier 0 — CSP Report-Only header + /api/csp-report endpoint.
 *
 * The `ui` Playwright project has baseURL http://localhost:3000, which is the
 * Bun/Hono backend that actually serves the SPA HTML and attaches CSP headers
 * via the `securityHeaders` middleware. (Vite dev server on :5173 is only
 * used for `bun run dev`; Playwright never hits it.) These tests verify:
 *
 *   1. The root document response carries a `Content-Security-Policy-Report-
 *      Only` header that points report-uri at `/api/csp-report`. This is the
 *      browser-side contract: any CSP violation the browser detects will POST
 *      a report to that endpoint.
 *
 *   2. The `/api/csp-report` endpoint accepts a synthetic legacy CSP report
 *      (application/csp-report JSON body) with a 204. We can't reliably make
 *      Chromium *itself* emit a report against an ephemeral test fixture
 *      without baking an intentional inline <script> into the served HTML, so
 *      we round-trip a synthetic violation through the real HTTP endpoint —
 *      which is what the browser would do on its own.
 *
 * A unique `x-forwarded-for` IP is used so this test's synthetic report
 * cannot trip the per-IP rate limiter (60/min) shared with other tests.
 */

import { expect, test } from '@playwright/test'

test.describe('CSP Report-Only', () => {
  test('root document includes Content-Security-Policy-Report-Only header with /api/csp-report endpoint', async ({
    page,
  }) => {
    const responsePromise = page.waitForResponse(
      (resp) => new URL(resp.url()).pathname === '/' && resp.request().resourceType() === 'document'
    )
    await page.goto('/')
    const response = await responsePromise

    const headers = response.headers()
    const csp = headers['content-security-policy-report-only']
    expect(csp, 'Report-Only CSP header must be present on SPA root').toBeTruthy()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("font-src 'self'")
    expect(csp).toContain('report-uri /api/csp-report')
    expect(csp).toContain('report-to csp-endpoint')
    expect(csp).toContain("require-trusted-types-for 'script'")

    const reportTo = headers['report-to']
    expect(reportTo, 'Report-To header must be present').toBeTruthy()
    expect(reportTo).toContain('csp-endpoint')
    expect(reportTo).toContain('/api/csp-report')
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
