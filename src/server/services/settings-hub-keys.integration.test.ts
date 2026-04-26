import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { hubKeys, hubs } from '@server/db/schema'
import { CryptoService } from '@server/lib/crypto-service'
import { HpkeService } from '@server/lib/hpke-service'
import { SettingsService } from '@server/services/settings'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'
const TEST_HUB_ID = `test-hub-envelopes-${crypto.randomUUID().slice(0, 8)}`

let db: ReturnType<typeof createDatabase>
let service: SettingsService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  const hpke = new HpkeService('a'.repeat(64))
  const crypto = new CryptoService('a'.repeat(64), 'b'.repeat(64), hpke)
  service = new SettingsService(db, crypto)
  // Create test hub (encrypted-only schema)
  await service.createHub({
    id: TEST_HUB_ID,
    name: 'Test Hub Envelopes',
    createdBy: 'test-admin',
  })
})

afterAll(async () => {
  await db.delete(hubKeys).where(eq(hubKeys.hubId, TEST_HUB_ID))
  await db.delete(hubs).where(eq(hubs.id, TEST_HUB_ID))
  db.$client.close()
})

function makeEnvelope(pubkeyHex: string) {
  return {
    pubkeyHex,
    envelope: { v: 3 as const, labelId: 0, enc: 'test', ct: 'test' },
  }
}

describe('hub-key-envelopes', () => {
  test('set 3 envelopes stores all 3', async () => {
    await service.setHubKeyEnvelopes(TEST_HUB_ID, [
      makeEnvelope('pk-alice'),
      makeEnvelope('pk-bob'),
      makeEnvelope('pk-carol'),
    ])

    const stored = await service.getHubKeyEnvelopes(TEST_HUB_ID)
    expect(stored.length).toBe(3)
    const pubkeys = stored.map((e) => e.pubkeyHex).sort()
    expect(pubkeys).toEqual(['pk-alice', 'pk-bob', 'pk-carol'])
  })

  test('replace with 2 envelopes leaves only 2 (no orphans)', async () => {
    await service.setHubKeyEnvelopes(TEST_HUB_ID, [makeEnvelope('pk-dave'), makeEnvelope('pk-eve')])

    const stored = await service.getHubKeyEnvelopes(TEST_HUB_ID)
    expect(stored.length).toBe(2)
    const pubkeys = stored.map((e) => e.pubkeyHex).sort()
    expect(pubkeys).toEqual(['pk-dave', 'pk-eve'])
  })

  test('replace with empty array removes all envelopes', async () => {
    await service.setHubKeyEnvelopes(TEST_HUB_ID, [])
    const stored = await service.getHubKeyEnvelopes(TEST_HUB_ID)
    expect(stored.length).toBe(0)
  })

  test('throws 404 for non-existent hub', async () => {
    await expect(
      service.setHubKeyEnvelopes('hub-does-not-exist', [makeEnvelope('pk-x')])
    ).rejects.toThrow()
  })
})
