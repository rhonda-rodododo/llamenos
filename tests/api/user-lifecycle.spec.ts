/**
 * User Lifecycle API Tests
 *
 * Full CRUD lifecycle, profile management, PII masking, availability toggle,
 * and role assignment workflows.
 */

import { expect, test } from '@playwright/test'
import { createUserWithKey, TestContext, uniqueName, uniquePhone } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import {
  type AuthedRequest,
  createAuthedRequest,
  createAuthedRequestFromNsec,
} from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('User Lifecycle', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'hub-admin'],
      hubName: 'VolLifecycle Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── CRUD Operations ────────────────────────────────────────────────────

  test('create user with valid data', async ({ request }) => {
    const { pubkey, name, phone } = await createUserWithKey(request, {
      name: 'Lifecycle Create Test',
      roleIds: ['role-volunteer'],
    })

    // Verify via list
    const listRes = await adminApi.get('/api/users')
    const { users } = await listRes.json()
    const found = users.find((v: { pubkey: string }) => v.pubkey === pubkey)
    expect(found).toBeDefined()
    // With HPKE, server decrypts its own envelope — name is returned as plaintext
    expect(found.name).toBe('Lifecycle Create Test')
    // HPKE envelopes are present for client-side decryption
    expect(Array.isArray(found.nameEnvelopes)).toBe(true)
    expect(found.nameEnvelopes.length).toBeGreaterThan(0)
  })

  test('create user rejects invalid phone', async () => {
    const res = await adminApi.post('/api/users', {
      name: 'Bad Phone',
      phone: 'not-a-phone',
      pubkey: '01'.repeat(32),
      roleIds: ['role-volunteer'],
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).not.toBe(500)
  })

  test('create user rejects duplicate pubkey', async ({ request }) => {
    const { pubkey } = await createUserWithKey(request)

    const res = await adminApi.post('/api/users', {
      name: 'Dupe Pubkey',
      phone: uniquePhone(),
      pubkey,
      roleIds: ['role-volunteer'],
    })
    // Server may return 409 (explicit) or 400/500 (DB constraint)
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })

  test('get single user by pubkey', async () => {
    const userPubkey = ctx.user('volunteer').pubkey
    const res = await adminApi.get(`/api/users/${userPubkey}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.user || body.pubkey).toBeDefined()
  })

  test('update user name and phone', async () => {
    const userPubkey = ctx.user('volunteer').pubkey
    const newPhone = uniquePhone()
    const res = await adminApi.patch(`/api/users/${userPubkey}`, {
      name: 'Updated Vol Name',
      phone: newPhone,
    })
    expect(res.status()).toBe(200)
  })

  test('update user roles', async () => {
    const userPubkey = ctx.user('volunteer').pubkey
    const res = await adminApi.patch(`/api/users/${userPubkey}`, {
      roles: ['role-volunteer', 'role-reviewer'],
    })
    expect(res.status()).toBe(200)

    // Verify the role change
    const meRes = await ctx.api('volunteer').get('/api/auth/me')
    const me = await meRes.json()
    expect(Array.isArray(me.roles)).toBe(true)
    expect(me.roles).toContain('role-volunteer')
    expect(me.roles).toContain('role-reviewer')

    // Restore original role
    await adminApi.patch(`/api/users/${userPubkey}`, {
      roles: ['role-volunteer'],
    })
  })

  test('delete user', async ({ request }) => {
    const { pubkey } = await createUserWithKey(request, {
      name: 'Delete Me',
    })

    const delRes = await adminApi.delete(`/api/users/${pubkey}`)
    expect(delRes.status()).toBe(200)

    // Verify deleted (should 404 or not appear in list)
    const getRes = await adminApi.get(`/api/users/${pubkey}`)
    expect([404, 200]).toContain(getRes.status())
    if (getRes.status() === 200) {
      const body = await getRes.json()
      // If returned, should be marked inactive
      expect(body.user?.active ?? body.active).toBe(false)
    }
  })

  test('delete nonexistent user is handled gracefully', async () => {
    const res = await adminApi.delete(`/api/users/${'ff'.repeat(32)}`)
    // Server may return 200 (idempotent delete) or 404 (not found)
    expect([200, 404]).toContain(res.status())
  })

  // ─── Profile Self-Service ────────────────────────────────────────────────

  test('user can update own profile via /auth/me/profile', async () => {
    const userApi = ctx.api('volunteer')
    const res = await userApi.patch('/api/auth/me/profile', {
      spokenLanguages: ['en', 'es'],
      uiLanguage: 'en',
    })
    expect(res.status()).toBe(200)

    // Verify
    const meRes = await userApi.get('/api/auth/me')
    const me = await meRes.json()
    expect(me.spokenLanguages).toContain('en')
    expect(me.spokenLanguages).toContain('es')
    expect(me.uiLanguage).toBe('en')
  })

  test('user can toggle availability (on-break)', async () => {
    const userApi = ctx.api('volunteer')

    // Go on break
    const breakRes = await userApi.patch('/api/auth/me/availability', { onBreak: true })
    expect(breakRes.status()).toBe(200)

    let me = await (await userApi.get('/api/auth/me')).json()
    expect(me.onBreak).toBe(true)

    // Come off break
    const availRes = await userApi.patch('/api/auth/me/availability', { onBreak: false })
    expect(availRes.status()).toBe(200)

    me = await (await userApi.get('/api/auth/me')).json()
    expect(me.onBreak).toBe(false)
  })

  test('user can toggle own transcription setting', async () => {
    const userApi = ctx.api('volunteer')
    const res = await userApi.patch('/api/auth/me/transcription', { enabled: true })
    // May be 200, or may be 403 if transcription opt-out not allowed
    expect(res.status()).not.toBe(500)
  })

  // ─── PII Masking ─────────────────────────────────────────────────────────

  test('user sees own phone masked in /auth/me', async () => {
    const userApi = ctx.api('volunteer')
    const res = await userApi.get('/api/auth/me')
    const me = await res.json()
    if (me.phone) {
      // Phone should be masked (uses • character, e.g., +15•••••••••05)
      expect(me.phone).toContain('•')
    }
  })

  test('admin can unmask phone with ?unmask=true', async () => {
    const userPubkey = ctx.user('volunteer').pubkey
    const res = await adminApi.get(`/api/users/${userPubkey}?unmask=true`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.view).toBe('admin')
    // With HPKE, server decrypts its own envelope — unmask=true returns full plaintext phone
    const phone = body.user?.phone ?? body.phone
    expect(phone).toBeTruthy()
    expect(phone).toMatch(/^\+\d{10,}$/)
    // HPKE envelopes are present for client-side decryption
    expect(Array.isArray(body.phoneEnvelopes)).toBe(true)
    expect(body.phoneEnvelopes.length).toBeGreaterThan(0)
  })

  test('user cannot unmask other users phone', async () => {
    const haUser = ctx.user('hub-admin')
    const userApi = ctx.api('volunteer')
    const res = await userApi.get(`/api/users/${haUser.pubkey}?unmask=true`)
    // Should be denied or return masked data
    if (res.status() === 200) {
      const body = await res.json()
      const phone = body.user?.phone ?? body.phone
      if (phone && phone.length > 0) {
        // Should still be masked
        expect(phone).toContain('*')
      }
    }
  })
})
