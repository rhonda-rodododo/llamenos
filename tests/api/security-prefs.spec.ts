/**
 * Security prefs API E2E tests.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey } from 'nostr-tools/pure'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Security prefs API', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const res = await request.get('/api/health/live', { timeout: 5000 })
      if (!res.ok()) test.skip(true, 'Server not reachable')
    } catch {
      test.skip(true, 'Server not reachable')
    }
  })

  test('GET returns defaults on first access', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/security-prefs')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.lockDelayMs).toBe(30000)
    expect(body.digestCadence).toBe('weekly')
    expect(body.disappearingTimerDays).toBe(1)
    expect(body.alertOnNewDevice).toBe(true)
    expect(body.alertOnPasskeyChange).toBe(true)
    expect(body.alertOnPinChange).toBe(true)
  })

  test('PATCH updates cadence', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      digestCadence: 'off',
      disappearingTimerDays: 3,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.digestCadence).toBe('off')
    expect(body.disappearingTimerDays).toBe(3)
  })

  test('PATCH rejects invalid disappearingTimerDays', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      disappearingTimerDays: 99,
    })
    expect(res.status()).toBe(400)
  })
})
