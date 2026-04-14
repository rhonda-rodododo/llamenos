/**
 * Integration tests for DeviceService against a live Postgres instance.
 *
 * The unit-test suite (`device-service.test.ts`) uses an in-memory fake that
 * doesn't evaluate Drizzle `where` conditions, so it cannot detect a missing
 * `isNull(revokedAt)` filter on `findDeviceBySigningPubkey`. These tests run
 * the real SQL and assert that a revoked device with a matching pubkey is
 * **not** returned — the property that makes the resolver safe to use as an
 * audit-chain signer lookup.
 *
 * Requires `bun run dev:docker` (or `DATABASE_URL` pointing at a running
 * Postgres). Skipped gracefully if the DB is unreachable — the unit suite
 * still covers the rest of the service.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { userDevices } from '@server/db/schema'
import { DeviceService } from '@server/services/device-service'
import { inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

const RUN_PREFIX = `test-device-${crypto.randomUUID().slice(0, 8)}`
const USER_ID = `${RUN_PREFIX}-user`
const ACTIVE_DEVICE_ID = `${RUN_PREFIX}-active`
const REVOKED_DEVICE_ID = `${RUN_PREFIX}-revoked`
const ACTIVE_SIGNING_PUBKEY = `${RUN_PREFIX}-active-sig`
const REVOKED_SIGNING_PUBKEY = `${RUN_PREFIX}-revoked-sig`

let db: ReturnType<typeof createDatabase>
let service: DeviceService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  service = new DeviceService(db)
})

async function cleanup(): Promise<void> {
  await db
    .delete(userDevices)
    .where(inArray(userDevices.deviceId, [ACTIVE_DEVICE_ID, REVOKED_DEVICE_ID]))
}

beforeEach(cleanup)
afterAll(cleanup)

async function seedActive(): Promise<void> {
  await service.registerDevice({
    deviceId: ACTIVE_DEVICE_ID,
    userId: USER_ID,
    signingPubkey: ACTIVE_SIGNING_PUBKEY,
    encryptionPubkey: `${RUN_PREFIX}-active-enc`,
    encryptedDisplayName: 'enc:active',
    addedSigchainEntryId: `${RUN_PREFIX}-entry-1`,
  })
}

async function seedRevoked(signingPubkey: string): Promise<void> {
  await service.registerDevice({
    deviceId: REVOKED_DEVICE_ID,
    userId: USER_ID,
    signingPubkey,
    encryptionPubkey: `${RUN_PREFIX}-revoked-enc`,
    encryptedDisplayName: 'enc:revoked',
    addedSigchainEntryId: `${RUN_PREFIX}-entry-2`,
  })
  await service.revokeDevice({
    deviceId: REVOKED_DEVICE_ID,
    revokedBySigchainEntryId: `${RUN_PREFIX}-entry-revoke`,
    revokedReason: 'test',
  })
}

describe('DeviceService.findDeviceBySigningPubkey (integration)', () => {
  test('returns active device when a matching active row exists', async () => {
    await seedActive()
    const found = await service.findDeviceBySigningPubkey(ACTIVE_SIGNING_PUBKEY)
    expect(found).not.toBeNull()
    expect(found?.deviceId).toBe(ACTIVE_DEVICE_ID)
    expect(found?.revokedAt).toBeNull()
  })

  test('returns null when the only matching device is revoked', async () => {
    // Adversarial case: the pubkey matches, but the device was revoked. A
    // naive lookup without `isNull(revokedAt)` would return this row and
    // mis-verify signatures as coming from a live device.
    await seedRevoked(REVOKED_SIGNING_PUBKEY)
    const found = await service.findDeviceBySigningPubkey(REVOKED_SIGNING_PUBKEY)
    expect(found).toBeNull()
  })

  test('returns null when no device matches', async () => {
    const found = await service.findDeviceBySigningPubkey(`${RUN_PREFIX}-missing`)
    expect(found).toBeNull()
  })
})

describe('DeviceService.listActiveDevices (integration)', () => {
  test('excludes revoked devices from active list', async () => {
    await seedActive()
    await seedRevoked(REVOKED_SIGNING_PUBKEY)
    const active = await service.listActiveDevices(USER_ID)
    expect(active.map((d) => d.deviceId)).toEqual([ACTIVE_DEVICE_ID])
  })
})
