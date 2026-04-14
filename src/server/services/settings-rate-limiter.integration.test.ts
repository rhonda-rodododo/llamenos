import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { rateLimitCounters } from '@server/db/schema'
import { CryptoService } from '@server/lib/crypto-service'
import { SettingsService } from '@server/services/settings'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'
const KEY_PREFIX = `test-rl-${crypto.randomUUID()}`

let db: ReturnType<typeof createDatabase>
let service: SettingsService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  service = new SettingsService(db, new CryptoService('', ''))
})

afterAll(async () => {
  await db.delete(rateLimitCounters).where(sql`${rateLimitCounters.key} LIKE ${`${KEY_PREFIX}%`}`)
  db.$client.close()
})

describe('rate-limiter', () => {
  test('first call is not blocked', async () => {
    const key = `${KEY_PREFIX}-a`
    const blocked = await service.checkRateLimit(key, 3)
    expect(blocked).toBe(false)
  })

  test('calls within limit are not blocked', async () => {
    const key = `${KEY_PREFIX}-b`
    // maxPerMinute = 2; first two calls should not be blocked
    expect(await service.checkRateLimit(key, 2)).toBe(false) // count=1
    expect(await service.checkRateLimit(key, 2)).toBe(false) // count=2
  })

  test('call exceeding limit is blocked', async () => {
    const key = `${KEY_PREFIX}-c`
    // maxPerMinute = 2; third call has count=3, 3 > 2 → blocked
    await service.checkRateLimit(key, 2) // 1
    await service.checkRateLimit(key, 2) // 2
    const blocked = await service.checkRateLimit(key, 2) // 3
    expect(blocked).toBe(true)
  })

  test('window expiry resets counter', async () => {
    const key = `${KEY_PREFIX}-d`
    // Exhaust the limit
    await service.checkRateLimit(key, 1) // count=1, not blocked
    expect(await service.checkRateLimit(key, 1)).toBe(true) // count=2, blocked

    // Simulate the window having expired by backdating the windowStart
    const oldWindow = new Date(Date.now() - 2 * 60 * 1000) // 2 minutes ago
    await db
      .update(rateLimitCounters)
      .set({ windowStart: oldWindow })
      .where(eq(rateLimitCounters.key, key))

    // Next call should see old windowStart < current floor → reset count to 1 → not blocked
    const blocked = await service.checkRateLimit(key, 1)
    expect(blocked).toBe(false)
  })
})
