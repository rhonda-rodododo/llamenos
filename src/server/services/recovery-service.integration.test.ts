import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { createDatabase } from '@server/db'
import { recoveryParticipants, recoveryRequests } from '@server/db/schema'
import { inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { DuplicateParticipantError, RecoveryService } from './recovery-service'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llamenos:llamenos@localhost:5433/llamenos'

const RUN_PREFIX = `test-recovery-${crypto.randomUUID().slice(0, 8)}`
const userA = `${RUN_PREFIX}-u-a`
const userB = `${RUN_PREFIX}-u-b`
const adminInitiator = `${RUN_PREFIX}-admin`
const participantA = `${RUN_PREFIX}-p-a`
const participantB = `${RUN_PREFIX}-p-b`
const participantC = `${RUN_PREFIX}-p-c`

let db: ReturnType<typeof createDatabase>
let service: RecoveryService

beforeAll(async () => {
  db = createDatabase(TEST_DB_URL)
  await migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../../drizzle/migrations'),
  })
  service = new RecoveryService(db)
})

async function cleanup(): Promise<void> {
  // FK ON DELETE CASCADE on recovery_participants makes the child rows go
  // away when the parent request rows are deleted.
  await db.delete(recoveryRequests).where(inArray(recoveryRequests.userId, [userA, userB]))
}

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  db.$client.close()
})

describe('RecoveryService integration', () => {
  test('initiateRecovery creates a pending request with zero participants', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
      threshold: 3,
    })

    const request = await service.getRecoveryRequest(recoveryRequestId)
    expect(request).not.toBeNull()
    expect(request?.status).toBe('pending')
    expect(request?.threshold).toBe(3)
    expect(request?.participantsCount).toBe(0)
  })

  test('addParticipant inserts a junction row and mirrors the cached counter', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'recovery_group',
      threshold: 3,
    })

    const result = await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 'encrypted-share-a',
    })

    expect(result.participantsCount).toBe(1)
    expect(result.thresholdMet).toBe(false)

    const refreshed = await service.getRecoveryRequest(recoveryRequestId)
    expect(refreshed?.participantsCount).toBe(1)
  })

  test('addParticipant enforces per-user dedup — same user twice throws DuplicateParticipantError', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'recovery_group',
      threshold: 3,
    })

    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 'share-1',
    })

    await expect(
      service.addParticipant({
        recoveryRequestId,
        participantUserId: participantA,
        sharePayload: 'share-1-again',
      })
    ).rejects.toBeInstanceOf(DuplicateParticipantError)

    // Count must still be 1 — the duplicate did not inflate the junction.
    const refreshed = await service.getRecoveryRequest(recoveryRequestId)
    expect(refreshed?.participantsCount).toBe(1)
  })

  test('addParticipant cannot solo-meet threshold via repeat calls', async () => {
    // The whole point of Phase-2 P0: one compromised admin must not be
    // able to hit threshold by themselves.
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
      threshold: 2,
    })

    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 'share-1',
    })

    // Three more attempts from the same user, all rejected.
    for (const payload of ['share-2', 'share-3', 'share-4']) {
      await expect(
        service.addParticipant({
          recoveryRequestId,
          participantUserId: participantA,
          sharePayload: payload,
        })
      ).rejects.toBeInstanceOf(DuplicateParticipantError)
    }

    // Completion still blocked — only one distinct contributor.
    await expect(
      service.completeRecovery({
        recoveryRequestId,
        newDeviceId: 'device-abc',
        sigchainEntryId: 'entry-abc',
      })
    ).rejects.toThrow(/threshold not met/)
  })

  test('addParticipant from distinct users reaches threshold', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'recovery_group',
      threshold: 2,
    })

    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 'share-a',
    })
    const result = await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantB,
      sharePayload: 'share-b',
    })

    expect(result.participantsCount).toBe(2)
    expect(result.thresholdMet).toBe(true)
  })

  test('completeRecovery reads threshold from junction, not cached counter', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
      threshold: 3,
    })

    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 'share-a',
    })
    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantB,
      sharePayload: 'share-b',
    })
    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantC,
      sharePayload: 'share-c',
    })

    await service.completeRecovery({
      recoveryRequestId,
      newDeviceId: 'new-device-abc',
      sigchainEntryId: 'sigchain-entry-123',
    })

    const request = await service.getRecoveryRequest(recoveryRequestId)
    expect(request?.status).toBe('completed')
    expect(request?.newDeviceId).toBe('new-device-abc')
    expect(request?.sigchainEntryId).toBe('sigchain-entry-123')
    expect(request?.completedAt).toBeInstanceOf(Date)
  })

  test('completeRecovery rejects when fewer than threshold distinct participants', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'recovery_group',
      threshold: 3,
    })

    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 's1',
    })

    await expect(
      service.completeRecovery({
        recoveryRequestId,
        newDeviceId: 'device-1',
        sigchainEntryId: 'entry-1',
      })
    ).rejects.toThrow(/threshold not met/)
  })

  test('completeRecovery cannot be called twice', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
      threshold: 2,
    })

    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 's1',
    })
    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantB,
      sharePayload: 's2',
    })

    await service.completeRecovery({
      recoveryRequestId,
      newDeviceId: 'device-1',
      sigchainEntryId: 'entry-1',
    })

    await expect(
      service.completeRecovery({
        recoveryRequestId,
        newDeviceId: 'device-2',
        sigchainEntryId: 'entry-2',
      })
    ).rejects.toThrow(/not pending|status is 'completed'/)
  })

  test('addParticipant on non-pending request throws', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
      threshold: 2,
    })

    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 's1',
    })
    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantB,
      sharePayload: 's2',
    })
    await service.completeRecovery({
      recoveryRequestId,
      newDeviceId: 'd',
      sigchainEntryId: 'e',
    })

    await expect(
      service.addParticipant({
        recoveryRequestId,
        participantUserId: participantC,
        sharePayload: 's3',
      })
    ).rejects.toThrow(/not pending/)
  })

  test('addParticipant on unknown request throws', async () => {
    const fakeId = crypto.randomUUID()
    await expect(
      service.addParticipant({
        recoveryRequestId: fakeId,
        participantUserId: participantA,
        sharePayload: 's',
      })
    ).rejects.toThrow(/not found/)
  })

  test('initiateRecovery rejects when an open request already exists for the user', async () => {
    await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
    })

    await expect(
      service.initiateRecovery({
        userId: userA,
        initiatedByUserId: adminInitiator,
        recoveryType: 'admin_reset',
      })
    ).rejects.toThrow(/already has a pending recovery request/)
  })

  test('listPendingRecoveries returns only pending for a user', async () => {
    const { recoveryRequestId: rA } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
    })
    await service.initiateRecovery({
      userId: userB,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
    })

    const pendingA = await service.listPendingRecoveries(userA)
    expect(pendingA).toHaveLength(1)
    expect(pendingA[0]?.id).toBe(rA)
  })

  test('recovery_participants cascade on parent delete', async () => {
    const { recoveryRequestId } = await service.initiateRecovery({
      userId: userA,
      initiatedByUserId: adminInitiator,
      recoveryType: 'admin_reset',
      threshold: 2,
    })

    await service.addParticipant({
      recoveryRequestId,
      participantUserId: participantA,
      sharePayload: 's1',
    })

    await db.delete(recoveryRequests).where(inArray(recoveryRequests.userId, [userA]))

    const orphaned = await db
      .select()
      .from(recoveryParticipants)
      .where(inArray(recoveryParticipants.recoveryRequestId, [recoveryRequestId]))
    expect(orphaned).toHaveLength(0)
  })
})
