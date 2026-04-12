import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '../db'
import { recoveryRequests } from '../db/schema'

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
 * Manages admin-initiated recovery requests with Shamir threshold enforcement.
 *
 * Lifecycle: pending → completed (threshold met + device enrolled)
 *                    → expired  (stale after maxAgeMs)
 *
 * Only one pending recovery request per user is allowed at a time.
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
    // Check for existing pending recovery
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
   * Record a participant's share contribution. Returns updated count
   * and whether the threshold has been met.
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

    const newCount = request.participantsCount + 1

    await this.db
      .update(recoveryRequests)
      .set({ participantsCount: newCount })
      .where(eq(recoveryRequests.id, params.recoveryRequestId))

    return {
      participantsCount: newCount,
      thresholdMet: newCount >= request.threshold,
    }
  }

  /**
   * Mark a recovery request as completed with the new device and sigchain entry.
   * Only pending requests can be completed.
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
}
