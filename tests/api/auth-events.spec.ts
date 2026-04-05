/**
 * Auth Events API Integration Tests
 *
 * Tests GET /events, POST /events/:id/report, GET /events/export.
 * Uses direct DB seeding since authed-request signs its own JWT without
 * going through the login flow that would emit events.
 */

import { expect, test } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import postgres from 'postgres'
import { createAuthedRequest } from '../helpers/authed-request'

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

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

async function seedEvent(pubkey: string, id: string, eventType: string) {
  await sql`
    INSERT INTO user_auth_events
      (id, user_pubkey, event_type, encrypted_payload, payload_envelope, created_at)
    VALUES
      (${id}, ${pubkey}, ${eventType}, 'dGVzdA==', '[]'::jsonb, NOW())
  `
}

async function cleanupEvents(pubkey: string) {
  await sql`DELETE FROM user_auth_events WHERE user_pubkey = ${pubkey}`
}

test.describe('Auth events API', () => {
  test('GET /events returns seeded events for the authed user', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const evId = crypto.randomUUID()
    try {
      await seedEvent(pubkey, evId, 'login')
      const authed = createAuthedRequest(request, sk)
      const res = await authed.get('/api/auth/events')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.events).toBeInstanceOf(Array)
      expect(body.events.some((e: { id: string }) => e.id === evId)).toBe(true)
    } finally {
      await cleanupEvents(pubkey)
    }
  })

  test('GET /events with limit caps results', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    try {
      for (let i = 0; i < 5; i++) {
        await seedEvent(pubkey, crypto.randomUUID(), 'login')
      }
      const authed = createAuthedRequest(request, sk)
      const res = await authed.get('/api/auth/events?limit=3')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.events.length).toBeLessThanOrEqual(3)
    } finally {
      await cleanupEvents(pubkey)
    }
  })

  test('GET /events with invalid limit returns 400', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.get('/api/auth/events?limit=9999')
    expect(res.status()).toBe(400)
  })

  test('POST /events/:id/report with non-existent id returns 404', async ({ request }) => {
    const sk = generateSecretKey()
    const authed = createAuthedRequest(request, sk)
    const res = await authed.post('/api/auth/events/00000000-0000-0000-0000-000000000000/report')
    expect(res.status()).toBe(404)
  })

  test('POST /events/:id/report marks an owned event as suspicious', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const evId = crypto.randomUUID()
    try {
      await seedEvent(pubkey, evId, 'login')
      const authed = createAuthedRequest(request, sk)
      const res = await authed.post(`/api/auth/events/${evId}/report`)
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      // Verify DB marker
      const rows = await sql<
        { reported_suspicious_at: Date | null }[]
      >`SELECT reported_suspicious_at FROM user_auth_events WHERE id = ${evId}`
      expect(rows[0]?.reported_suspicious_at).toBeTruthy()
    } finally {
      await cleanupEvents(pubkey)
    }
  })

  test('POST /events/:id/report does not affect other users events', async ({ request }) => {
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    const pubkeyA = getPublicKey(skA)
    const evId = crypto.randomUUID()
    try {
      await seedEvent(pubkeyA, evId, 'login')
      const authedB = createAuthedRequest(request, skB)
      const res = await authedB.post(`/api/auth/events/${evId}/report`)
      expect(res.status()).toBe(404)
    } finally {
      await cleanupEvents(pubkeyA)
    }
  })

  test('GET /events/export returns JSON envelope', async ({ request }) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const evId = crypto.randomUUID()
    try {
      await seedEvent(pubkey, evId, 'login')
      const authed = createAuthedRequest(request, sk)
      const res = await authed.get('/api/auth/events/export')
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.userPubkey).toBe(pubkey)
      expect(body.exportedAt).toBeTruthy()
      expect(body.events).toBeInstanceOf(Array)
      expect(body.events.some((e: { id: string }) => e.id === evId)).toBe(true)
    } finally {
      await cleanupEvents(pubkey)
    }
  })
})
