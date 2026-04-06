/**
 * Passkeys API Integration Tests
 *
 * Tests the /api/auth/passkeys endpoint aliases and PATCH rename.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey } from 'nostr-tools/pure'
import { createAuthedRequest } from '../helpers/authed-request'

test.beforeAll(async ({ request }) => {
  try {
    const res = await request.get('/api/health/live', { timeout: 5000 })
    if (!res.ok()) {
      test.skip(true, 'Server not reachable')
    }
  } catch {
    test.skip(true, 'Server not reachable')
  }
})

test.describe('Passkeys API', () => {
  test('GET /passkeys returns credentials list', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.get('/api/auth/passkeys')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.credentials).toBeInstanceOf(Array)
  })

  test('PATCH /passkeys/:id with empty body returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.patch('/api/auth/passkeys/any-id', {})
    expect(res.status()).toBe(400)
  })

  test('PATCH /passkeys/:id with bogus id returns 404', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.patch('/api/auth/passkeys/nonexistent', { label: 'New Label' })
    expect(res.status()).toBe(404)
  })

  test('DELETE /passkeys/:id with bogus id returns 404', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.delete('/api/auth/passkeys/nonexistent')
    expect(res.status()).toBe(404)
  })
})
