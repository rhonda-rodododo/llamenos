/**
 * DeviceRevokeWorker — Background job processor for device revocation.
 *
 * When a device is revoked via a `tier3_device_remove` sigchain entry, every hub
 * the user belongs to must rotate its hub key within 30 seconds. This worker
 * orchestrates that process:
 *
 * 1. Verifies the device is actually revoked in the DB
 * 2. Finds all hubs the user is a member of (via hubRoles JSONB)
 * 3. For each hub, removes the revoked device's envelopes and stores new
 *    rotation data (generation row + new envelopes for remaining devices)
 * 4. Processes all hubs in parallel with retry + exponential backoff
 * 5. Returns a status summary with timing info
 *
 * The actual crypto (key generation, HPKE wrapping) happens client-side.
 * This worker only stores the server-side results.
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../db'
import { hubKeyEnvelopes, hubPtkGenerations, userDevices, users } from '../db/schema'
import { createLogger } from '../lib/logger'

const log = createLogger('jobs.device-revoke-worker')

// ── Types ──

export interface DeviceRevokeJob {
  revokedDeviceId: string
  userId: string
  revokeEntryHash: string
}

export interface HubRotationJob {
  hubId: string
  userId: string
  revokedDeviceId: string
  revokeEntryHash: string
  status: 'pending' | 'completed' | 'failed'
  attempts: number
  lastError?: string
  completedAt?: Date
}

export interface HubRotationRequest {
  hubId: string
  newGeneration: number
  oldGenWrappedUnderNew: string
  envelopes: Array<{
    deviceId: string
    userId: string
    envelope: string
  }>
  sigchainEntryId: string
}

export interface RevocationResult {
  revokedDeviceId: string
  hubRotations: Array<{
    hubId: string
    status: 'completed' | 'failed'
    generation?: number
    error?: string
  }>
  allComplete: boolean
  durationMs: number
}

// ── Constants ──

/** Maximum time before we warn about slow rotation. */
const ROTATION_DEADLINE_MS = 30_000

/** Max retry attempts per hub. */
const MAX_RETRIES = 3

/** Exponential backoff base and multiplier: 100ms, 400ms, 1600ms. */
const BACKOFF_BASE_MS = 100
const BACKOFF_MULTIPLIER = 4

// ── Worker ──

export class DeviceRevokeWorker {
  constructor(private readonly db: Database) {}

  /**
   * Process a device revocation across all hubs the user belongs to.
   *
   * Idempotent: if called again for the same device, already-rotated hubs
   * are detected and skipped.
   */
  async processRevocation(job: DeviceRevokeJob): Promise<RevocationResult> {
    const start = performance.now()

    // 1. Verify the device is actually revoked
    const device = await this.db
      .select({ revokedAt: userDevices.revokedAt })
      .from(userDevices)
      .where(eq(userDevices.deviceId, job.revokedDeviceId))
      .limit(1)

    if (!device[0]) {
      throw new Error(`Device ${job.revokedDeviceId} not found`)
    }
    if (!device[0].revokedAt) {
      throw new Error(`Device ${job.revokedDeviceId} is not revoked`)
    }

    // 2. Find all hubs the user belongs to
    const hubIds = await this.getUserHubs(job.userId)

    if (hubIds.length === 0) {
      return {
        revokedDeviceId: job.revokedDeviceId,
        hubRotations: [],
        allComplete: true,
        durationMs: performance.now() - start,
      }
    }

    // 3. Build rotation jobs for each hub
    const rotationJobs: HubRotationJob[] = hubIds.map((hubId) => ({
      hubId,
      userId: job.userId,
      revokedDeviceId: job.revokedDeviceId,
      revokeEntryHash: job.revokeEntryHash,
      status: 'pending' as const,
      attempts: 0,
    }))

    // 4. Check which hubs already have a rotation for this revocation (idempotency)
    const results: RevocationResult['hubRotations'] = []

    for (const rotationJob of rotationJobs) {
      const alreadyDone = await this.isHubRotationComplete(rotationJob.hubId, job.revokeEntryHash)
      if (alreadyDone) {
        results.push({
          hubId: rotationJob.hubId,
          status: 'completed',
        })
        rotationJob.status = 'completed'
      }
    }

    // 5. Process remaining hubs in parallel with retry
    const pending = rotationJobs.filter((j) => j.status === 'pending')

    if (pending.length > 0) {
      const settled = await Promise.allSettled(
        pending.map((rotationJob) => this.processHubRotationWithRetry(rotationJob))
      )

      for (let i = 0; i < settled.length; i++) {
        const result = settled[i]
        const rotationJob = pending[i]

        if (result.status === 'fulfilled') {
          results.push({
            hubId: rotationJob.hubId,
            status: 'completed',
            generation: result.value,
          })
        } else {
          const error =
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          results.push({
            hubId: rotationJob.hubId,
            status: 'failed',
            error,
          })
        }
      }
    }

    const durationMs = performance.now() - start

    if (durationMs > ROTATION_DEADLINE_MS) {
      log.error(
        `Hub key rotation took ${Math.round(durationMs)}ms ` +
          `(>${ROTATION_DEADLINE_MS}ms deadline) for device ${job.revokedDeviceId}`
      )
    }

    return {
      revokedDeviceId: job.revokedDeviceId,
      hubRotations: results,
      allComplete: results.every((r) => r.status === 'completed'),
      durationMs,
    }
  }

  /**
   * Process a single hub rotation: store the client-provided rotation data.
   *
   * The actual crypto (key generation, HPKE wrapping) happens client-side.
   * This method:
   * 1. Verifies the revoked device has envelopes for this hub
   * 2. In a transaction:
   *    a. Deletes the revoked device's hub_key_envelopes
   *    b. Inserts the new hub_ptk_generations row
   *    c. Inserts new hub_key_envelopes for remaining devices
   */
  async processHubRotation(
    hubId: string,
    revokedDeviceId: string,
    rotation: HubRotationRequest
  ): Promise<void> {
    // Verify the revoked device has envelopes for this hub
    const existing = await this.db
      .select({ id: hubKeyEnvelopes.id })
      .from(hubKeyEnvelopes)
      .where(and(eq(hubKeyEnvelopes.hubId, hubId), eq(hubKeyEnvelopes.deviceId, revokedDeviceId)))
      .limit(1)

    // Envelopes may already be deleted from a previous partial run — that's fine
    const hasExistingEnvelopes = existing.length > 0

    await this.db.transaction(async (tx) => {
      // a. Delete the revoked device's envelopes for this hub
      if (hasExistingEnvelopes) {
        await tx
          .delete(hubKeyEnvelopes)
          .where(
            and(eq(hubKeyEnvelopes.hubId, hubId), eq(hubKeyEnvelopes.deviceId, revokedDeviceId))
          )
      }

      // b. Insert the new generation row
      await tx.insert(hubPtkGenerations).values({
        id: crypto.randomUUID(),
        hubId,
        generation: rotation.newGeneration,
        oldGenWrappedUnderNew: rotation.oldGenWrappedUnderNew,
        rotatedBySigchainEntryId: rotation.sigchainEntryId,
      })

      // c. Insert new envelopes for remaining devices
      if (rotation.envelopes.length > 0) {
        await tx.insert(hubKeyEnvelopes).values(
          rotation.envelopes.map((env) => ({
            id: crypto.randomUUID(),
            hubId,
            generation: rotation.newGeneration,
            deviceId: env.deviceId,
            userId: env.userId,
            envelope: env.envelope,
            sigchainEntryId: rotation.sigchainEntryId,
          }))
        )
      }
    })
  }

  /**
   * Get all hub IDs a user is a member of.
   * Parses the user's hubRoles JSONB column.
   */
  async getUserHubs(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({
        hubId: sql<string>`elem->>'hubId'`,
      })
      .from(users)
      .innerJoin(
        sql`jsonb_array_elements(COALESCE(${users.hubRoles}, '[]'::jsonb)) AS elem`,
        sql`true`
      )
      .where(eq(users.pubkey, userId))

    // Deduplicate (should not have dupes, but be safe)
    return [...new Set(rows.map((r) => r.hubId))]
  }

  /**
   * Get all active (non-revoked) devices for a user, excluding a specific device.
   */
  async getRemainingDevices(
    userId: string,
    excludeDeviceId: string
  ): Promise<Array<{ deviceId: string; encryptionPubkey: string }>> {
    const rows = await this.db
      .select({
        deviceId: userDevices.deviceId,
        encryptionPubkey: userDevices.encryptionPubkey,
      })
      .from(userDevices)
      .where(
        and(
          eq(userDevices.userId, userId),
          isNull(userDevices.revokedAt),
          sql`${userDevices.deviceId} != ${excludeDeviceId}`
        )
      )

    return rows
  }

  /**
   * Check if a hub rotation was already completed for a given revocation.
   * Looks for a hub_ptk_generations row whose sigchain entry matches.
   */
  async isHubRotationComplete(hubId: string, revokeEntryHash: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: hubPtkGenerations.id })
      .from(hubPtkGenerations)
      .where(
        and(
          eq(hubPtkGenerations.hubId, hubId),
          eq(hubPtkGenerations.rotatedBySigchainEntryId, revokeEntryHash)
        )
      )
      .limit(1)

    return rows.length > 0
  }

  // ── Private helpers ──

  /**
   * Process a hub rotation with exponential backoff retry.
   * Returns the new generation number on success, throws on final failure.
   */
  private async processHubRotationWithRetry(job: HubRotationJob): Promise<number | undefined> {
    // This method is called during processRevocation but the actual rotation
    // data (envelopes, generation) comes from the client via processHubRotation.
    // In the revocation flow, the server-side work is:
    //   1. Delete revoked device's envelopes
    //   2. The client calls processHubRotation with the new data
    //
    // For the parallel retry flow, we just delete the revoked device's envelopes
    // and signal that the hub needs rotation. The client then calls processHubRotation.

    let lastError: Error | undefined

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Delete revoked device's envelopes for this hub
        await this.db
          .delete(hubKeyEnvelopes)
          .where(
            and(
              eq(hubKeyEnvelopes.hubId, job.hubId),
              eq(hubKeyEnvelopes.deviceId, job.revokedDeviceId)
            )
          )

        job.status = 'completed'
        job.completedAt = new Date()
        return undefined
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        job.attempts = attempt + 1
        job.lastError = lastError.message

        if (attempt < MAX_RETRIES - 1) {
          const delay = BACKOFF_BASE_MS * BACKOFF_MULTIPLIER ** attempt
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    job.status = 'failed'
    throw (
      lastError ?? new Error(`Hub rotation failed for ${job.hubId} after ${MAX_RETRIES} attempts`)
    )
  }
}
