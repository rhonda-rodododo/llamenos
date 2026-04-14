import { and, eq } from 'drizzle-orm'
/**
 * DB-level orchestration for the 1Password-style Recovery Group.
 *
 * - enrollHub: create hub_recovery_groups row + hub_recovery_group_shares rows
 * - initiateRecovery: create recovery_sessions row with 24h expiry
 * - contributeShare: append encrypted share; mark `ready` once threshold reached
 * - completeRecovery: validate 24h elapsed OR emergency override; mark completed
 * - rotateGroup: new key + new shares
 * - putUserRecoveryEnvelope: per-(user, hub) KEK envelope for recovery
 */
import type { Database } from '../db'
import {
  type RecoveryContribution,
  hubRecoveryGroupShares,
  hubRecoveryGroups,
  recoverySessions,
  userRecoveryEnvelopes,
} from '../db/schema/recovery'

const RECOVERY_DELAY_MS = 24 * 60 * 60 * 1000
const EMERGENCY_OVERRIDE_MIN_MS = 60 * 60 * 1000 // 1h emergency floor

export class RecoveryGroupDelayError extends Error {
  constructor(public readonly remainingMs: number) {
    super(`Recovery delay not elapsed; ${remainingMs}ms remaining`)
    this.name = 'RecoveryGroupDelayError'
  }
}

export class RecoveryGroupThresholdError extends Error {
  constructor(have: number, need: number) {
    super(`Recovery threshold not met: ${have} < ${need}`)
    this.name = 'RecoveryGroupThresholdError'
  }
}

export interface EnrollHubInput {
  hubId: string
  threshold: number
  totalShares: number
  groupPublicKey: string
  shareEnvelopes: { adminPubkey: string; envelope: string }[]
  shareCommitments: string[]
}

export interface InitiateRecoveryInput {
  hubId: string
  userPubkey: string
  newDevicePubkey: string
  coordinatorPubkey: string
}

export interface ContributeShareInput {
  sessionId: string
  byAdminPubkey: string
  encryptedShare: string
}

export interface CompleteRecoveryInput {
  sessionId: string
  emergencyOverride?: {
    justification: string
    coApproverPubkey: string
    coApproverSignature: string
  }
}

export class RecoveryGroupService {
  constructor(private readonly db: Database) {}

  async enrollHub(input: EnrollHubInput): Promise<void> {
    if (input.shareEnvelopes.length !== input.totalShares) {
      throw new Error('shareEnvelopes length must match totalShares')
    }
    if (input.shareCommitments.length !== input.totalShares) {
      throw new Error('shareCommitments length must match totalShares')
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(hubRecoveryGroups).values({
        hubId: input.hubId,
        groupPublicKey: input.groupPublicKey,
        threshold: input.threshold,
        totalShares: input.totalShares,
        shareCommitments: input.shareCommitments,
      })
      for (const s of input.shareEnvelopes) {
        await tx.insert(hubRecoveryGroupShares).values({
          hubId: input.hubId,
          adminPubkey: s.adminPubkey,
          shareEnvelope: s.envelope,
        })
      }
    })
  }

  async getGroup(hubId: string) {
    const rows = await this.db
      .select()
      .from(hubRecoveryGroups)
      .where(eq(hubRecoveryGroups.hubId, hubId))
    return rows[0] ?? null
  }

  async getSharesForAdmin(hubId: string, adminPubkey: string) {
    const rows = await this.db
      .select()
      .from(hubRecoveryGroupShares)
      .where(
        and(
          eq(hubRecoveryGroupShares.hubId, hubId),
          eq(hubRecoveryGroupShares.adminPubkey, adminPubkey)
        )
      )
    return rows[0] ?? null
  }

  async initiateRecovery(input: InitiateRecoveryInput) {
    const sessionId = crypto.randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + RECOVERY_DELAY_MS)
    await this.db.insert(recoverySessions).values({
      sessionId,
      hubId: input.hubId,
      userPubkey: input.userPubkey,
      coordinatorPubkey: input.coordinatorPubkey,
      newDevicePubkey: input.newDevicePubkey,
      status: 'pending',
      contributions: [],
      createdAt: now,
      expiresAt,
    })
    return {
      sessionId,
      status: 'pending' as const,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      coordinatorPubkey: input.coordinatorPubkey,
    }
  }

  async getSession(sessionId: string) {
    const rows = await this.db
      .select()
      .from(recoverySessions)
      .where(eq(recoverySessions.sessionId, sessionId))
    return rows[0] ?? null
  }

  async contributeShare(
    input: ContributeShareInput
  ): Promise<{ status: string; contributionCount: number }> {
    return await this.db.transaction(async (tx) => {
      const row = (
        await tx
          .select()
          .from(recoverySessions)
          .where(eq(recoverySessions.sessionId, input.sessionId))
      )[0]
      if (!row) throw new Error('recovery session not found')
      if (row.status !== 'pending' && row.status !== 'ready') {
        throw new Error(`cannot contribute to session in state ${row.status}`)
      }
      // Reject duplicate contribution from same admin
      const existing = row.contributions as RecoveryContribution[]
      if (existing.some((c) => c.byAdminPubkey === input.byAdminPubkey)) {
        throw new Error(`admin ${input.byAdminPubkey} has already contributed`)
      }
      const group = (
        await tx.select().from(hubRecoveryGroups).where(eq(hubRecoveryGroups.hubId, row.hubId))
      )[0]
      if (!group) throw new Error('recovery group not found')
      const contributions: RecoveryContribution[] = [
        ...existing,
        {
          byAdminPubkey: input.byAdminPubkey,
          encryptedShare: input.encryptedShare,
        },
      ]
      const newStatus = contributions.length >= group.threshold ? 'ready' : 'pending'
      await tx
        .update(recoverySessions)
        .set({ contributions, status: newStatus })
        .where(eq(recoverySessions.sessionId, input.sessionId))
      return { status: newStatus, contributionCount: contributions.length }
    })
  }

  async completeRecovery(input: CompleteRecoveryInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const session = (
        await tx
          .select()
          .from(recoverySessions)
          .where(eq(recoverySessions.sessionId, input.sessionId))
      )[0]
      if (!session) throw new Error('recovery session not found')
      if (session.status !== 'ready') {
        const group = (
          await tx
            .select({ threshold: hubRecoveryGroups.threshold })
            .from(hubRecoveryGroups)
            .where(eq(hubRecoveryGroups.hubId, session.hubId))
        )[0]
        throw new RecoveryGroupThresholdError(
          (session.contributions as RecoveryContribution[]).length,
          group?.threshold ?? 0
        )
      }
      const elapsedMs = Date.now() - session.createdAt.getTime()
      const required = input.emergencyOverride ? EMERGENCY_OVERRIDE_MIN_MS : RECOVERY_DELAY_MS
      if (elapsedMs < required) {
        throw new RecoveryGroupDelayError(required - elapsedMs)
      }
      await tx
        .update(recoverySessions)
        .set({
          status: 'completed',
          completedAt: new Date(),
          emergencyOverride: input.emergencyOverride ?? null,
        })
        .where(eq(recoverySessions.sessionId, input.sessionId))
    })
  }

  async rotateGroup(hubId: string, nextGroup: EnrollHubInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(hubRecoveryGroupShares).where(eq(hubRecoveryGroupShares.hubId, hubId))
      await tx
        .update(hubRecoveryGroups)
        .set({
          groupPublicKey: nextGroup.groupPublicKey,
          threshold: nextGroup.threshold,
          totalShares: nextGroup.totalShares,
          shareCommitments: nextGroup.shareCommitments,
          rotatedAt: new Date(),
        })
        .where(eq(hubRecoveryGroups.hubId, hubId))
      for (const s of nextGroup.shareEnvelopes) {
        await tx.insert(hubRecoveryGroupShares).values({
          hubId,
          adminPubkey: s.adminPubkey,
          shareEnvelope: s.envelope,
        })
      }
    })
  }

  async putUserRecoveryEnvelope(
    userPubkey: string,
    hubId: string,
    envelope: string
  ): Promise<void> {
    await this.db
      .insert(userRecoveryEnvelopes)
      .values({ userPubkey, hubId, envelope })
      .onConflictDoUpdate({
        target: [userRecoveryEnvelopes.userPubkey, userRecoveryEnvelopes.hubId],
        set: { envelope, updatedAt: new Date() },
      })
  }

  async getUserRecoveryEnvelope(userPubkey: string, hubId: string) {
    const rows = await this.db
      .select()
      .from(userRecoveryEnvelopes)
      .where(
        and(
          eq(userRecoveryEnvelopes.userPubkey, userPubkey),
          eq(userRecoveryEnvelopes.hubId, hubId)
        )
      )
    return rows[0] ?? null
  }
}
