import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import {
  auditLog,
  callLegs,
  callRecords,
  conversations,
  messageEnvelopes,
  noteEnvelopes,
} from '@server/db/schema'
import { CryptoService } from '@server/lib/crypto-service'
import { GdprService } from '@server/services/gdpr'
import { LABEL_AUDIT_EVENT } from '@shared/crypto-labels'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

const RUN_PREFIX = `gdpr-test-${crypto.randomUUID().slice(0, 8)}`
const HUB_A = `${RUN_PREFIX}-hub-a`
const HUB_B = `${RUN_PREFIX}-hub-b`

let db: ReturnType<typeof createDatabase>
let crypto_: CryptoService
let service: GdprService

const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 86400_000)

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  crypto_ = new CryptoService('', '')
  service = new GdprService(db, crypto_)
})

afterAll(async () => {
  // Clean up any remaining rows from this run
  await db.delete(auditLog).where(sql`${auditLog.hubId} IN (${HUB_A}, ${HUB_B})`)
  await db.delete(callRecords).where(sql`${callRecords.hubId} IN (${HUB_A}, ${HUB_B})`)
  await db.delete(noteEnvelopes).where(sql`${noteEnvelopes.hubId} IN (${HUB_A}, ${HUB_B})`)
  const convIds = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(sql`${conversations.hubId} IN (${HUB_A}, ${HUB_B})`)
  if (convIds.length) {
    await db.delete(messageEnvelopes).where(
      sql`${messageEnvelopes.conversationId} IN (${sql.join(
        convIds.map((c) => sql`${c.id}`),
        sql`, `
      )})`
    )
  }
  await db.delete(conversations).where(sql`${conversations.hubId} IN (${HUB_A}, ${HUB_B})`)
  await db.delete(callLegs).where(sql`${callLegs.hubId} IN (${HUB_A}, ${HUB_B})`)
  db.$client.close()
})

describe('GdprService.purgeExpiredData hub scoping', () => {
  test('purges only rows in the target hub, leaves other hubs untouched', async () => {
    const encEvent = crypto_.serverEncrypt('e2e.test.event', LABEL_AUDIT_EVENT)
    const encDetails = crypto_.serverEncrypt('{}', LABEL_AUDIT_EVENT)

    // Seed audit_log in both hubs (old)
    const auditIdA = `${RUN_PREFIX}-audit-a`
    const auditIdB = `${RUN_PREFIX}-audit-b`
    await db.insert(auditLog).values([
      {
        id: auditIdA,
        hubId: HUB_A,
        actorPubkey: 'pk-a',
        encryptedEvent: encEvent,
        encryptedDetails: encDetails,
        createdAt: NINETY_DAYS_AGO,
      },
      {
        id: auditIdB,
        hubId: HUB_B,
        actorPubkey: 'pk-b',
        encryptedEvent: encEvent,
        encryptedDetails: encDetails,
        createdAt: NINETY_DAYS_AGO,
      },
    ])

    // Seed call_records in both hubs (old)
    const callIdA = `${RUN_PREFIX}-call-a`
    const callIdB = `${RUN_PREFIX}-call-b`
    await db.insert(callRecords).values([
      { id: callIdA, hubId: HUB_A, startedAt: NINETY_DAYS_AGO, status: 'completed' },
      { id: callIdB, hubId: HUB_B, startedAt: NINETY_DAYS_AGO, status: 'completed' },
    ])

    // Seed note_envelopes in both hubs (old)
    const noteIdA = `${RUN_PREFIX}-note-a`
    const noteIdB = `${RUN_PREFIX}-note-b`
    await db.insert(noteEnvelopes).values([
      {
        id: noteIdA,
        hubId: HUB_A,
        authorPubkey: 'pk-a',
        encryptedContent: 'ct',
        createdAt: NINETY_DAYS_AGO,
        updatedAt: NINETY_DAYS_AGO,
      },
      {
        id: noteIdB,
        hubId: HUB_B,
        authorPubkey: 'pk-b',
        encryptedContent: 'ct',
        createdAt: NINETY_DAYS_AGO,
        updatedAt: NINETY_DAYS_AGO,
      },
    ])

    // Seed conversations + message_envelopes in both hubs (old)
    const convIdA = `${RUN_PREFIX}-conv-a`
    const convIdB = `${RUN_PREFIX}-conv-b`
    await db.insert(conversations).values([
      {
        id: convIdA,
        hubId: HUB_A,
        channelType: 'sms',
        contactIdentifierHash: `hash-a-${RUN_PREFIX}`,
        createdAt: NINETY_DAYS_AGO,
        updatedAt: NINETY_DAYS_AGO,
        lastMessageAt: NINETY_DAYS_AGO,
      },
      {
        id: convIdB,
        hubId: HUB_B,
        channelType: 'sms',
        contactIdentifierHash: `hash-b-${RUN_PREFIX}`,
        createdAt: NINETY_DAYS_AGO,
        updatedAt: NINETY_DAYS_AGO,
        lastMessageAt: NINETY_DAYS_AGO,
      },
    ])

    const msgIdA = `${RUN_PREFIX}-msg-a`
    const msgIdB = `${RUN_PREFIX}-msg-b`
    await db.insert(messageEnvelopes).values([
      {
        id: msgIdA,
        conversationId: convIdA,
        direction: 'inbound',
        authorPubkey: 'pk-a',
        encryptedContent: 'ct',
        createdAt: NINETY_DAYS_AGO,
      },
      {
        id: msgIdB,
        conversationId: convIdB,
        direction: 'inbound',
        authorPubkey: 'pk-b',
        encryptedContent: 'ct',
        createdAt: NINETY_DAYS_AGO,
      },
    ])

    // Purge hub A only
    const summary = await service.purgeExpiredData(
      { callRecordsDays: 30, notesDays: 30, messagesDays: 30, auditLogDays: 30 },
      HUB_A
    )

    expect(summary.callRecordsDeleted).toBeGreaterThanOrEqual(1)
    expect(summary.notesDeleted).toBeGreaterThanOrEqual(1)
    expect(summary.messagesDeleted).toBeGreaterThanOrEqual(1)
    expect(summary.auditLogDeleted).toBeGreaterThanOrEqual(1)

    // Hub A rows are gone
    const auditA = await db.select().from(auditLog).where(sql`${auditLog.id} = ${auditIdA}`)
    expect(auditA.length).toBe(0)
    const callA = await db.select().from(callRecords).where(sql`${callRecords.id} = ${callIdA}`)
    expect(callA.length).toBe(0)
    const noteA = await db.select().from(noteEnvelopes).where(sql`${noteEnvelopes.id} = ${noteIdA}`)
    expect(noteA.length).toBe(0)
    const msgA = await db
      .select()
      .from(messageEnvelopes)
      .where(sql`${messageEnvelopes.id} = ${msgIdA}`)
    expect(msgA.length).toBe(0)

    // Hub B rows are untouched
    const auditB = await db.select().from(auditLog).where(sql`${auditLog.id} = ${auditIdB}`)
    expect(auditB.length).toBe(1)
    const callB = await db.select().from(callRecords).where(sql`${callRecords.id} = ${callIdB}`)
    expect(callB.length).toBe(1)
    const noteB = await db.select().from(noteEnvelopes).where(sql`${noteEnvelopes.id} = ${noteIdB}`)
    expect(noteB.length).toBe(1)
    const msgB = await db
      .select()
      .from(messageEnvelopes)
      .where(sql`${messageEnvelopes.id} = ${msgIdB}`)
    expect(msgB.length).toBe(1)
  })
})

describe('GdprService.exportForUser user scoping', () => {
  test('export does not include call records the user did not participate in', async () => {
    const pubkeyA = `${RUN_PREFIX}-user-a`
    const pubkeyB = `${RUN_PREFIX}-user-b`
    const callId = `${RUN_PREFIX}-call-onlyA`

    // call_records row exists
    await db.insert(callRecords).values({
      id: callId,
      hubId: HUB_A,
      startedAt: new Date(),
      status: 'completed',
    })

    // Only user A has a call leg for this call
    await db.insert(callLegs).values({
      legSid: `${RUN_PREFIX}-leg-a`,
      callSid: callId,
      hubId: HUB_A,
      userPubkey: pubkeyA,
      type: 'phone',
      status: 'completed',
    })

    const exportB = await service.exportForUser(pubkeyB)
    // B's export must NOT contain A's call
    const hasACall = exportB.calls.some((c) => c.id === callId)
    expect(hasACall).toBe(false)

    const exportA = await service.exportForUser(pubkeyA)
    const hasACallInA = exportA.calls.some((c) => c.id === callId)
    expect(hasACallInA).toBe(true)
  })
})
