import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { userSessions } from '@server/db/schema'
import type { Ciphertext } from '@shared/crypto-types'
import { eq, inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { SessionService, sessionExpiry } from './sessions'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

const RUN_PREFIX = `test-sessions-${crypto.randomUUID().slice(0, 8)}`
const fakeUser = `${RUN_PREFIX}-u1`
const fakeUser2 = `${RUN_PREFIX}-u2`

let db: ReturnType<typeof createDatabase>
let service: SessionService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  service = new SessionService(db, 'test-hmac-secret')
})

async function cleanup(): Promise<void> {
  await db.delete(userSessions).where(inArray(userSessions.userPubkey, [fakeUser, fakeUser2]))
}

beforeEach(cleanup)
afterAll(cleanup)

function createInput(id: string, userPubkey: string, tokenHash: string) {
  return {
    id: `${RUN_PREFIX}-${id}`,
    userPubkey,
    tokenHash,
    ipHash: `ip-hash-${id}`,
    credentialId: null,
    encryptedMeta: 'ct' as Ciphertext,
    metaEnvelope: [],
    expiresAt: sessionExpiry(),
  }
}

describe('SessionService integration', () => {
  test('create + list returns active session', async () => {
    const input = createInput('s1', fakeUser, 'hash1')
    await service.create(input)
    const sessions = await service.listForUser(fakeUser)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).toBe(input.id)
  })

  test('findByTokenHash returns session', async () => {
    const input = createInput('s2', fakeUser, 'hash2')
    await service.create(input)
    const found = await service.findByTokenHash('hash2')
    expect(found?.session.id).toBe(input.id)
    expect(found?.viaPrev).toBe(false)
  })

  test('findByTokenHash returns null for missing hash', async () => {
    const found = await service.findByTokenHash('not-a-hash-present')
    expect(found).toBeNull()
  })

  test('revoke sets revokedAt and excludes from listForUser', async () => {
    const input = createInput('s3', fakeUser, 'hash3')
    await service.create(input)
    await service.revoke(input.id, 'user')
    const sessions = await service.listForUser(fakeUser)
    expect(sessions).toHaveLength(0)
  })

  test('revokeAllForUser with exception keeps one alive', async () => {
    const a = createInput('s4', fakeUser, 'h4')
    const b = createInput('s5', fakeUser, 'h5')
    const c = createInput('s6', fakeUser, 'h6')
    await service.create(a)
    await service.create(b)
    await service.create(c)
    const count = await service.revokeAllForUser(fakeUser, 'lockdown_a', b.id)
    expect(count).toBe(2)
    const sessions = await service.listForUser(fakeUser)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).toBe(b.id)
  })

  test('touch rotates tokenHash and keeps prev for one-rotation grace window', async () => {
    const input = createInput('s7', fakeUser, 'h7')
    await service.create(input)
    await new Promise((r) => setTimeout(r, 10))
    await service.touch(input.id, 'h7-rotated')
    const found = await service.findByTokenHash('h7-rotated')
    expect(found?.session.id).toBe(input.id)
    expect(found?.viaPrev).toBe(false)
    // Old hash is still accepted once via prev_token_hash (grace window for
    // concurrent refreshes / multi-tab).
    const byPrev = await service.findByTokenHash('h7')
    expect(byPrev?.session.id).toBe(input.id)
    expect(byPrev?.viaPrev).toBe(true)
    // After a second rotation, the original hash is no longer valid.
    await service.touch(input.id, 'h7-rotated-2')
    const stale = await service.findByTokenHash('h7')
    expect(stale).toBeNull()
  })

  test('purgeExpired revokes expired sessions', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const input = {
      id: `${RUN_PREFIX}-s8`,
      userPubkey: fakeUser,
      tokenHash: 'h8',
      ipHash: 'x',
      credentialId: null,
      encryptedMeta: 'ct' as Ciphertext,
      metaEnvelope: [],
      expiresAt: yesterday,
    }
    await service.create(input)
    const count = await service.purgeExpired()
    expect(count).toBeGreaterThanOrEqual(1)
    const row = await db.select().from(userSessions).where(eq(userSessions.id, input.id)).limit(1)
    expect(row[0]?.revokedReason).toBe('expired')
  })

  test('listForUser does not leak across users', async () => {
    const a = createInput('su1', fakeUser, 'ha')
    const b = createInput('su2', fakeUser2, 'hb')
    await service.create(a)
    await service.create(b)
    const forUser1 = await service.listForUser(fakeUser)
    expect(forUser1).toHaveLength(1)
    expect(forUser1[0]?.id).toBe(a.id)
  })
})
