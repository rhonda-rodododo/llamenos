import { and, eq, lt, sql } from 'drizzle-orm'
import type { Database } from '../db'
import { recoveryParticipants, recoveryRequests } from '../db/schema'

export interface RecoveryRequest {
  id: string
  userId: string
  initiatedByUserId: string
  recoveryType: string
  status: string
  threshold: number
  participantsCount: number
  createdAt: Date
  completedAt: Date | null
  expiredAt: Date | null
  newDeviceId: string | null
  sigchainEntryId: string | null
}

/**
 * Raised by `RecoveryService.addParticipant` when the caller's
 * `participantUserId` has already contributed a share to the given
 * recovery request. This is the Phase-2 P0 dedup gate: without it, a
 * single compromised admin could hit the Shamir threshold alone by
 * calling `addParticipant` N times.
 */
export class DuplicateParticipantError extends Error {
  readonly recoveryRequestId: string
  readonly participantUserId: string

  constructor(recoveryRequestId: string, participantUserId: string) {
    super(
      `Participant ${participantUserId} has already contributed to recovery request ${recoveryRequestId}`
    )
    this.name = 'DuplicateParticipantError'
    this.recoveryRequestId = recoveryRequestId
    this.participantUserId = participantUserId
  }
}

/**
 * Manages admin-initiated recovery requests with Shamir threshold enforcement.
 *
 * Lifecycle: pending → completed (threshold met + device enrolled)
 *                    → expired  (stale after maxAgeMs)
 *
 * Only one pending recovery request per user is allowed at a time.
 *
 * Per-participant dedup is enforced by the `recovery_participants` junction
 * table's composite primary key `(recovery_request_id, participant_user_id)`
 * — `addParticipant` uses `ON CONFLICT DO NOTHING` and treats the empty
 * `RETURNING` set as a unique-constraint hit. The authoritative participant
 * count is always derived from the junction; `recovery_requests.participants_count`
 * is a cached mirror kept in sync on each successful insert.
 */
export class RecoveryService {
  constructor(private readonly db: Database) {}

  /**
   * Create a new pending recovery request for a user.
   * Rejects if the user already has a pending recovery request.
   */
  async initiateRecovery(params: {
    userId: string
    initiatedByUserId: string
    recoveryType: 'paper_key' | 'recovery_group' | 'admin_reset'
    threshold?: number
  }): Promise<{ recoveryRequestId: string }> {
    const existing = await this.db
      .select({ id: recoveryRequests.id })
      .from(recoveryRequests)
      .where(
        and(eq(recoveryRequests.userId, params.userId), eq(recoveryRequests.status, 'pending'))
      )
      .limit(1)

    if (existing.length > 0) {
      throw new Error(`User ${params.userId} already has a pending recovery request`)
    }

    const [row] = await this.db
      .insert(recoveryRequests)
      .values({
        userId: params.userId,
        initiatedByUserId: params.initiatedByUserId,
        recoveryType: params.recoveryType,
        threshold: params.threshold ?? 2,
        status: 'pending',
        participantsCount: 0,
      })
      .returning({ id: recoveryRequests.id })

    return { recoveryRequestId: row.id }
  }

  /**
   * Record a participant's share contribution. Enforces per-user uniqueness
   * via the `recovery_participants` composite primary key — repeat calls
   * with the same `participantUserId` throw `DuplicateParticipantError`.
   *
   * Returns the authoritative participant count after the successful insert
   * and whether the Shamir threshold has been met.
   */
  async addParticipant(params: {
    recoveryRequestId: string
    participantUserId: string
    sharePayload: string
  }): Promise<{ participantsCount: number; thresholdMet: boolean }> {
    const request = await this.getRecoveryRequest(params.recoveryRequestId)
    if (!request) {
      throw new Error(`Recovery request ${params.recoveryRequestId} not found`)
    }
    if (request.status !== 'pending') {
      throw new Error(
        `Recovery request ${params.recoveryRequestId} is not pending (status: ${request.status})`
      )
    }

    const inserted = await this.db
      .insert(recoveryParticipants)
      .values({
        recoveryRequestId: params.recoveryRequestId,
        participantUserId: params.participantUserId,
        sharePayload: params.sharePayload,
      })
      .onConflictDoNothing()
      .returning({ participantUserId: recoveryParticipants.participantUserId })

    if (inserted.length === 0) {
      throw new DuplicateParticipantError(params.recoveryRequestId, params.participantUserId)
    }

    const participantsCount = await this.countParticipants(params.recoveryRequestId)

    // Mirror the authoritative count onto the cached column so read paths
    // that only load the request row still see a consistent value.
    await this.db
      .update(recoveryRequests)
      .set({ participantsCount })
      .where(eq(recoveryRequests.id, params.recoveryRequestId))

    return {
      participantsCount,
      thresholdMet: participantsCount >= request.threshold,
    }
  }

  /**
   * Mark a recovery request as completed with the new device and sigchain entry.
   * Only pending requests with threshold met (by junction-table count) can be
   * completed.
   */
  async completeRecovery(params: {
    recoveryRequestId: string
    newDeviceId: string
    sigchainEntryId: string
  }): Promise<void> {
    const request = await this.getRecoveryRequest(params.recoveryRequestId)
    if (!request) {
      throw new Error(`Recovery request ${params.recoveryRequestId} not found`)
    }
    if (request.status !== 'pending') {
      throw new Error(
        `Cannot complete recovery request ${params.recoveryRequestId}: status is '${request.status}', expected 'pending'`
      )
    }

    // Read from the junction to defeat any stale cached counter.
    const participantsCount = await this.countParticipants(params.recoveryRequestId)
    if (participantsCount < request.threshold) {
      throw new Error(
        `Cannot complete recovery request ${params.recoveryRequestId}: threshold not met (${participantsCount}/${request.threshold})`
      )
    }

    await this.db
      .update(recoveryRequests)
      .set({
        status: 'completed',
        completedAt: new Date(),
        newDeviceId: params.newDeviceId,
        sigchainEntryId: params.sigchainEntryId,
      })
      .where(eq(recoveryRequests.id, params.recoveryRequestId))
  }

  /**
   * Fetch a single recovery request by ID.
   */
  async getRecoveryRequest(id: string): Promise<RecoveryRequest | null> {
    const [row] = await this.db
      .select()
      .from(recoveryRequests)
      .where(eq(recoveryRequests.id, id))
      .limit(1)

    return row ?? null
  }

  /**
   * List all pending recovery requests for a user.
   */
  async listPendingRecoveries(userId: string): Promise<RecoveryRequest[]> {
    return this.db
      .select()
      .from(recoveryRequests)
      .where(and(eq(recoveryRequests.userId, userId), eq(recoveryRequests.status, 'pending')))
  }

  /**
   * Expire stale pending recovery requests older than maxAgeMs.
   * Returns the number of requests expired.
   * @param maxAgeMs Default 24 hours (86_400_000 ms)
   */
  async expireStaleRecoveries(maxAgeMs = 86_400_000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs)

    const result = await this.db
      .update(recoveryRequests)
      .set({
        status: 'expired',
        expiredAt: new Date(),
      })
      .where(and(eq(recoveryRequests.status, 'pending'), lt(recoveryRequests.createdAt, cutoff)))
      .returning({ id: recoveryRequests.id })

    return result.length
  }

  /**
   * Authoritative distinct-participant count from the junction table.
   */
  private async countParticipants(recoveryRequestId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(recoveryParticipants)
      .where(eq(recoveryParticipants.recoveryRequestId, recoveryRequestId))
    return row?.count ?? 0
  }
}
