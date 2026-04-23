import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

test.describe('Signal Automated Registration', () => {
  test('rejects invalid bridge URL', async ({ request }) => {
    const api = createAdminApiFromStorageState(request)
    const res = await api.post('/api/messaging/signal/register', {
      bridgeUrl: 'not-a-url',
      registeredNumber: '+15551234567',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('rejects non-HTTPS bridge URL', async ({ request }) => {
    const api = createAdminApiFromStorageState(request)
    const res = await api.post('/api/messaging/signal/register', {
      bridgeUrl: 'http://signal-bridge.example.com:8080',
      registeredNumber: '+15551234567',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('HTTPS')
  })

  test('registration status endpoint returns valid state', async ({ request }) => {
    const api = createAdminApiFromStorageState(request)
    const res = await api.get('/api/messaging/signal/registration-status')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // Status should be one of the valid states
    // (may be 'pending' if another parallel test triggered a registration)
    expect(['idle', 'complete', 'pending']).toContain(body.status)
  })

  test('bridge connection failure returns 502 and rolls back pending state', async ({
    request,
  }) => {
    const api = createAdminApiFromStorageState(request)
    // Use a valid HTTPS URL that won't connect (port that's not listening)
    const res = await api.post('/api/messaging/signal/register', {
      bridgeUrl: 'https://signal-bridge-nonexistent.example.com:9999',
      registeredNumber: '+15551234567',
    })
    // Should get 502 because the bridge is unreachable (or 409 if another test set pending)
    expect([502, 409]).toContain(res.status())
    const body = await res.json()
    expect(body.error).toBeTruthy()

    // After a 502 failure, pending state should be rolled back
    if (res.status() === 502) {
      const statusRes = await api.get('/api/messaging/signal/registration-status')
      expect(statusRes.ok()).toBeTruthy()
      const statusBody = await statusRes.json()
      // Should be idle (rolled back) or complete (already configured)
      expect(['idle', 'complete']).toContain(statusBody.status)
    }
  })

  test('verify without pending registration returns 404 or error', async ({ request }) => {
    const api = createAdminApiFromStorageState(request)
    const res = await api.post('/api/messaging/signal/verify', { code: '123456' })
    // 404 if no pending registration, 400 if verification fails, 200 if a parallel test left pending state
    expect([200, 400, 404]).toContain(res.status())
    if (res.status() === 404) {
      const body = await res.json()
      expect(body.error).toContain('No pending')
    }
  })

  test('rejects invalid verification code format', async ({ request }) => {
    const api = createAdminApiFromStorageState(request)
    const res = await api.post('/api/messaging/signal/verify', { code: 'abc' })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('6 digits')
  })

  test('rejects missing required fields', async ({ request }) => {
    const api = createAdminApiFromStorageState(request)
    const res = await api.post('/api/messaging/signal/register', {
      bridgeUrl: 'https://signal-bridge.example.com',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required|expected string/i)
  })

  test('Signal admin section loads', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/signal')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute('data-section', 'signal')
    await expect(adminPage.getByTestId('admin-section-heading')).toBeVisible({ timeout: 10000 })
  })
})
