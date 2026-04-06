/**
 * Signal-only user invite enforcement E2E tests.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey } from 'nostr-tools/pure'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Signal-only user invites', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const res = await request.get('/api/health/live', { timeout: 5000 })
      if (!res.ok()) test.skip(true, 'Server not reachable')
    } catch {
      test.skip(true, 'Server not reachable')
    }
  })

  test('user invite send rejects sms channel', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    // Request body zod rejects unknown channel enum values at validation
    const res = await authed.post('/api/invites/FAKECODE123/send', {
      recipientPhone: '+15551234567',
      channel: 'sms',
    })
    // Zod validation rejects with 400/422 before route code runs
    expect([400, 401, 422]).toContain(res.status())
  })

  test('user invite send rejects whatsapp channel', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.post('/api/invites/FAKECODE123/send', {
      recipientPhone: '+15551234567',
      channel: 'whatsapp',
    })
    expect([400, 401, 422]).toContain(res.status())
  })
})
