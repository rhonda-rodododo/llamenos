/**
 * GDPR Compliance API Tests
 *
 * Consent recording, data export (self + admin), erasure request lifecycle.
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('GDPR Compliance', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'reviewer', 'reporter'],
      hubName: 'GDPR Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Consent ─────────────────────────────────────────────────────────────

  test.describe('Consent', () => {
    test('user can record consent', async () => {
      const res = await ctx.api('volunteer').post('/api/gdpr/consent', {
        version: '2026-03-22',
      })
      expect(res.status()).toBe(200)
    })

    test('user can check consent status', async () => {
      const res = await ctx.api('volunteer').get('/api/gdpr/consent')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.hasConsented).toBe(true)
      expect(body.consentVersion).toBe('2026-03-22')
    })

    test('all roles can manage their own consent', async () => {
      for (const role of ['reviewer', 'reporter'] as const) {
        const res = await ctx.api(role).post('/api/gdpr/consent', { version: '2026-03-22' })
        expect(res.status(), `${role} consent`).toBe(200)
      }
    })
  })

  // ─── Data Export ─────────────────────────────────────────────────────────

  test.describe('Data Export', () => {
    test('user can export own data', async () => {
      const res = await ctx.api('volunteer').get('/api/gdpr/export')
      expect(res.status()).toBe(200)
      // Should return a JSON file
      const contentType = res.headers()['content-type']
      expect(contentType).toContain('json')
    })

    test('admin can export any user data', async () => {
      const targetPubkey = ctx.user('volunteer').pubkey
      const res = await adminApi.get(`/api/gdpr/export/${targetPubkey}`)
      expect(res.status()).toBe(200)
    })

    test('user cannot export another users data', async () => {
      const targetPubkey = ctx.user('reviewer').pubkey
      const res = await ctx.api('volunteer').get(`/api/gdpr/export/${targetPubkey}`)
      expect(res.status()).toBe(403)
    })

    test('reporter cannot export data (no gdpr:export permission)', async () => {
      const res = await ctx.api('reporter').get('/api/gdpr/export')
      // Reporter role doesn't include gdpr:export
      expect(res.status()).toBe(403)
    })
  })

  // ─── Erasure Request Lifecycle ───────────────────────────────────────────

  test.describe('Erasure Requests', () => {
    test('user can request self-erasure', async () => {
      const res = await ctx.api('volunteer').delete('/api/gdpr/me')
      // Returns 202 Accepted (72-hour cooling period)
      expect(res.status()).toBe(202)
    })

    test('user can check pending erasure request', async () => {
      const res = await ctx.api('volunteer').get('/api/gdpr/me/erasure')
      expect(res.status()).toBe(200)
    })

    test('user can cancel erasure request', async () => {
      const res = await ctx.api('volunteer').delete('/api/gdpr/me/cancel')
      expect(res.status()).toBe(200)

      // Verify no pending request
      const checkRes = await ctx.api('volunteer').get('/api/gdpr/me/erasure')
      // Should be 404 (no pending) or 200 with null
      expect([200, 404]).toContain(checkRes.status())
    })

    test('admin can execute immediate erasure', async () => {
      const targetPubkey = ctx.user('reporter').pubkey
      const res = await adminApi.delete(`/api/gdpr/${targetPubkey}`)
      expect(res.status()).toBe(200)
    })

    test('user cannot execute admin erasure', async () => {
      const targetPubkey = ctx.user('reviewer').pubkey
      const res = await ctx.api('volunteer').delete(`/api/gdpr/${targetPubkey}`)
      expect(res.status()).toBe(403)
    })
  })

  // ─── Admin Erasure Request Listing ────────────────────────────────────────

  test.describe('Admin Erasure Request Listing', () => {
    test('admin can list all erasure requests', async () => {
      // Create a pending request first
      const createRes = await ctx.api('reviewer').delete('/api/gdpr/me')
      expect(createRes.status()).toBe(202)

      const res = await adminApi.get('/api/gdpr/erasure-requests')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.requests).toBeDefined()
      expect(Array.isArray(body.requests)).toBe(true)
      // Should contain the reviewer's pending request
      const reviewerReq = body.requests.find(
        (r: { pubkey: string }) => r.pubkey === ctx.user('reviewer').pubkey
      )
      expect(reviewerReq).toBeDefined()
      expect(reviewerReq.status).toBe('pending')
    })

    test('admin can filter by status', async () => {
      const res = await adminApi.get('/api/gdpr/erasure-requests?status=pending')
      expect(res.status()).toBe(200)
      const body = await res.json()
      for (const req of body.requests) {
        expect(req.status).toBe('pending')
      }
    })

    test('admin can filter by executed status', async () => {
      const res = await adminApi.get('/api/gdpr/erasure-requests?status=executed')
      expect(res.status()).toBe(200)
      const body = await res.json()
      // Reporter was erased earlier — should appear as executed
      for (const req of body.requests) {
        expect(req.status).toBe('executed')
      }
    })

    test('non-admin cannot list erasure requests', async () => {
      const res = await ctx.api('volunteer').get('/api/gdpr/erasure-requests')
      expect(res.status()).toBe(403)
    })

    test('cleanup: cancel reviewer erasure request', async () => {
      const res = await ctx.api('reviewer').delete('/api/gdpr/me/cancel')
      expect(res.status()).toBe(200)
    })
  })
})
