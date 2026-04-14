/**
 * CSP report endpoint — API E2E.
 *
 * Exercises POST /api/csp-report against a live server. The endpoint is
 * anonymous (no JWT) and per-IP rate-limited to 60/min. To keep the rate
 * limit test deterministic across worker ordering, every request in this
 * file is stamped with a unique X-Forwarded-For so the in-memory counter
 * is isolated from the rest of the suite.
 */

import { expect, test } from '@playwright/test'

const BASE = 'http://localhost:3000/api/csp-report'

// Unique source IP per test file so the in-process rate-limit counter
// doesn't collide with other tests (or with prior runs during watch mode).
const SOURCE_IP = `10.99.99.${Math.floor(Math.random() * 200) + 10}`

function legacyBody() {
  return {
    'csp-report': {
      'violated-directive': 'script-src',
      'blocked-uri': 'inline',
      'source-file': 'https://example.com/index.html',
      'line-number': 42,
    },
  }
}

function reportingApiBatch() {
  return [
    {
      type: 'csp-violation',
      url: 'https://example.com/',
      body: {
        violatedDirective: 'script-src-elem',
        blockedURL: 'https://evil.example/x.js',
        sourceFile: 'https://example.com/app.js',
        lineNumber: 10,
        disposition: 'report',
      },
    },
  ]
}

test.describe('POST /api/csp-report', () => {
  test('accepts legacy application/csp-report body (204)', async ({ request }) => {
    const res = await request.post(BASE, {
      headers: {
        'Content-Type': 'application/csp-report',
        'X-Forwarded-For': `${SOURCE_IP}.1`,
      },
      data: legacyBody(),
    })
    expect(res.status()).toBe(204)
  })

  test('accepts Reporting API batch (application/reports+json, 204)', async ({ request }) => {
    const res = await request.post(BASE, {
      headers: {
        'Content-Type': 'application/reports+json',
        'X-Forwarded-For': `${SOURCE_IP}.2`,
      },
      data: reportingApiBatch(),
    })
    expect(res.status()).toBe(204)
  })

  test('accepts legacy format sent as application/json (204)', async ({ request }) => {
    const res = await request.post(BASE, {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `${SOURCE_IP}.3`,
      },
      data: legacyBody(),
    })
    expect(res.status()).toBe(204)
  })

  test('rejects malformed body (400)', async ({ request }) => {
    const res = await request.post(BASE, {
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `${SOURCE_IP}.4`,
      },
      data: { nonsense: true },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('rate limits after 60 requests in a window (429)', async ({ request }) => {
    // Isolated IP so the counter starts at zero for this test alone.
    const ip = `${SOURCE_IP}.250`
    const headers = {
      'Content-Type': 'application/csp-report',
      'X-Forwarded-For': ip,
    }
    // 60 requests should succeed (MAX_PER_WINDOW = 60 per csp-report.ts)
    for (let i = 0; i < 60; i++) {
      const res = await request.post(BASE, { headers, data: legacyBody() })
      expect(res.status()).toBe(204)
    }
    // 61st should be rate-limited
    const overflow = await request.post(BASE, { headers, data: legacyBody() })
    expect(overflow.status()).toBe(429)
  })
})
