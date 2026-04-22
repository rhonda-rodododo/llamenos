import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { auditLog } from '@server/db/schema'
import { CryptoService } from '@server/lib/crypto-service'
import { HpkeService } from '@server/lib/hpke-service'
import { RecordsService } from '@server/services/records'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'
// Use a unique prefix per test run so parallel file-level execution never shares data
const RUN_PREFIX = `test-hub-audit-${crypto.randomUUID().slice(0, 8)}`

let db: ReturnType<typeof createDatabase>
let service: RecordsService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  const hpke = new HpkeService('')
  service = new RecordsService(db, new CryptoService('', '', hpke))
})

afterAll(async () => {
  // Clean up all entries with our run prefix (handles all hub IDs used in this run)
  const { sql } = await import('drizzle-orm')
  await db.delete(auditLog).where(sql`${auditLog.hubId} LIKE ${`${RUN_PREFIX}%`}`)
  db.$client.close()
})

describe('audit-chain', () => {
  test('first entry has no previousEntryHash', async () => {
    const hub = `${RUN_PREFIX}-t1`
    const entry = await service.addAuditEntry(hub, 'test.event.1', 'pubkey-a', { x: 1 })
    expect(entry.previousEntryHash).toBeUndefined()
    expect(entry.entryHash).toBeString()
    expect(entry.entryHash?.length).toBe(64) // 32 bytes hex
  })

  test('second entry previousEntryHash equals first entryHash', async () => {
    const hub = `${RUN_PREFIX}-t2`
    const first = await service.addAuditEntry(hub, 'test.event.chain-1', 'pubkey-a')
    const second = await service.addAuditEntry(hub, 'test.event.chain-2', 'pubkey-a')
    expect(second.previousEntryHash).toBe(first.entryHash)
  })

  test('chain of 3 entries links correctly', async () => {
    const hub = `${RUN_PREFIX}-t3`
    const e1 = await service.addAuditEntry(hub, 'event.1', 'pubkey-x')
    const e2 = await service.addAuditEntry(hub, 'event.2', 'pubkey-x')
    const e3 = await service.addAuditEntry(hub, 'event.3', 'pubkey-x')

    expect(e1.previousEntryHash).toBeUndefined()
    expect(e2.previousEntryHash).toBe(e1.entryHash)
    expect(e3.previousEntryHash).toBe(e2.entryHash)
  })

  test('tampered entry breaks hash chain verification', async () => {
    const hub = `${RUN_PREFIX}-t4`
    const hpke2 = new HpkeService('')
    const cryptoSvc = new CryptoService('', '', hpke2)
    const { LABEL_AUDIT_EVENT } = await import('@shared/crypto-labels')
    type CT = import('@shared/crypto-types').Ciphertext

    const e1 = await service.addAuditEntry(hub, 'event.real', 'pubkey-y', { safe: true })
    const e2 = await service.addAuditEntry(hub, 'event.after', 'pubkey-y')

    // Tamper with e1's encrypted details by replacing with different encrypted content
    const tamperedEncryptedDetails = cryptoSvc.serverEncrypt(
      JSON.stringify({ safe: false, TAMPERED: true }),
      LABEL_AUDIT_EVENT
    )
    await db
      .update(auditLog)
      .set({ encryptedDetails: tamperedEncryptedDetails })
      .where(eq(auditLog.id, e1.id))

    // e2 still references the old e1 hash — chain is now broken
    // Verify by reading e1 back, decrypting, and re-computing what its hash should be
    const [tamperedRow] = await db.select().from(auditLog).where(eq(auditLog.id, e1.id))
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js')

    const decryptedEvent = cryptoSvc.serverDecrypt(
      tamperedRow.encryptedEvent as CT,
      LABEL_AUDIT_EVENT
    )
    const decryptedDetails = cryptoSvc.serverDecrypt(
      tamperedRow.encryptedDetails as CT,
      LABEL_AUDIT_EVENT
    )

    const recomputed = bytesToHex(
      sha256(
        utf8ToBytes(
          `${decryptedEvent}${tamperedRow.actorPubkey}${decryptedDetails}${tamperedRow.previousEntryHash ?? ''}${tamperedRow.createdAt.toISOString()}`
        )
      )
    )
    // The re-computed hash from tampered data does NOT match the stored hash
    expect(recomputed).not.toBe(e1.entryHash)
    // e2's previousEntryHash still points to the original (now-invalid) hash
    expect(e2.previousEntryHash).toBe(e1.entryHash)
  })

  test('concurrent addAuditEntry calls maintain valid hash chain', async () => {
    const hub = `${RUN_PREFIX}-concurrent-${crypto.randomUUID().slice(0, 8)}`

    // Fire two entries concurrently — the transaction must serialize them
    // so that the second entry's previousEntryHash is the first entry's entryHash
    // (not null, and not a stale value).
    const [a, b] = await Promise.all([
      service.addAuditEntry(hub, 'concurrent.event.a', 'pubkey-c'),
      service.addAuditEntry(hub, 'concurrent.event.b', 'pubkey-c'),
    ])

    // Both entries must exist
    const { sql } = await import('drizzle-orm')
    const rows = await db
      .select({
        id: auditLog.id,
        entryHash: auditLog.entryHash,
        previousEntryHash: auditLog.previousEntryHash,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(sql`${auditLog.hubId} = ${hub}`)
      .orderBy(auditLog.createdAt)
    expect(rows.length).toBe(2)

    // Both returned IDs must be in the DB
    const ids = new Set([a.id, b.id])
    expect(ids.has(rows[0].id)).toBe(true)
    expect(ids.has(rows[1].id)).toBe(true)

    // The chain: first row has null previousEntryHash, second references first's entryHash.
    expect(rows[0].previousEntryHash).toBeNull()
    expect(rows[1].previousEntryHash).toBe(rows[0].entryHash)
    // Hash values must not collide
    expect(rows[0].entryHash).not.toBe(rows[1].entryHash)
  })
})
