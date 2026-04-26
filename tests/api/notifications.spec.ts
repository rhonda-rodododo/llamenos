/**
 * Notification API Tests
 *
 * Tests the push notification subscription endpoints:
 * - GET /api/notifications/vapid-public-key (public)
 * - POST /api/notifications/subscribe (authenticated)
 * - DELETE /api/notifications/subscribe (authenticated)
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

// Structurally plausible fake push subscription values
const FAKE_KEYS = {
  auth: 'dGVzdC1hdXRoLWtleS10ZXN0',
  p256dh: 'BNcRdreALRFXTkOOUHK1EtdlMyWWyDo94-fqNiOXbhfMFLrKqLKGQ9lDR0HyqKWRxXNdX7bVEuMqT0VJQKIVKHU',
}

function fakeEndpoint(suffix: string): string {
  return `https://fcm.googleapis.com/fcm/send/test-${Date.now()}-${suffix}`
}

test.describe('Notification API', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Notifications Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── VAPID Public Key ────────────────────────────────────────────────────

  test('GET /api/notifications/vapid-public-key returns key (200) or 503 when not configured', async ({
    request,
  }) => {
    const res = await request.get('/api/notifications/vapid-public-key')
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    if (res.status() === 200) {
      expect(body).toHaveProperty('publicKey')
      expect(typeof body.publicKey).toBe('string')
      expect(body.publicKey.length).toBeGreaterThan(0)
    } else {
      expect(body).toHaveProperty('error')
    }
  })

  test('GET /api/notifications/vapid-public-key is accessible without authentication', async ({
    request,
  }) => {
    const res = await request.get('/api/notifications/vapid-public-key')
    // Must not require auth
    expect(res.status()).not.toBe(401)
    expect(res.status()).not.toBe(403)
  })

  // ─── Subscribe ──────────────────────────────────────────────────────────

  test('POST /api/notifications/subscribe rejects unauthenticated (401)', async ({ request }) => {
    const res = await request.post('/api/notifications/subscribe', {
      data: { endpoint: fakeEndpoint('unauth'), keys: FAKE_KEYS },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/notifications/subscribe rejects missing endpoint (400)', async () => {
    const res = await adminApi.post('/api/notifications/subscribe', {
      keys: FAKE_KEYS,
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/notifications/subscribe rejects missing keys (400)', async () => {
    const res = await adminApi.post('/api/notifications/subscribe', {
      endpoint: fakeEndpoint('nokeys'),
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/notifications/subscribe rejects missing auth key (400)', async () => {
    const res = await adminApi.post('/api/notifications/subscribe', {
      endpoint: fakeEndpoint('noauth'),
      keys: { p256dh: FAKE_KEYS.p256dh },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/notifications/subscribe stores subscription (200)', async () => {
    const endpoint = fakeEndpoint('subscribe')
    const res = await adminApi.post('/api/notifications/subscribe', {
      endpoint,
      keys: FAKE_KEYS,
      deviceLabel: 'Test Browser',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('id')
    expect(typeof body.id).toBe('string')
    expect(body.endpoint).toBe(endpoint)
    // deviceLabel is HPKE envelope-encrypted — server decrypts its own envelope
    expect(body.deviceLabel).toBe('Test Browser')
  })

  test('POST /api/notifications/subscribe works without optional deviceLabel (200)', async () => {
    const endpoint = fakeEndpoint('nolabel')
    const res = await adminApi.post('/api/notifications/subscribe', {
      endpoint,
      keys: FAKE_KEYS,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('id')
    expect(body.endpoint).toBe(endpoint)
    expect(body.deviceLabel).toBeNull()
  })

  // ─── Unsubscribe ─────────────────────────────────────────────────────────

  test('DELETE /api/notifications/subscribe rejects unauthenticated (401)', async ({ request }) => {
    const res = await request.delete('/api/notifications/subscribe', {
      data: { endpoint: fakeEndpoint('unauth-del') },
    })
    expect(res.status()).toBe(401)
  })

  test('DELETE /api/notifications/subscribe removes subscription (200)', async () => {
    // First subscribe
    const endpoint = fakeEndpoint('delete')
    const subRes = await adminApi.post('/api/notifications/subscribe', {
      endpoint,
      keys: FAKE_KEYS,
    })
    expect(subRes.status()).toBe(200)

    // Then unsubscribe
    const delRes = await adminApi.delete('/api/notifications/subscribe', { endpoint })
    expect(delRes.status()).toBe(200)
    const body = await delRes.json()
    expect(body).toHaveProperty('ok', true)
  })

  test('DELETE /api/notifications/subscribe rejects missing endpoint (400)', async () => {
    const res = await adminApi.delete('/api/notifications/subscribe', {})
    expect(res.status()).toBe(400)
  })
})
