/**
 * Sessions API Integration Tests
 *
 * Tests GET/DELETE /sessions endpoints through HTTP.
 * The authed-request helper signs its own JWT without creating a session row,
 * so we seed sessions directly in the DB via a raw postgres client.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import postgres from 'postgres'
import { hashSessionToken } from '../../src/server/lib/session-tokens'
import { createAuthedRequest } from '../helpers/authed-request'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

const HMAC_SECRET =
  process.env.HMAC_SECRET ?? '0000000000000000000000000000000000000000000000000000000000000000'

// Single SQL connection shared by this spec file.
let sql: ReturnType<typeof postgres>

test.beforeAll(async ({ request }) => {
  try {
    const res = await request.get('/api/health/live', { timeout: 5000 })
    if (!res.ok()) {
      test.skip(true, 'Server not reachable')
    }
  } catch {
    test.skip(true, 'Server not reachable')
  }
  sql = postgres(DATABASE_URL, { max: 2 })
})

test.afterAll(async () => {
  if (sql) await sql.end()
})

async function seedSession(pubkey: string, id: string, tokenHash: string) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  await sql`
    INSERT INTO user_sessions
      (id, user_pubkey, token_hash, ip_hash, credential_id,
       encrypted_meta, meta_envelope, expires_at)
    VALUES
      (${id}, ${pubkey}, ${tokenHash}, 'test-ip-hash', null,
       'dGVzdA==', '[]'::jsonb, ${expiresAt})
  `
}

async function cleanupSessionsForUser(pubkey: string) {
  await sql`DELETE FROM user_sessions WHERE user_pubkey = ${pubkey}`
}

test.describe('Sessions API', () => {
  test('GET /sessions returns seeded sessions for the authed user', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const authed = createAuthedRequest(request, sk)

    const sessionId = crypto.randomUUID()
    const rawToken = 'test-token-a'
    await seedSession(pubkey, sessionId, hashSessionToken(rawToken, HMAC_SECRET))

    try {
      const res = await authed.get('/api/auth/sessions')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.sessions).toBeInstanceOf(Array)
      expect(body.sessions.length).toBeGreaterThanOrEqual(1)
      const found = body.sessions.find((s: { id: string }) => s.id === sessionId)
      expect(found).toBeTruthy()
      expect(found.isCurrent).toBe(false)
      expect(found.encryptedMeta).toBe('dGVzdA==')
    } finally {
      await cleanupSessionsForUser(pubkey)
    }
  })

  test('DELETE /sessions/:id revokes the session', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const authed = createAuthedRequest(request, sk)

    const sessionId = crypto.randomUUID()
    await seedSession(pubkey, sessionId, hashSessionToken('tk-b', HMAC_SECRET))

    try {
      const delRes = await authed.delete(`/api/auth/sessions/${sessionId}`)
      expect(delRes.status()).toBe(200)

      const listRes = await authed.get('/api/auth/sessions')
      const body = await listRes.json()
      expect(body.sessions.find((s: { id: string }) => s.id === sessionId)).toBeUndefined()
    } finally {
      await cleanupSessionsForUser(pubkey)
    }
  })

  test('POST /sessions/revoke-others revokes all non-current sessions', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const authed = createAuthedRequest(request, sk)

    await seedSession(pubkey, crypto.randomUUID(), hashSessionToken('tk-c1', HMAC_SECRET))
    await seedSession(pubkey, crypto.randomUUID(), hashSessionToken('tk-c2', HMAC_SECRET))

    try {
      const res = await authed.post('/api/auth/sessions/revoke-others')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.revokedCount).toBeGreaterThanOrEqual(2)
    } finally {
      await cleanupSessionsForUser(pubkey)
    }
  })

  test('DELETE /sessions/:id for bogus id returns 404', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.delete('/api/auth/sessions/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(404)
  })

  test('Sessions are scoped per-user (no leakage)', async ({ request }) => {
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    const pubkeyA = getPublicKey(skA)
    const pubkeyB = getPublicKey(skB)

    const sessionA = crypto.randomUUID()
    await seedSession(pubkeyA, sessionA, hashSessionToken('tk-d1', HMAC_SECRET))

    try {
      const authedB = createAuthedRequest(request, skB)
      const res = await authedB.get('/api/auth/sessions')
      const body = await res.json()
      expect(body.sessions.find((s: { id: string }) => s.id === sessionA)).toBeUndefined()
    } finally {
      await cleanupSessionsForUser(pubkeyA)
      await cleanupSessionsForUser(pubkeyB)
    }
  })
})
