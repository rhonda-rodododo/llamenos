/**
 * Lockdown API Integration Tests
 *
 * Tests POST /sessions/lockdown endpoint through HTTP.
 * Seeds a minimal users row for each test because the KEK proof verification
 * endpoints query the users table.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type postgres from 'postgres'
import { createAuthedRequest } from '../helpers/authed-request'
import { cleanupUser, openTestDb, seedUser } from '../helpers/seed-user'

let sql: ReturnType<typeof postgres>

test.beforeAll(() => {
  sql = openTestDb()
})

test.afterAll(async () => {
  if (sql) await sql.end()
})

test.describe('Lockdown API', () => {
  test('missing confirmation returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/sessions/lockdown', {
      tier: 'A',
      confirmation: 'NOT-LOCKDOWN',
      pinProof: 'x',
    })
    expect(res.status()).toBe(400)
  })

  test('invalid tier returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/sessions/lockdown', {
      tier: 'Z',
      confirmation: 'LOCKDOWN',
      pinProof: 'x',
    })
    expect(res.status()).toBe(400)
  })

  test('returns 409 when no KEK proof hash is set', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await seedUser(sql, pubkey)
    try {
      const authed = createAuthedRequest(request, sk)
      const res = await authed.post('/api/auth/sessions/lockdown', {
        tier: 'A',
        confirmation: 'LOCKDOWN',
        pinProof: 'any-proof',
      })
      expect(res.status()).toBe(409)
    } finally {
      await cleanupUser(sql, pubkey)
    }
  })

  test('wrong proof returns 401 after hash is set', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await seedUser(sql, pubkey)
    try {
      const authed = createAuthedRequest(request, sk)
      const setRes = await authed.post('/api/auth/kek-proof', { proof: 'correct' })
      expect(setRes.status()).toBe(200)
      const res = await authed.post('/api/auth/sessions/lockdown', {
        tier: 'A',
        confirmation: 'LOCKDOWN',
        pinProof: 'wrong',
      })
      expect(res.status()).toBe(401)
    } finally {
      await cleanupUser(sql, pubkey)
    }
  })

  test('tier A runs lockdown with correct proof', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await seedUser(sql, pubkey)
    try {
      const authed = createAuthedRequest(request, sk)
      const setRes = await authed.post('/api/auth/kek-proof', { proof: 'correct' })
      expect(setRes.status()).toBe(200)
      const res = await authed.post('/api/auth/sessions/lockdown', {
        tier: 'A',
        confirmation: 'LOCKDOWN',
        pinProof: 'correct',
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.tier).toBe('A')
      expect(body.accountDeactivated).toBe(false)
      expect(typeof body.revokedSessions).toBe('number')
      expect(typeof body.deletedPasskeys).toBe('number')
    } finally {
      await cleanupUser(sql, pubkey)
    }
  })

  test('missing body returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/sessions/lockdown', {})
    expect(res.status()).toBe(400)
  })

  test('requires authentication', async ({ request }) => {
    const res = await request.post('/api/auth/sessions/lockdown', {
      headers: { 'content-type': 'application/json' },
      data: { tier: 'A', confirmation: 'LOCKDOWN', pinProof: 'x' },
    })
    expect(res.status()).toBe(401)
  })
})
