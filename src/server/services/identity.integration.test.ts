import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { users, webauthnCredentials } from '@server/db/schema'
import { CryptoService } from '@server/lib/crypto-service'
import { IdentityService } from '@server/services/identity'
import type { Ciphertext } from '@shared/crypto-types'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'
const TEST_PUBKEY = 'test-webauthn-pubkey-counter'
const TEST_CRED_ID = 'test-cred-counter-001'

let db: ReturnType<typeof createDatabase>
let service: IdentityService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  service = new IdentityService(db, new CryptoService('', ''))
  // Clean up prior test credential
  await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, TEST_CRED_ID))
  // Insert test credential with counter=5
  await db.insert(webauthnCredentials).values({
    id: TEST_CRED_ID,
    pubkey: TEST_PUBKEY,
    publicKey: 'fake-public-key-bytes',
    counter: '5',
    transports: [],
    backedUp: false,
    lastUsedAt: new Date(),
  })
})

const HUB_ROLE_TEST_PUBKEY = `test-hubrole-user-${crypto.randomUUID().slice(0, 8)}`

afterAll(async () => {
  await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, TEST_CRED_ID))
  await db.delete(users).where(eq(users.pubkey, HUB_ROLE_TEST_PUBKEY))
  db.$client.close()
})

describe('webauthn-counter', () => {
  test('counter=6 succeeds (first valid increment)', async () => {
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: TEST_CRED_ID,
        counter: 6,
        lastUsedAt: new Date().toISOString(),
      })
    ).resolves.toBeUndefined()
  })

  test('counter=6 again must throw (same-value replay)', async () => {
    // Counter is now 6 from the previous test
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: TEST_CRED_ID,
        counter: 6,
        lastUsedAt: new Date().toISOString(),
      })
    ).rejects.toThrow()
  })

  test('counter=4 must throw (lower-value replay)', async () => {
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: TEST_CRED_ID,
        counter: 4,
        lastUsedAt: new Date().toISOString(),
      })
    ).rejects.toThrow()
  })

  test('counter=7 succeeds after valid prior state', async () => {
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: TEST_CRED_ID,
        counter: 7,
        lastUsedAt: new Date().toISOString(),
      })
    ).resolves.toBeUndefined()
  })

  test('non-existent credential throws 404', async () => {
    await expect(
      service.updateWebAuthnCounter({
        pubkey: TEST_PUBKEY,
        credId: 'no-such-cred',
        counter: 100,
        lastUsedAt: new Date().toISOString(),
      })
    ).rejects.toThrow()
  })

  test('concurrent updateWebAuthnCounter — only one succeeds (atomic counter)', async () => {
    // Seed a fresh credential at counter=5
    const credId = `test-cred-concurrent-${crypto.randomUUID().slice(0, 8)}`
    const pubkey = `test-wa-concurrent-${crypto.randomUUID().slice(0, 8)}`
    await db.insert(webauthnCredentials).values({
      id: credId,
      pubkey,
      publicKey: 'fake-public-key-bytes',
      counter: '5',
      transports: [],
      backedUp: false,
      lastUsedAt: new Date(),
    })

    try {
      // Two concurrent increments to the exact same target counter=6.
      // Atomic WHERE counter < newCounter guarantees exactly one will succeed.
      const results = await Promise.allSettled([
        service.updateWebAuthnCounter({
          pubkey,
          credId,
          counter: 6,
          lastUsedAt: new Date().toISOString(),
        }),
        service.updateWebAuthnCounter({
          pubkey,
          credId,
          counter: 6,
          lastUsedAt: new Date().toISOString(),
        }),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')
      expect(fulfilled.length).toBe(1)
      expect(rejected.length).toBe(1)

      // Final counter must be 6
      const [row] = await db
        .select({ counter: webauthnCredentials.counter })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.id, credId))
      expect(row.counter).toBe('6')
    } finally {
      await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, credId))
    }
  })
})

describe('setHubRole — atomic JSONB update under concurrency', () => {
  test('concurrent setHubRole for 3 different hubs — no lost updates', async () => {
    // Create a user row with empty hubRoles
    await db.insert(users).values({
      pubkey: HUB_ROLE_TEST_PUBKEY,
      roles: [],
      hubRoles: [],
      encryptedName: '' as Ciphertext,
      encryptedPhone: '' as Ciphertext,
    })

    const hubIds = [
      `${HUB_ROLE_TEST_PUBKEY}-hub-1`,
      `${HUB_ROLE_TEST_PUBKEY}-hub-2`,
      `${HUB_ROLE_TEST_PUBKEY}-hub-3`,
    ]

    // Fire 3 concurrent setHubRole calls — naive read-modify-write would lose entries.
    await Promise.all(
      hubIds.map((hubId, i) =>
        service.setHubRole({
          pubkey: HUB_ROLE_TEST_PUBKEY,
          hubId,
          roleIds: [`role-${i}`],
        })
      )
    )

    // Re-read and assert all 3 entries are present
    const [row] = await db
      .select({ hubRoles: users.hubRoles })
      .from(users)
      .where(eq(users.pubkey, HUB_ROLE_TEST_PUBKEY))

    const hubRoles = row.hubRoles as Array<{ hubId: string; roleIds: string[] }>
    expect(hubRoles.length).toBe(3)
    for (const hubId of hubIds) {
      const match = hubRoles.find((hr) => hr.hubId === hubId)
      expect(match).toBeDefined()
    }
  })
})
