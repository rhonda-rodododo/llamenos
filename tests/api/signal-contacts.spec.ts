/**
 * Signal contact API E2E tests.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey } from 'nostr-tools/pure'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Signal contact API', () => {
  test('GET /signal-contact returns null initially', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/signal-contact')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.contact).toBeNull()
  })

  test('GET /signal-contact/register-token is removed', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/signal-contact/register-token')
    // Removed endpoint — routing falls through past auth-facade to the
    // authenticated catch-all, returning 401 for unknown users. Either 404
    // or 401 indicates the endpoint is no longer reachable.
    expect([401, 404]).toContain(res.status())
  })

  test('GET /signal-contact/hmac-key returns per-user hex key', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/signal-contact/hmac-key')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.key).toMatch(/^[0-9a-f]{64}$/)
  })

  test('POST /signal-contact rejects missing plaintextIdentifier', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.post('/api/auth/signal-contact', {
      identifierHash: 'a'.repeat(64),
      identifierCiphertext: 'deadbeef',
      identifierEnvelope: [],
      identifierType: 'phone',
      // no plaintextIdentifier
    })
    expect(res.status()).toBe(400)
  })

  test('POST /signal-contact rejects invalid identifierType', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.post('/api/auth/signal-contact', {
      identifierHash: 'a'.repeat(64),
      identifierCiphertext: 'deadbeef',
      identifierEnvelope: [],
      identifierType: 'email',
      plaintextIdentifier: '+15551234567',
    })
    expect(res.status()).toBe(400)
  })
})
