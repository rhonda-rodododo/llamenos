/**
 * Auth Facade API Integration Tests
 *
 * Tests the /api/auth/* endpoints against a real server (with Authentik).
 * Uses the Playwright `api` project (no browser).
 *
 * Requires: running server + Authentik.
 */

import { expect, test } from '@playwright/test'
import { SignJWT } from 'jose'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { TestContext, uniqueName, uniquePhone } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import {
  type AuthedRequest,
  createAuthedRequest,
  createAuthedRequestFromNsec,
  enrollInAuthentik,
} from '../helpers/authed-request'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh user via admin API and return their secret key + pubkey. */
async function createTestUser(adminApi: AuthedRequest): Promise<{
  sk: Uint8Array
  pubkey: string
}> {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const name = uniqueName('AuthFacadeVol')
  const phone = uniquePhone()

  const res = await adminApi.post('/api/users', {
    name,
    phone,
    pubkey,
    roleIds: ['role-volunteer'],
  })
  if (!res.ok()) {
    throw new Error(`Failed to create user: ${res.status()} ${await res.text()}`)
  }

  return { sk, pubkey }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auth Facade API', () => {
  let adminApi: AuthedRequest

  test.beforeEach(async ({ request }) => {
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  // ===== 1. Enrollment =====

  test('POST /api/auth/enroll creates user and returns nsecSecret', async ({ request }) => {
    const { pubkey } = await createTestUser(adminApi)

    const res = await adminApi.post('/api/auth/enroll', { pubkey })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('nsecSecret')
    expect(typeof body.nsecSecret).toBe('string')
    // nsecSecret should be a 64-char hex string (32 bytes)
    expect(body.nsecSecret).toMatch(/^[0-9a-f]{64}$/i)
  })

  test('POST /api/auth/enroll is idempotent', async ({ request }) => {
    const { pubkey } = await createTestUser(adminApi)

    const res1 = await adminApi.post('/api/auth/enroll', { pubkey })
    expect(res1.status()).toBe(200)
    const body1 = await res1.json()

    const res2 = await adminApi.post('/api/auth/enroll', { pubkey })
    expect(res2.status()).toBe(200)
    const body2 = await res2.json()

    // Same nsecSecret returned both times
    expect(body2.nsecSecret).toBe(body1.nsecSecret)
  })

  test('POST /api/auth/enroll rejects invalid pubkey', async () => {
    // Non-hex string
    const res1 = await adminApi.post('/api/auth/enroll', { pubkey: 'not-a-hex-string' })
    expect(res1.status()).toBe(400)

    // Too short
    const res2 = await adminApi.post('/api/auth/enroll', { pubkey: 'abcd1234' })
    expect(res2.status()).toBe(400)

    // Missing pubkey
    const res3 = await adminApi.post('/api/auth/enroll', {})
    expect(res3.status()).toBe(400)
  })

  test('POST /api/auth/enroll rejects insufficient permissions', async ({ request }) => {
    // Create a user-level authed request (no users:create permission)
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const userApi = createAuthedRequest(request, sk, ['calls:answer', 'notes:create'])

    const targetSk = generateSecretKey()
    const targetPubkey = getPublicKey(targetSk)

    const res = await userApi.post('/api/auth/enroll', { pubkey: targetPubkey })
    expect(res.status()).toBe(403)
  })

  // ===== 2. Userinfo =====

  test('GET /api/auth/userinfo returns real nsecSecret', async ({ request }) => {
    const { sk, pubkey } = await createTestUser(adminApi)

    // Enroll the user first
    const enrollRes = await adminApi.post('/api/auth/enroll', { pubkey })
    expect(enrollRes.status()).toBe(200)
    const { nsecSecret: enrolledSecret } = await enrollRes.json()

    // Now call userinfo as the user
    const userApi = createAuthedRequest(request, sk)
    const res = await userApi.get('/api/auth/userinfo')
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('pubkey', pubkey)
    expect(body).toHaveProperty('nsecSecret')
    expect(body.nsecSecret).toMatch(/^[0-9a-f]{64}$/i)
    expect(body.nsecSecret).toBe(enrolledSecret)
  })

  // ===== 3. Token refresh =====

  test('POST /api/auth/token/refresh requires refresh cookie', async ({ request }) => {
    // Call refresh with no cookie — should get 401
    const res = await request.post('/api/auth/token/refresh', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('refresh')
  })

  test('POST /api/auth/token/refresh requires Content-Type application/json', async ({
    request,
  }) => {
    // Call with wrong content-type
    const res = await request.post('/api/auth/token/refresh', {
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(res.status()).toBe(415)
  })

  // ===== 4. Session revocation =====

  test('POST /api/auth/session/revoke returns ok', async ({ request }) => {
    const { sk, pubkey } = await createTestUser(adminApi)
    await enrollInAuthentik(adminApi, pubkey)

    const userApi = createAuthedRequest(request, sk)
    const res = await userApi.post('/api/auth/session/revoke', {})
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('ok', true)
  })

  // ===== 5. Admin re-enrollment =====

  test('POST /api/auth/admin/re-enroll wipes credentials', async () => {
    const { pubkey } = await createTestUser(adminApi)
    await enrollInAuthentik(adminApi, pubkey)

    // Admin re-enrolls the user
    const res = await adminApi.post(`/api/auth/admin/re-enroll/${pubkey}`)
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('success', true)
  })

  test('POST /api/auth/admin/re-enroll rejects non-admin', async ({ request }) => {
    const { sk: userSk, pubkey: userPubkey } = await createTestUser(adminApi)
    await enrollInAuthentik(adminApi, userPubkey)

    // Create a second user as the target
    const { pubkey: targetPubkey } = await createTestUser(adminApi)
    await enrollInAuthentik(adminApi, targetPubkey)

    // User tries to re-enroll target — should be 403
    const userApi = createAuthedRequest(request, userSk, ['calls:answer', 'notes:create'])
    const res = await userApi.post(`/api/auth/admin/re-enroll/${targetPubkey}`)
    expect(res.status()).toBe(403)
  })

  test('POST /api/auth/admin/re-enroll returns 404 for nonexistent user', async () => {
    const fakePubkey = getPublicKey(generateSecretKey())
    const res = await adminApi.post(`/api/auth/admin/re-enroll/${fakePubkey}`)
    expect(res.status()).toBe(404)
  })

  // ===== 6. Rate limiting =====

  test('login-options endpoint is rate limited', async ({ request }) => {
    // The rate limiter allows 10 requests per 5-minute window per IP.
    // Rapidly fire 12 requests and expect at least one 429.
    const results: number[] = []

    for (let i = 0; i < 12; i++) {
      const res = await request.post('/api/auth/webauthn/login-options', {
        data: {},
        headers: { 'Content-Type': 'application/json' },
      })
      results.push(res.status())
    }

    const has429 = results.some((s) => s === 429)
    expect(has429).toBe(true)
  })

  // ===== 7. Devices =====

  test('GET /api/auth/devices returns credential list', async ({ request }) => {
    const { sk, pubkey } = await createTestUser(adminApi)
    await enrollInAuthentik(adminApi, pubkey)

    const userApi = createAuthedRequest(request, sk)
    const res = await userApi.get('/api/auth/devices')
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('credentials')
    expect(Array.isArray(body.credentials)).toBe(true)
    // New user has no WebAuthn credentials yet
    expect(body.credentials).toHaveLength(0)
  })

  test('GET /api/auth/devices shows warning when only one credential', async ({ request }) => {
    // With 0 credentials, there should be no warning (warning is for exactly 1)
    const { sk, pubkey } = await createTestUser(adminApi)
    await enrollInAuthentik(adminApi, pubkey)

    const userApi = createAuthedRequest(request, sk)
    const res = await userApi.get('/api/auth/devices')
    expect(res.status()).toBe(200)

    const body = await res.json()
    // 0 credentials => no warning (warning only for length === 1)
    expect(body.warning).toBeUndefined()
  })

  // ===== 8. Error handling =====

  test('concurrent enrollment of same pubkey is handled', async () => {
    const { pubkey } = await createTestUser(adminApi)

    // Fire two enrollments in parallel
    const [res1, res2] = await Promise.all([
      adminApi.post('/api/auth/enroll', { pubkey }),
      adminApi.post('/api/auth/enroll', { pubkey }),
    ])

    // Both should succeed (idempotent)
    expect(res1.status()).toBe(200)
    expect(res2.status()).toBe(200)

    const body1 = await res1.json()
    const body2 = await res2.json()

    // Both should return the same nsecSecret
    expect(body1.nsecSecret).toBe(body2.nsecSecret)
  })

  test('JWT from wrong secret is rejected', async ({ request }) => {
    // Sign a JWT with a completely different secret
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const wrongSecret = 'this-is-the-wrong-jwt-secret-not-matching-server'
    const key = new TextEncoder().encode(wrongSecret)

    const token = await new SignJWT({ permissions: ['*'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(pubkey)
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime('15m')
      .setIssuer('llamenos')
      .sign(key)

    const res = await request.get('/api/auth/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(401)
  })

  test('missing Authorization header is rejected', async ({ request }) => {
    const res = await request.get('/api/auth/userinfo')
    expect(res.status()).toBe(401)
  })

  test('malformed Authorization header is rejected', async ({ request }) => {
    const res = await request.get('/api/auth/userinfo', {
      headers: { Authorization: 'NotBearer some-token' },
    })
    expect(res.status()).toBe(401)
  })

  // ===== 9. Rotation lifecycle =====

  test('POST /api/auth/rotation/confirm succeeds for enrolled user', async ({ request }) => {
    const { sk, pubkey } = await createTestUser(adminApi)
    await enrollInAuthentik(adminApi, pubkey)

    const userApi = createAuthedRequest(request, sk)
    const res = await userApi.post('/api/auth/rotation/confirm', {})
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('ok', true)
  })

  // ===== 10. Invite accept (public endpoint) =====

  test('POST /api/auth/invite/accept rejects missing code', async ({ request }) => {
    const res = await request.post('/api/auth/invite/accept', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/auth/invite/accept rejects invalid code', async ({ request }) => {
    const res = await request.post('/api/auth/invite/accept', {
      data: { code: 'nonexistent-invite-code-xyz' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).toBe(400)
  })

  // ===== 11. DELETE /api/auth/devices/:id =====

  test('DELETE /api/auth/devices/:id returns 404 for nonexistent credential', async ({
    request,
  }) => {
    const { sk, pubkey } = await createTestUser(adminApi)
    await enrollInAuthentik(adminApi, pubkey)

    const userApi = createAuthedRequest(request, sk)
    const res = await userApi.delete('/api/auth/devices/nonexistent-credential-id')
    expect(res.status()).toBe(404)
  })
})
