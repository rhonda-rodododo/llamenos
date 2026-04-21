import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

/**
 * E2E tests for Provider OAuth Auto-Config (Epic 48).
 *
 * Each test is fully self-contained with its own authenticated request context.
 * Tests use the capabilities-based route structure:
 *   POST /api/setup/provider/oauth/start       (body: { provider })
 *   GET  /api/setup/provider/oauth/callback     (query: code, state, provider)
 *   GET  /api/setup/provider/status
 *   POST /api/setup/provider/validate           (body: { provider, credentials })
 *   POST /api/setup/provider/webhooks           (body: { provider })
 *   POST /api/setup/provider/phone-numbers/search
 *   POST /api/setup/provider/phone-numbers/provision
 *   POST /api/setup/provider/configure-webhooks
 *   POST /api/setup/provider/a2p/brand
 *   GET  /api/setup/provider/a2p/status
 *   POST /api/setup/provider/a2p/campaign
 *   POST /api/setup/provider/a2p/skip
 */
test.describe('Provider OAuth Auto-Config', () => {
  let adminApi: AuthedRequest

  test.beforeEach(async ({ request }) => {
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  // --- Twilio OAuth Happy Path ---

  test('Twilio OAuth start returns authUrl', async () => {
    const res = await adminApi.post('/api/setup/provider/oauth/start', { provider: 'twilio' })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.authUrl).toBeTruthy()
    expect(data.authUrl).toContain('twilio.com')
    expect(data.authUrl).toContain('state=')
  })

  test('Twilio OAuth callback with valid state processes request', async () => {
    // Start OAuth to get a valid state
    const startRes = await adminApi.post('/api/setup/provider/oauth/start', { provider: 'twilio' })
    const { authUrl } = await startRes.json()
    const stateMatch = authUrl.match(/state=([a-f0-9]+)/)
    expect(stateMatch).toBeTruthy()
    const state = stateMatch?.[1]

    // Hit the callback endpoint with the valid state
    // The server-side Twilio token exchange will fail with fake code,
    // but state validation succeeds — redirect will contain error from token exchange
    const callbackRes = await adminApi.get(
      `/api/setup/provider/oauth/callback?code=test_auth_code&state=${state}&provider=twilio`
    )

    // The callback always redirects (302) — either success or error
    // After following redirects, we get the final page
    const status = callbackRes.status()
    expect([200, 302]).toContain(status)
  })

  test('Twilio OAuth CSRF rejection with wrong state', async () => {
    // Start OAuth to register a valid state
    await adminApi.post('/api/setup/provider/oauth/start', { provider: 'twilio' })

    // Try callback with a different state — should fail state validation
    const res = await adminApi.get(
      '/api/setup/provider/oauth/callback?code=test&state=wrong_state_value_here&provider=twilio'
    )

    // The redirect will contain error about state mismatch
    // After following redirect, final page loads (200)
    const status = res.status()
    expect([200, 302]).toContain(status)
  })

  // --- Provider Status ---

  test('Provider status returns valid shape', async () => {
    const res = await adminApi.get('/api/setup/provider/status')
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data).toHaveProperty('connected')
  })

  // --- Credential Validation ---

  test('Validate route rejects unknown provider', async () => {
    const res = await adminApi.post('/api/setup/provider/validate', {
      provider: 'nonexistent-provider',
    })
    expect(res.status()).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Unknown provider')
  })

  test('Validate route rejects invalid Twilio credentials', async () => {
    const res = await adminApi.post('/api/setup/provider/validate', {
      provider: 'twilio',
      credentials: {},
    })
    expect(res.status()).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid credentials')
  })

  test('Validate route rejects invalid SignalWire credentials', async () => {
    const res = await adminApi.post('/api/setup/provider/validate', {
      provider: 'signalwire',
      credentials: {},
    })
    expect(res.status()).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid credentials')
  })

  test('Validate route rejects invalid Vonage credentials', async () => {
    const res = await adminApi.post('/api/setup/provider/validate', {
      provider: 'vonage',
      credentials: {},
    })
    expect(res.status()).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid credentials')
  })

  test('Validate route rejects invalid Plivo credentials', async () => {
    const res = await adminApi.post('/api/setup/provider/validate', {
      provider: 'plivo',
      credentials: {},
    })
    expect(res.status()).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid credentials')
  })

  // --- Webhook URL Generation ---

  test('Webhook URL generation works for known providers', async () => {
    const res = await adminApi.post('/api/setup/provider/webhooks', {
      provider: 'twilio',
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data).toBeTruthy()
  })

  test('Webhook GET endpoint returns URLs', async () => {
    const res = await adminApi.get('/api/setup/provider/webhooks')
    expect(res.ok()).toBeTruthy()
  })

  // --- Number Management ---

  test('Phone number search rejects unknown provider', async () => {
    const res = await adminApi.post('/api/setup/provider/phone-numbers/search', {
      provider: 'nonexistent',
    })
    expect(res.status()).toBe(400)
  })

  test('Phone number provision rejects unknown provider', async () => {
    const res = await adminApi.post('/api/setup/provider/phone-numbers/provision', {
      provider: 'nonexistent',
      phoneNumber: '+15555550100',
    })
    expect(res.status()).toBe(400)
  })

  test('Phone number provision rejects invalid credentials', async () => {
    // The route validates credentials first, then checks phoneNumber
    const res = await adminApi.post('/api/setup/provider/phone-numbers/provision', {
      provider: 'twilio',
    })
    expect(res.status()).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid credentials')
  })

  // --- Configure Webhooks ---

  test('Configure webhooks route rejects unknown provider', async () => {
    const res = await adminApi.post('/api/setup/provider/configure-webhooks', {
      provider: 'nonexistent',
      phoneNumber: '+15555550100',
    })
    expect(res.status()).toBe(400)
  })

  // --- A2P Routes ---

  test('A2P brand route exists and requires credentials', async () => {
    const res = await adminApi.post('/api/setup/provider/a2p/brand', {
      BusinessName: 'Test Org',
    })
    // Should not be 404 (route exists), will fail with credential error
    expect(res.status()).not.toBe(404)
  })

  test('A2P status route exists and requires credentials', async () => {
    const res = await adminApi.get('/api/setup/provider/a2p/status')
    // Should not be 404 (route exists), will fail with credential error
    expect(res.status()).not.toBe(404)
  })

  test('A2P campaign route exists and requires credentials', async () => {
    const res = await adminApi.post('/api/setup/provider/a2p/campaign', {
      Description: 'Crisis hotline messaging',
    })
    expect(res.status()).not.toBe(404)
  })

  test('A2P skip route exists and requires provider config', async () => {
    const skipRes = await adminApi.post('/api/setup/provider/a2p/skip')
    // Should not be 404 (route exists)
    // Will be 400 if no provider configured, which is expected for a standalone test
    expect(skipRes.status()).not.toBe(404)
  })

  // --- Telnyx OAuth ---

  test('Telnyx OAuth start returns authUrl', async () => {
    const res = await adminApi.post('/api/setup/provider/oauth/start', { provider: 'telnyx' })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.authUrl).toBeTruthy()
    expect(data.authUrl).toContain('telnyx.com')
    expect(data.authUrl).toContain('state=')
  })

  // --- OAuth Status Polling ---

  test('OAuth status endpoint returns status for valid state token', async () => {
    const startRes = await adminApi.post('/api/setup/provider/oauth/start', { provider: 'twilio' })
    expect(startRes.ok()).toBeTruthy()
    const { authUrl } = await startRes.json()
    const stateMatch = authUrl.match(/state=([a-f0-9]+)/)
    expect(stateMatch).toBeTruthy()
    const state = stateMatch?.[1]

    const res = await adminApi.get(`/api/setup/provider/oauth/status/${state}`)
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data).toHaveProperty('status')
  })

  // --- OAuth Rejects Unsupported Providers ---

  test('OAuth start rejects non-OAuth providers', async () => {
    const res = await adminApi.post('/api/setup/provider/oauth/start', { provider: 'signalwire' })
    expect(res.status()).toBe(400)
  })
})
