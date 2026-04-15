import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { pushSubscriptions } from '@server/db/schema'
import { CryptoService } from '@server/lib/crypto-service'
import { PushService } from '@server/services/push'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

// Unique prefix per run to avoid test cross-contamination
const RUN_PREFIX = `test-push-${crypto.randomUUID().slice(0, 8)}`

const PUBKEY_A = `${RUN_PREFIX}-pubkey-a`
const PUBKEY_B = `${RUN_PREFIX}-pubkey-b`

function makeEndpoint(label: string) {
  return `https://push.example.com/${RUN_PREFIX}/${label}`
}

let db: ReturnType<typeof createDatabase>
let service: PushService
let cryptoService: CryptoService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  cryptoService = new CryptoService('', '')
  service = new PushService(db, cryptoService)
  // Clean up any leftover data from previous failed runs
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.pubkey, PUBKEY_A))
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.pubkey, PUBKEY_B))
})

afterAll(async () => {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.pubkey, PUBKEY_A))
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.pubkey, PUBKEY_B))
  db.$client.close()
})

/** Helper: count subscriptions by endpointHash lookup */
async function countByEndpoint(endpoint: string): Promise<number> {
  const { HMAC_PHONE_PREFIX } = await import('@shared/crypto-labels')
  const hash = cryptoService.hmac(endpoint, HMAC_PHONE_PREFIX)
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpointHash, hash))
  return rows.length
}

describe('PushService', () => {
  test('subscribe creates a new push subscription', async () => {
    const endpoint = makeEndpoint('create-1')
    const sub = await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-1',
      p256dhKey: 'p256dh-key-1',
      deviceLabel: 'Chrome on Desktop',
    })

    expect(sub.id).toBeString()
    expect(sub.pubkey).toBe(PUBKEY_A)
    expect(sub.endpoint).toBe(endpoint)
    expect(sub.authKey).toBe('auth-key-1')
    expect(sub.p256dhKey).toBe('p256dh-key-1')
    // deviceLabel is server-encrypted and returned for API responses
    expect(sub.deviceLabel).toBe('Chrome on Desktop')
    expect(sub.createdAt).toBeString()
    expect(sub.updatedAt).toBeString()
  })

  test('subscribe upserts on duplicate endpoint', async () => {
    const endpoint = makeEndpoint('upsert-1')

    const first = await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-old',
      p256dhKey: 'p256dh-key-old',
    })

    // Re-subscribe with updated keys (browser rotated keys)
    const second = await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-new',
      p256dhKey: 'p256dh-key-new',
      deviceLabel: 'Firefox',
    })

    expect(second.id).toBe(first.id) // Same row
    expect(second.authKey).toBe('auth-key-new')
    expect(second.p256dhKey).toBe('p256dh-key-new')

    // Only one row for this endpoint
    expect(await countByEndpoint(endpoint)).toBe(1)
  })

  test('unsubscribe removes subscription by endpoint + pubkey', async () => {
    const endpoint = makeEndpoint('unsub-1')

    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-x',
      p256dhKey: 'p256dh-key-x',
    })

    await service.unsubscribe(endpoint, PUBKEY_A)

    expect(await countByEndpoint(endpoint)).toBe(0)
  })

  test('unsubscribe rejects mismatched pubkey', async () => {
    const endpoint = makeEndpoint('unsub-mismatch')

    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-y',
      p256dhKey: 'p256dh-key-y',
    })

    await expect(service.unsubscribe(endpoint, PUBKEY_B)).rejects.toThrow()

    // Subscription still exists
    expect(await countByEndpoint(endpoint)).toBe(1)
  })

  test('removeStaleSubscription deletes by endpoint', async () => {
    const endpoint = makeEndpoint('stale-1')

    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint,
      authKey: 'auth-key-z',
      p256dhKey: 'p256dh-key-z',
    })

    await service.removeStaleSubscription(endpoint)

    expect(await countByEndpoint(endpoint)).toBe(0)
  })

  test('getSubscriptionsForPubkeys returns all subscriptions for given pubkeys', async () => {
    const endpointA1 = makeEndpoint('multi-a1')
    const endpointA2 = makeEndpoint('multi-a2')
    const endpointB1 = makeEndpoint('multi-b1')

    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint: endpointA1,
      authKey: 'ak',
      p256dhKey: 'pk',
    })
    await service.subscribe({
      pubkey: PUBKEY_A,
      endpoint: endpointA2,
      authKey: 'ak',
      p256dhKey: 'pk',
    })
    await service.subscribe({
      pubkey: PUBKEY_B,
      endpoint: endpointB1,
      authKey: 'ak',
      p256dhKey: 'pk',
    })

    const results = await service.getSubscriptionsForPubkeys([PUBKEY_A, PUBKEY_B])

    const endpoints = results.map((r) => r.endpoint)
    expect(endpoints).toContain(endpointA1)
    expect(endpoints).toContain(endpointA2)
    expect(endpoints).toContain(endpointB1)

    // Should not contain subscriptions from other test cases that used different prefixes
    expect(results.every((r) => r.pubkey === PUBKEY_A || r.pubkey === PUBKEY_B)).toBeTrue()
  })

  describe('sendPushToUsers', () => {
    // Real VAPID keys (generated via web-push generateVAPIDKeys) — needed to pass setVapidDetails validation
    const VAPID_PUBLIC_KEY =
      'BIHy2drSLovwE23fZqeFSY64Q09aAckj0IEAaxrrUvz-Q5fPwKQ0a_X5kr5lGy9mwi2wk0YSTqdgkjnbTkbcq9A'
    const VAPID_PRIVATE_KEY = 't-vwcdqE1kB2Tj-VmH5iu4WuqwHKMYBY2_QLhQzwQm8'

    test('returns early when VAPID keys are missing', async () => {
      // Should not throw or touch the DB — just return silently
      await expect(
        service.sendPushToUsers(
          [PUBKEY_A],
          { type: 'call:ring', callSid: 'CA-test', hubId: 'global' },
          {}
        )
      ).resolves.toBeUndefined()
    })

    test('returns early when only one VAPID key is present', async () => {
      await expect(
        service.sendPushToUsers(
          [PUBKEY_A],
          { type: 'call:ring', callSid: 'CA-test', hubId: 'global' },
          { VAPID_PUBLIC_KEY }
        )
      ).resolves.toBeUndefined()
    })

    test('returns early with no subscriptions for given pubkeys', async () => {
      const noPubkey = `${RUN_PREFIX}-nobody`
      await expect(
        service.sendPushToUsers(
          [noPubkey],
          { type: 'call:ring', callSid: 'CA-nobody', hubId: 'global' },
          { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY }
        )
      ).resolves.toBeUndefined()
    })

    test('removes subscription when push delivery returns 410 Gone', async () => {
      const endpoint = makeEndpoint('push-410')

      await service.subscribe({
        pubkey: PUBKEY_A,
        endpoint,
        authKey: 'auth-410',
        p256dhKey: 'p256dh-410',
      })

      // Verify it exists
      expect(await countByEndpoint(endpoint)).toBe(1)

      // Mock web-push to throw a 410 error so removeStaleSubscription is called
      const webpushModule = await import('web-push')
      const originalSend = webpushModule.default.sendNotification.bind(webpushModule.default)

      // Temporarily replace sendNotification with a 410-throwing stub
      const stub410 = mock(async () => {
        const err = Object.assign(new Error('Gone'), { statusCode: 410 })
        throw err
      })
      webpushModule.default.sendNotification =
        stub410 as typeof webpushModule.default.sendNotification

      try {
        await service.sendPushToUsers(
          [PUBKEY_A],
          { type: 'call:ring', callSid: 'CA-410', hubId: 'global' },
          { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY }
        )
      } finally {
        // Restore original
        webpushModule.default.sendNotification = originalSend
      }

      // Subscription must have been deleted
      expect(await countByEndpoint(endpoint)).toBe(0)
    })

    test('does NOT remove subscription on non-410 push error', async () => {
      const endpoint = makeEndpoint('push-500')

      await service.subscribe({
        pubkey: PUBKEY_A,
        endpoint,
        authKey: 'auth-500',
        p256dhKey: 'p256dh-500',
      })

      const webpushModule = await import('web-push')
      const originalSend = webpushModule.default.sendNotification.bind(webpushModule.default)

      const stub500 = mock(async () => {
        const err = Object.assign(new Error('Internal Server Error'), { statusCode: 500 })
        throw err
      })
      webpushModule.default.sendNotification =
        stub500 as typeof webpushModule.default.sendNotification

      try {
        await service.sendPushToUsers(
          [PUBKEY_A],
          { type: 'call:ring', callSid: 'CA-500', hubId: 'global' },
          { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY }
        )
      } finally {
        webpushModule.default.sendNotification = originalSend
      }

      // Subscription must still exist (not removed for 500)
      expect(await countByEndpoint(endpoint)).toBe(1)
    })
  })
})
