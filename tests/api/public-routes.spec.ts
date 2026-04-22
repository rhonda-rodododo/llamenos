/**
 * Public (unauthenticated) route coverage.
 *
 * These routes must work without a session cookie or auth token:
 * - GET /api/ivr-audio/:promptType/:language — Twilio fetches during calls
 * - GET /api/messaging/preferences?token=X — subscriber self-service
 * - PATCH /api/messaging/preferences?token=X — subscriber self-service
 */

import { expect, test } from '@playwright/test'

test.describe('Public IVR audio endpoint', () => {
  test('returns 400 for invalid promptType (injection attempt)', async ({ request }) => {
    const res = await request.get('/api/ivr-audio/..%2Fetc%2Fpasswd/en')
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid')
  })

  test('returns 400 for invalid language code', async ({ request }) => {
    const res = await request.get('/api/ivr-audio/welcome/Invalid_Language!')
    expect(res.status()).toBe(400)
  })

  test('returns 400 for invalid hubId', async ({ request }) => {
    const res = await request.get('/api/ivr-audio/welcome/en?hubId=..%2F')
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('hubId')
  })

  test('returns 404 when audio not found (valid params, no recording)', async ({ request }) => {
    const res = await request.get('/api/ivr-audio/nonexistent-prompt/en')
    expect(res.status()).toBe(404)
  })

  test('accessible without authentication', async ({ request }) => {
    // 404 is expected (no audio uploaded), but importantly NOT 401/403
    const res = await request.get('/api/ivr-audio/welcome/en')
    expect([200, 404]).toContain(res.status())
  })

  test('accepts hub-scoped fetch via hubId query param', async ({ request }) => {
    const res = await request.get('/api/ivr-audio/welcome/en?hubId=default-hub')
    expect([200, 404]).toContain(res.status())
  })
})

test.describe('Public subscriber preferences endpoint', () => {
  test('GET returns 400 when token missing', async ({ request }) => {
    const res = await request.get('/api/messaging/preferences')
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('token')
  })

  test('GET returns 404 for invalid token', async ({ request }) => {
    const res = await request.get('/api/messaging/preferences?token=not-a-real-token')
    expect(res.status()).toBe(404)
  })

  test('PATCH returns 400 when token missing', async ({ request }) => {
    const res = await request.patch('/api/messaging/preferences', {
      data: { status: 'active' },
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH returns 404 for invalid token', async ({ request }) => {
    const res = await request.patch('/api/messaging/preferences?token=bogus', {
      data: { status: 'active' },
    })
    expect(res.status()).toBe(404)
  })

  test('PATCH rejects invalid status via zod schema', async ({ request }) => {
    const res = await request.patch('/api/messaging/preferences?token=bogus', {
      data: { status: 'whatever-invalid' },
    })
    // Schema rejects invalid enum before token lookup — must be 400
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Validation failed')
  })

  test('PATCH rejects oversized language field', async ({ request }) => {
    const res = await request.patch('/api/messaging/preferences?token=bogus', {
      data: { language: 'x'.repeat(100) },
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH rejects oversized tags array', async ({ request }) => {
    const res = await request.patch('/api/messaging/preferences?token=bogus', {
      data: { tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`) },
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH rejects oversized individual tag', async ({ request }) => {
    const res = await request.patch('/api/messaging/preferences?token=bogus', {
      data: { tags: ['x'.repeat(101)] },
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH accepts valid body shape (reaches token lookup, returns 404)', async ({
    request,
  }) => {
    // With a well-formed body but invalid token, should pass schema validation
    // and fail at token lookup (404, not 400).
    const res = await request.patch('/api/messaging/preferences?token=token-does-not-exist', {
      data: {
        status: 'unsubscribed',
        language: 'en',
        tags: ['tag-a', 'tag-b'],
      },
    })
    expect(res.status()).toBe(404)
  })
})
