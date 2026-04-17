/**
 * Security prefs API E2E tests.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey } from 'nostr-tools/pure'
import { createAuthedRequest } from '../helpers/authed-request'

test.describe('Security prefs API', () => {
  test('GET returns defaults on first access', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/security-prefs')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.autoLockMs).toBe(900000)
    expect(body.digestCadence).toBe('weekly')
    expect(body.disappearingTimerDays).toBe(1)
    expect(body.alertOnNewDevice).toBe(true)
    expect(body.alertOnPasskeyChange).toBe(true)
    expect(body.alertOnPinChange).toBe(true)
  })

  test('PATCH updates autoLockMs', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      autoLockMs: 300_000,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.autoLockMs).toBe(300_000)
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

  test('PATCH rejects autoLockMs below minimum', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      autoLockMs: 1000,
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH rejects autoLockMs above maximum', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      autoLockMs: 99_999_999,
    })
    expect(res.status()).toBe(400)
  })

  test('GET returns default notificationChannel as web_push', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.get('/api/auth/security-prefs')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.notificationChannel).toBe('web_push')
  })

  test('PATCH updates notificationChannel to signal', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      notificationChannel: 'signal',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.notificationChannel).toBe('signal')
  })

  test('PATCH updates notificationChannel back to web_push', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    // Set to signal first
    await authed.patch('/api/auth/security-prefs', { notificationChannel: 'signal' })
    // Then back to web_push
    const res = await authed.patch('/api/auth/security-prefs', {
      notificationChannel: 'web_push',
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.notificationChannel).toBe('web_push')
  })

  test('PATCH rejects invalid notificationChannel', async ({ request }) => {
    const authed = createAuthedRequest(request, generateSecretKey())
    const res = await authed.patch('/api/auth/security-prefs', {
      notificationChannel: 'telegram',
    })
    expect(res.status()).toBe(400)
  })
})
