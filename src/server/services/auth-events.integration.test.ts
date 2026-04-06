import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { createDatabase } from '@server/db'
import { userAuthEvents } from '@server/db/schema'
import { CryptoService } from '@server/lib/crypto-service'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { AuthEventsService } from './auth-events'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

// Generate a valid x-only pubkey for envelope encryption
const testPrivKey = secp256k1.utils.randomSecretKey()
const testUser = bytesToHex(secp256k1.getPublicKey(testPrivKey, true).slice(1))

const otherPrivKey = secp256k1.utils.randomSecretKey()
const otherUser = bytesToHex(secp256k1.getPublicKey(otherPrivKey, true).slice(1))

let db: ReturnType<typeof createDatabase>
let service: AuthEventsService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  const crypto = new CryptoService('a'.repeat(64), 'b'.repeat(64))
  service = new AuthEventsService(db, crypto)
})

async function cleanup(): Promise<void> {
  await db.delete(userAuthEvents).where(eq(userAuthEvents.userPubkey, testUser))
  await db.delete(userAuthEvents).where(eq(userAuthEvents.userPubkey, otherUser))
}

beforeEach(cleanup)
afterAll(cleanup)

describe('AuthEventsService integration', () => {
  test('record + listForUser roundtrips', async () => {
    await service.record({
      userPubkey: testUser,
      eventType: 'login',
      payload: { sessionId: 's1', city: 'Berlin', country: 'DE' },
    })
    const rows = await service.listForUser(testUser)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.eventType).toBe('login')
    expect(rows[0]?.payloadEnvelope).toHaveLength(1)
  })

  test('listForUser returns newest first', async () => {
    await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    await new Promise((r) => setTimeout(r, 10))
    await service.record({ userPubkey: testUser, eventType: 'logout', payload: {} })
    const rows = await service.listForUser(testUser)
    expect(rows[0]?.eventType).toBe('logout')
    expect(rows[1]?.eventType).toBe('login')
  })

  test('listForUser respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    }
    const rows = await service.listForUser(testUser, { limit: 3 })
    expect(rows).toHaveLength(3)
  })

  test('markSuspicious sets reportedSuspiciousAt', async () => {
    const ev = await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    const updated = await service.markSuspicious(ev.id, testUser)
    expect(updated?.reportedSuspiciousAt).toBeTruthy()
  })

  test('markSuspicious returns null for wrong user', async () => {
    const ev = await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    const updated = await service.markSuspicious(ev.id, otherUser)
    expect(updated).toBeNull()
  })

  test('purgeOld removes entries before cutoff', async () => {
    const ev = await service.record({ userPubkey: testUser, eventType: 'login', payload: {} })
    const future = new Date(Date.now() + 1000)
    const count = await service.purgeOld(future)
    expect(count).toBeGreaterThanOrEqual(1)
    const rows = await service.listForUser(testUser)
    expect(rows.find((r) => r.id === ev.id)).toBeUndefined()
  })
})
