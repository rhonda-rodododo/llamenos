/**
 * Recovery rotate API Integration Tests
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

test.describe('Recovery rotate API', () => {
  test('invalid body returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/recovery/rotate', {})
    expect(res.status()).toBe(400)
  })

  test('returns 409 when no KEK proof hash is set', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await seedUser(sql, pubkey)
    try {
      const authed = createAuthedRequest(request, sk)
      const res = await authed.post('/api/auth/recovery/rotate', {
        currentPinProof: 'a'.repeat(64),
        newEncryptedSecretKey: 'ciphertext-stub',
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
      await authed.post('/api/auth/kek-proof', { proof: 'right' })
      const res = await authed.post('/api/auth/recovery/rotate', {
        currentPinProof: 'wrong',
        newEncryptedSecretKey: 'ciphertext-stub',
      })
      expect(res.status()).toBe(401)
    } finally {
      await cleanupUser(sql, pubkey)
    }
  })

  test('correct proof returns 200', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await seedUser(sql, pubkey)
    try {
      const authed = createAuthedRequest(request, sk)
      await authed.post('/api/auth/kek-proof', { proof: 'right' })
      const res = await authed.post('/api/auth/recovery/rotate', {
        currentPinProof: 'right',
        newEncryptedSecretKey: 'ciphertext-stub',
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
    } finally {
      await cleanupUser(sql, pubkey)
    }
  })

  test('requires authentication', async ({ request }) => {
    const res = await request.post('/api/auth/recovery/rotate', {
      headers: { 'content-type': 'application/json' },
      data: { currentPinProof: 'x', newEncryptedSecretKey: 'y' },
    })
    expect(res.status()).toBe(401)
  })
})
