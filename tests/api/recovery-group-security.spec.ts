/**
 * Recovery Group endpoint security — API E2E.
 *
 * Exercises the Tier 2 P0 hardening of /api/auth/recovery-group/*:
 *
 *   1. GET  /:hubId       — MUST require a bearer token (leaks group config)
 *   2. GET  /session/:id  — MUST require a bearer token (leaks session state)
 *   3. POST /initiate     — MUST per-IP rate limit anonymous initiate attempts
 *
 * These routes used to be anonymous, which exposed the Shamir group config
 * (threshold / totalShares / group public key) and the running session status
 * to any unauthenticated caller, and let an attacker spray initiate requests
 * to enumerate user identifiers or exhaust the recovery_sessions table.
 *
 * The rate-limit window is 10 req / 5 min / IP (see recovery-group.ts). To
 * keep the window isolated across worker ordering + reruns, every request in
 * this file stamps a unique X-Forwarded-For header per test.
 */

import { expect, test } from '@playwright/test'

// Relative path — Playwright attaches the configured baseURL (honors
// PLAYWRIGHT_BASE_URL for CI / local overrides).
const BASE = '/api/auth/recovery-group'

// Unique per-file source prefix so the in-process rate-limit counter in
// recovery-group.ts (per-IP) does not collide with other tests or the
// previous watch-mode run.
const SOURCE_PREFIX = `10.77.${Math.floor(Math.random() * 200) + 10}`

test.describe('recovery-group endpoint security', () => {
  test('GET /:hubId returns 401 without a bearer token', async ({ request }) => {
    const hubId = '11111111-2222-4333-8444-555555555555'
    const res = await request.get(`${BASE}/${hubId}`, {
      headers: { 'X-Forwarded-For': `${SOURCE_PREFIX}.1` },
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/Authorization/i)
  })

  test('GET /:hubId still returns 401 with a malformed bearer token', async ({ request }) => {
    const hubId = '11111111-2222-4333-8444-555555555555'
    const res = await request.get(`${BASE}/${hubId}`, {
      headers: {
        Authorization: 'Bearer not.a.real.jwt',
        'X-Forwarded-For': `${SOURCE_PREFIX}.2`,
      },
    })
    expect(res.status()).toBe(401)
  })

  test('GET /session/:id returns 401 without a bearer token', async ({ request }) => {
    const sessionId = '22222222-3333-4444-8555-666666666666'
    const res = await request.get(`${BASE}/session/${sessionId}`, {
      headers: { 'X-Forwarded-For': `${SOURCE_PREFIX}.3` },
    })
    expect(res.status()).toBe(401)
  })

  test('GET /session/:id still returns 401 with a malformed bearer token', async ({ request }) => {
    const sessionId = '22222222-3333-4444-8555-666666666666'
    const res = await request.get(`${BASE}/session/${sessionId}`, {
      headers: {
        Authorization: 'Bearer not.a.real.jwt',
        'X-Forwarded-For': `${SOURCE_PREFIX}.4`,
      },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /initiate rate limits anonymous callers after 10 requests per IP', async ({
    request,
  }) => {
    // Use an isolated IP so the per-IP counter starts at zero.
    const ip = `${SOURCE_PREFIX}.250`
    const headers = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    }
    // Body is valid enough to pass zod but the hub/user will not exist, so
    // each request 200s on the rate limiter and 404s at the service layer.
    // Either outcome counts toward the rate-limit budget; what we care about
    // is that after the 10th request the 11th comes back 429.
    const body = {
      hubId: '11111111-2222-4333-8444-555555555555',
      userIdentifier: 'rate-limit-probe@example.test',
      newDevicePubkey: 'a'.repeat(64),
    }

    // First 10 requests should NOT be 429 (they may be 400/404/500 depending
    // on service state — but never 429 since we are under the limit).
    for (let i = 0; i < 10; i++) {
      const res = await request.post(`${BASE}/initiate`, { headers, data: body })
      expect(res.status()).not.toBe(429)
    }
    // 11th request: the rate limiter should now reject.
    const overflow = await request.post(`${BASE}/initiate`, { headers, data: body })
    expect(overflow.status()).toBe(429)
    const overflowBody = await overflow.json()
    expect(overflowBody.error).toMatch(/too many/i)
  })
})
