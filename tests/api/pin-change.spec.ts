/**
 * PIN change API Integration Tests
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

test.describe('PIN change API', () => {
  test('invalid body returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/pin/change', {})
    expect(res.status()).toBe(400)
  })

  test('returns 409 when no KEK proof hash is set', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await seedUser(sql, pubkey)
    try {
      const authed = createAuthedRequest(request, sk)
      const res = await authed.post('/api/auth/pin/change', {
        currentPinProof: 'a'.repeat(64),
        newKekProof: 'b'.repeat(64),
        newEncryptedSecretKey: 'ciphertext-stub',
      })
      expect(res.status()).toBe(409)
    } finally {
      await cleanupUser(sql, pubkey)
    }
  })

  test('wrong current proof returns 401 after hash is set', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await seedUser(sql, pubkey)
    try {
      const authed = createAuthedRequest(request, sk)
      const setRes = await authed.post('/api/auth/kek-proof', { proof: 'correct-proof' })
      expect(setRes.status()).toBe(200)
      const res = await authed.post('/api/auth/pin/change', {
        currentPinProof: 'wrong-proof',
        newKekProof: 'new-proof',
        newEncryptedSecretKey: 'ciphertext-stub',
      })
      expect(res.status()).toBe(401)
    } finally {
      await cleanupUser(sql, pubkey)
    }
  })

  test('correct proof returns 200 and rotates stored hash', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await seedUser(sql, pubkey)
    try {
      const authed = createAuthedRequest(request, sk)
      const setRes = await authed.post('/api/auth/kek-proof', { proof: 'current' })
      expect(setRes.status()).toBe(200)
      const res = await authed.post('/api/auth/pin/change', {
        currentPinProof: 'current',
        newKekProof: 'next',
        newEncryptedSecretKey: 'ciphertext-stub',
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      // Old proof is no longer valid
      const retry = await authed.post('/api/auth/pin/change', {
        currentPinProof: 'current',
        newKekProof: 'another',
        newEncryptedSecretKey: 'ciphertext-stub',
      })
      expect(retry.status()).toBe(401)
    } finally {
      await cleanupUser(sql, pubkey)
    }
  })

  test('requires authentication', async ({ request }) => {
    const res = await request.post('/api/auth/pin/change', {
      headers: { 'content-type': 'application/json' },
      data: { currentPinProof: 'x', newKekProof: 'y', newEncryptedSecretKey: 'z' },
    })
    expect(res.status()).toBe(401)
  })
})
