import { describe, expect, test } from 'bun:test'
import app from './csp-report'

describe('POST /api/csp-report', () => {
  test('accepts legacy application/csp-report body', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'violated-directive': 'script-src',
          'blocked-uri': 'inline',
          'source-file': 'https://example.com/index.html',
          'line-number': 42,
        },
      }),
    })
    expect(res.status).toBe(204)
  })

  test('accepts Reporting API batch (application/reports+json)', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/reports+json' },
      body: JSON.stringify([
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
      ]),
    })
    expect(res.status).toBe(204)
  })

  test('accepts legacy format sent as application/json', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        'csp-report': {
          'violated-directive': 'style-src',
          'blocked-uri': 'inline',
        },
      }),
    })
    expect(res.status).toBe(204)
  })

  test('rejects malformed body with 400', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonsense: true }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects invalid JSON with 400', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
