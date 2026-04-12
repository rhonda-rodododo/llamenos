import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { cors } from './cors'

const ORIGINAL_APP_ORIGIN = process.env.APP_ORIGIN

function makeApp(env: Record<string, string>) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    // biome-ignore lint/suspicious/noExplicitAny: env injection for middleware tests
    ;(c as any).env = env
    await next()
  })
  app.use('*', cors)
  app.get('/ok', (c) => c.text('ok'))
  return app
}

describe('cors middleware (Tier 4 PR-A)', () => {
  beforeEach(() => {
    process.env.APP_ORIGIN = 'https://app.llamenos.example'
  })
  afterEach(() => {
    if (ORIGINAL_APP_ORIGIN === undefined) process.env.APP_ORIGIN = undefined
    else process.env.APP_ORIGIN = ORIGINAL_APP_ORIGIN
  })

  test('allows configured APP_ORIGIN with credentials', async () => {
    const app = makeApp({})
    const res = await app.request('/ok', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.llamenos.example',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.llamenos.example')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  test('denies unknown origins (no CORS headers echoed)', async () => {
    const app = makeApp({})
    const res = await app.request('/ok', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  test('rejects "*" in CORS_ALLOWED_ORIGINS', async () => {
    const app = makeApp({ CORS_ALLOWED_ORIGINS: '*' })
    const res = await app.request('/ok', {
      method: 'GET',
      headers: { Origin: 'https://anything.example' },
    })
    // The middleware throws during request — Hono turns it into a 500.
    expect(res.status).toBe(500)
  })

  test('GET from allowed origin attaches Allow-Origin + credentials', async () => {
    const app = makeApp({})
    const res = await app.request('/ok', {
      method: 'GET',
      headers: { Origin: 'https://app.llamenos.example' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.llamenos.example')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  test('supports extra origins via CORS_ALLOWED_ORIGINS', async () => {
    const app = makeApp({ CORS_ALLOWED_ORIGINS: 'https://staging.llamenos.example' })
    const res = await app.request('/ok', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://staging.llamenos.example',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://staging.llamenos.example')
  })
})
