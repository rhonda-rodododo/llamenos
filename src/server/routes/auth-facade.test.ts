import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { IdPAdapter, NsecSecretRotation } from '../idp/adapter'
import type { IdentityService } from '../services/identity'
import type { SettingsService } from '../services/settings'
import type { WebAuthnCredential } from '../types'
import authFacade, { type AuthFacadeEnv, rateLimitStore } from './auth-facade'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const TEST_PUBKEY = 'ab'.repeat(32)
const TEST_CRED_ID = 'test-credential-id'
const TEST_JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!'
const TEST_HMAC_SECRET = 'aa'.repeat(32)

function createMockCredential(
  overrides: Partial<WebAuthnCredential & { ownerPubkey: string }> = {}
): WebAuthnCredential & { ownerPubkey: string } {
  return {
    id: TEST_CRED_ID,
    publicKey: 'dGVzdC1wdWJsaWMta2V5', // base64url
    counter: 0,
    transports: ['internal'],
    backedUp: false,
    label: 'Test Passkey',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ownerPubkey: TEST_PUBKEY,
    ...overrides,
  }
}

function createMockIdentity(overrides: Record<string, unknown> = {}): IdentityService {
  return {
    getAllWebAuthnCredentials: mock(() => Promise.resolve([createMockCredential()])),
    getWebAuthnCredentials: mock(() => Promise.resolve([createMockCredential()])),
    storeWebAuthnChallenge: mock(() => Promise.resolve()),
    getWebAuthnChallenge: mock(() => Promise.resolve('test-challenge')),
    updateWebAuthnCounter: mock(() => Promise.resolve()),
    addWebAuthnCredential: mock(() => Promise.resolve()),
    deleteWebAuthnCredential: mock(() => Promise.resolve()),
    getUser: mock(() =>
      Promise.resolve({
        pubkey: TEST_PUBKEY,
        name: 'Test User',
        phone: '+1234567890',
        roles: ['role-volunteer'],
        active: true,
        createdAt: new Date().toISOString(),
        encryptedSecretKey: '',
        transcriptionEnabled: true,
        spokenLanguages: ['en'],
        uiLanguage: 'en',
        profileCompleted: true,
        onBreak: false,
        callPreference: 'browser' as const,
      })
    ),
    validateInvite: mock(() => Promise.resolve({ valid: true, roleIds: ['role-volunteer'] })),
    ...overrides,
  } as unknown as IdentityService
}

function createMockIdpAdapter(overrides: Record<string, unknown> = {}): IdPAdapter {
  return {
    initialize: mock(() => Promise.resolve()),
    createUser: mock(() => Promise.resolve({ pubkey: TEST_PUBKEY, active: true, externalId: '1' })),
    getUser: mock(() => Promise.resolve({ pubkey: TEST_PUBKEY, active: true, externalId: '1' })),
    deleteUser: mock(() => Promise.resolve()),
    getNsecSecret: mock(() => Promise.resolve(new Uint8Array(32).fill(0xab))),
    rotateNsecSecret: mock(() =>
      Promise.resolve({ current: new Uint8Array(32) } as NsecSecretRotation)
    ),
    confirmRotation: mock(() => Promise.resolve()),
    refreshSession: mock(() => Promise.resolve({ valid: true })),
    revokeSession: mock(() => Promise.resolve()),
    revokeAllSessions: mock(() => Promise.resolve()),
    createInviteLink: mock(() => Promise.resolve('https://example.com/invite/abc')),
    ...overrides,
  } as unknown as IdPAdapter
}

function createMockSettings(overrides: Record<string, unknown> = {}): SettingsService {
  return {
    listRoles: mock(() =>
      Promise.resolve([
        {
          id: 'role-volunteer',
          name: 'Volunteer',
          permissions: [
            'calls:answer',
            'calls:read-active',
            'notes:create',
            'notes:read-own',
            'notes:update-own',
            'notes:reply',
            'shifts:read-own',
            'users:read',
          ],
          isDefault: true,
          isSystem: false,
          description: 'Answers calls and writes notes',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'role-super-admin',
          name: 'Super Admin',
          permissions: ['*'],
          isDefault: true,
          isSystem: true,
          description: 'Full system access',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])
    ),
    ...overrides,
  } as unknown as SettingsService
}

// ---------------------------------------------------------------------------
// Test app factory — injects mocked services via middleware
// ---------------------------------------------------------------------------

function createTestApp(
  opts: { identity?: IdentityService; idpAdapter?: IdPAdapter; settings?: SettingsService } = {}
) {
  const identity = opts.identity ?? createMockIdentity()
  const idpAdapter = opts.idpAdapter ?? createMockIdpAdapter()
  const settings = opts.settings ?? createMockSettings()

  const envBindings = {
    HMAC_SECRET: TEST_HMAC_SECRET,
    JWT_SECRET: TEST_JWT_SECRET,
    HOTLINE_NAME: 'Test Hotline',
    AUTH_WEBAUTHN_RP_ID: 'localhost',
    AUTH_WEBAUTHN_RP_NAME: 'Test Hotline',
    AUTH_WEBAUTHN_ORIGIN: 'http://localhost:3000',
  }

  const app = new Hono<AuthFacadeEnv>()

  // Simulate the middleware that app.ts will provide
  app.use('*', async (c, next) => {
    c.set('identity', identity)
    c.set('idpAdapter', idpAdapter)
    c.set('settings', settings)
    await next()
  })

  app.route('/auth', authFacade)

  // Wrap app.request to always inject env bindings
  const originalRequest = app.request.bind(app)
  const request: typeof app.request = (input, requestInit, envOrPath, executionCtx) => {
    return originalRequest(
      input,
      requestInit,
      { ...envBindings, ...((envOrPath as Record<string, string>) ?? {}) },
      executionCtx
    )
  }

  return { app: { ...app, request }, identity, idpAdapter, settings }
}

// Helper to get a valid access token for authenticated routes
async function getAccessToken(permissions = ['role-volunteer']): Promise<string> {
  const { signAccessToken } = await import('../lib/jwt')
  return signAccessToken({ pubkey: TEST_PUBKEY, permissions }, TEST_JWT_SECRET)
}

async function getAdminAccessToken(): Promise<string> {
  return getAccessToken(['users:update', 'users:read'])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth-facade', () => {
  beforeEach(() => {
    // Clear rate limit store between tests
    rateLimitStore.clear()
  })

  describe('POST /auth/webauthn/login-options', () => {
    test('returns challenge and options', async () => {
      const { app, identity } = createTestApp()
      const res = await app.request('/auth/webauthn/login-options', { method: 'POST' })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.challengeId).toBeDefined()
      expect(json.challenge).toBeDefined()
      expect(identity.storeWebAuthnChallenge).toHaveBeenCalled()
    })
  })

  describe('POST /auth/webauthn/login-verify', () => {
    test('returns 400 for invalid challenge', async () => {
      const identity = createMockIdentity({
        getWebAuthnChallenge: mock(() => Promise.reject(new Error('not found'))),
      })
      const { app } = createTestApp({ identity })
      const res = await app.request('/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assertion: { id: 'bad' }, challengeId: 'bad' }),
      })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('challenge')
    })

    test('returns 401 for unknown credential', async () => {
      const { app } = createTestApp()
      const res = await app.request('/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assertion: { id: 'nonexistent-id' }, challengeId: 'test' }),
      })
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toContain('Unknown credential')
    })
  })

  describe('POST /auth/invite/accept', () => {
    test('validates invite code', async () => {
      const { app } = createTestApp()
      const res = await app.request('/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'test-invite' }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.valid).toBe(true)
      expect(json.roles).toEqual(['role-volunteer'])
    })

    test('returns 400 for missing code', async () => {
      const { app } = createTestApp()
      const res = await app.request('/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    test('returns 400 for invalid invite', async () => {
      const identity = createMockIdentity({
        validateInvite: mock(() => Promise.resolve({ valid: false, error: 'not_found' })),
      })
      const { app } = createTestApp({ identity })
      const res = await app.request('/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'bad-code' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /auth/token/refresh', () => {
    test('requires Content-Type application/json (CSRF protection)', async () => {
      const { app } = createTestApp()
      const token = await getAccessToken()
      const res = await app.request('/auth/token/refresh', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body: '{}',
      })
      expect(res.status).toBe(415)
      const json = await res.json()
      expect(json.error).toContain('Content-Type')
    })

    test('returns 401 when no refresh cookie present', async () => {
      const { app } = createTestApp()
      const token = await getAccessToken()
      const res = await app.request('/auth/token/refresh', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toContain('refresh token')
    })
  })

  describe('GET /auth/userinfo', () => {
    test('returns nsec secret hex', async () => {
      const { app } = createTestApp()
      const token = await getAccessToken()
      const res = await app.request('/auth/userinfo', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.pubkey).toBe(TEST_PUBKEY)
      expect(json.nsecSecret).toBe('ab'.repeat(32))
    })

    test('returns 401 without auth header', async () => {
      const { app } = createTestApp()
      const res = await app.request('/auth/userinfo', { method: 'GET' })
      expect(res.status).toBe(401)
    })
  })

  describe('POST /auth/rotation/confirm', () => {
    test('calls idpAdapter.confirmRotation', async () => {
      const idpAdapter = createMockIdpAdapter()
      const { app } = createTestApp({ idpAdapter })
      const token = await getAccessToken()
      const res = await app.request('/auth/rotation/confirm', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
      expect(res.status).toBe(200)
      expect(idpAdapter.confirmRotation).toHaveBeenCalled()
    })
  })

  describe('POST /auth/session/revoke', () => {
    test('revokes session and clears cookie', async () => {
      const idpAdapter = createMockIdpAdapter()
      const { app } = createTestApp({ idpAdapter })
      const token = await getAccessToken()
      const res = await app.request('/auth/session/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
      expect(res.status).toBe(200)
      expect(idpAdapter.revokeSession).toHaveBeenCalled()
      // Check that the Set-Cookie header clears the refresh cookie
      const setCookieHeader = res.headers.get('Set-Cookie')
      expect(setCookieHeader).toContain('llamenos-refresh=')
      expect(setCookieHeader).toContain('Max-Age=0')
    })
  })

  describe('GET /auth/devices', () => {
    test('returns credential list', async () => {
      const { app } = createTestApp()
      const token = await getAccessToken()
      const res = await app.request('/auth/devices', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.credentials).toHaveLength(1)
      expect(json.credentials[0].id).toBe(TEST_CRED_ID)
      expect(json.credentials[0].label).toBe('Test Passkey')
      // Only 1 credential => warning
      expect(json.warning).toBeDefined()
    })

    test('no warning when multiple credentials', async () => {
      const identity = createMockIdentity({
        getWebAuthnCredentials: mock(() =>
          Promise.resolve([
            createMockCredential({ id: 'cred-1' }),
            createMockCredential({ id: 'cred-2' }),
          ])
        ),
      })
      const { app } = createTestApp({ identity })
      const token = await getAccessToken()
      const res = await app.request('/auth/devices', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.credentials).toHaveLength(2)
      expect(json.warning).toBeUndefined()
    })
  })

  describe('DELETE /auth/devices/:id', () => {
    test('deletes a credential', async () => {
      const identity = createMockIdentity()
      const { app } = createTestApp({ identity })
      const token = await getAccessToken()
      const res = await app.request(`/auth/devices/${TEST_CRED_ID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      expect(identity.deleteWebAuthnCredential).toHaveBeenCalledWith(TEST_PUBKEY, TEST_CRED_ID)
    })

    test('returns 404 for nonexistent credential', async () => {
      const identity = createMockIdentity({
        deleteWebAuthnCredential: mock(() => Promise.reject(new Error('not found'))),
      })
      const { app } = createTestApp({ identity })
      const token = await getAccessToken()
      const res = await app.request('/auth/devices/bad-id', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /auth/admin/re-enroll/:pubkey', () => {
    const TARGET_PUBKEY = 'cd'.repeat(32)

    test('revokes all sessions and deletes all credentials', async () => {
      const identity = createMockIdentity({
        getUser: mock(() =>
          Promise.resolve({
            pubkey: TARGET_PUBKEY,
            name: 'Target User',
            phone: '+9999999999',
            roles: ['role-volunteer'],
            active: true,
            createdAt: new Date().toISOString(),
            encryptedSecretKey: '',
            transcriptionEnabled: true,
            spokenLanguages: ['en'],
            uiLanguage: 'en',
            profileCompleted: true,
            onBreak: false,
            callPreference: 'browser' as const,
          })
        ),
        getWebAuthnCredentials: mock(() =>
          Promise.resolve([
            createMockCredential({ id: 'cred-1', ownerPubkey: TARGET_PUBKEY }),
            createMockCredential({ id: 'cred-2', ownerPubkey: TARGET_PUBKEY }),
          ])
        ),
        deleteWebAuthnCredential: mock(() => Promise.resolve()),
      })
      const idpAdapter = createMockIdpAdapter()
      const { app } = createTestApp({ identity, idpAdapter })
      const token = await getAdminAccessToken()
      const res = await app.request(`/auth/admin/re-enroll/${TARGET_PUBKEY}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(idpAdapter.revokeAllSessions).toHaveBeenCalledWith(TARGET_PUBKEY)
      expect(identity.deleteWebAuthnCredential).toHaveBeenCalledTimes(2)
    })

    test('returns 403 when requester lacks users:update permission', async () => {
      const { app } = createTestApp()
      const token = await getAccessToken(['role-volunteer'])
      const res = await app.request(`/auth/admin/re-enroll/${TARGET_PUBKEY}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(403)
    })

    test('returns 404 when target user does not exist', async () => {
      const identity = createMockIdentity({
        getUser: mock(() => Promise.resolve(null)),
      })
      const { app } = createTestApp({ identity })
      const token = await getAdminAccessToken()
      const res = await app.request(`/auth/admin/re-enroll/${TARGET_PUBKEY}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(404)
    })

    test('accepts wildcard * permission as admin', async () => {
      const identity = createMockIdentity({
        getWebAuthnCredentials: mock(() => Promise.resolve([])),
      })
      const idpAdapter = createMockIdpAdapter()
      const { app } = createTestApp({ identity, idpAdapter })
      const token = await getAccessToken(['*'])
      const res = await app.request(`/auth/admin/re-enroll/${TARGET_PUBKEY}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
    })

    test('returns 401 without auth header', async () => {
      const { app } = createTestApp()
      const res = await app.request(`/auth/admin/re-enroll/${TARGET_PUBKEY}`, {
        method: 'POST',
      })
      expect(res.status).toBe(401)
    })
  })

  describe('POST /auth/enroll', () => {
    test('creates user and returns nsecSecret with users:create permission', async () => {
      const idpAdapter = createMockIdpAdapter()
      const { app } = createTestApp({ idpAdapter })
      const token = await getAccessToken(['users:create'])
      const newPubkey = 'cd'.repeat(32)

      // User does not exist yet
      ;(idpAdapter.getUser as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(null)
      )

      const res = await app.request('/auth/enroll', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pubkey: newPubkey }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.nsecSecret).toBe('ab'.repeat(32))
      expect(idpAdapter.createUser).toHaveBeenCalledWith(newPubkey)
      expect(idpAdapter.getNsecSecret).toHaveBeenCalledWith(newPubkey)
    })

    test('is idempotent — returns existing nsecSecret without creating', async () => {
      const idpAdapter = createMockIdpAdapter()
      const { app } = createTestApp({ idpAdapter })
      const token = await getAccessToken(['users:create'])

      // User already exists
      const res = await app.request('/auth/enroll', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pubkey: TEST_PUBKEY }),
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.nsecSecret).toBe('ab'.repeat(32))
      // createUser should NOT have been called since user exists
      expect(idpAdapter.createUser).not.toHaveBeenCalled()
    })

    test('accepts wildcard * permission', async () => {
      const { app } = createTestApp()
      const token = await getAccessToken(['*'])
      const res = await app.request('/auth/enroll', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pubkey: TEST_PUBKEY }),
      })
      expect(res.status).toBe(200)
    })

    test('returns 403 with insufficient permissions', async () => {
      const { app } = createTestApp()
      const token = await getAccessToken(['role-volunteer'])
      const res = await app.request('/auth/enroll', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pubkey: TEST_PUBKEY }),
      })
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toBe('Forbidden')
    })

    test('returns 400 for invalid pubkey', async () => {
      const { app } = createTestApp()
      const token = await getAccessToken(['users:create'])

      // Too short
      const res1 = await app.request('/auth/enroll', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pubkey: 'abc' }),
      })
      expect(res1.status).toBe(400)

      // Not hex
      const res2 = await app.request('/auth/enroll', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pubkey: 'zz'.repeat(32) }),
      })
      expect(res2.status).toBe(400)

      // Missing
      const res3 = await app.request('/auth/enroll', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(res3.status).toBe(400)
    })

    test('returns 401 without auth header', async () => {
      const { app } = createTestApp()
      const res = await app.request('/auth/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey: TEST_PUBKEY }),
      })
      expect(res.status).toBe(401)
    })
  })

  describe('rate limiting', () => {
    test('blocks after 10 requests from same IP', async () => {
      const { app } = createTestApp()
      // Make 10 requests (should all succeed)
      for (let i = 0; i < 10; i++) {
        const res = await app.request('/auth/webauthn/login-options', {
          method: 'POST',
          headers: { 'X-Forwarded-For': '1.2.3.4' },
        })
        expect(res.status).toBe(200)
      }
      // 11th should be rate limited
      const res = await app.request('/auth/webauthn/login-options', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '1.2.3.4' },
      })
      expect(res.status).toBe(429)
    })
  })
})
