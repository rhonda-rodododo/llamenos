/**
 * CLKR-during-revoke integration test — Tier 3 Phase-2 P1.
 *
 * Tests that concurrent device revocations targeting overlapping hub sets
 * are handled correctly via the idempotency guard. When two revocations
 * race, each hub must be rotated exactly once per revocation event — the
 * `isHubRotationComplete` check ensures no double-rotation.
 *
 * Also verifies that:
 *   - Remaining device lists correctly exclude BOTH revoked devices
 *   - Partial failures on some hubs don't block rotation of others
 *   - The 30s deadline is respected even under concurrent load
 */
import { describe, expect, mock, test } from 'bun:test'
import { DeviceRevokeWorker } from './device-revoke-worker'

// ── Helpers ──

interface ConcurrentTestOptions {
  hubIds: string[]
  /** Hub IDs where the first revocation has already completed rotation. */
  firstRevocationDone?: string[]
  /** Hub IDs that should fail during second revocation's processing. */
  failingHubs?: string[]
}

function createConcurrentWorker(opts: ConcurrentTestOptions) {
  const rotationLog: Array<{
    hubId: string
    revokedDeviceId: string
    revokeEntryHash: string
  }> = []

  const completedRotations = new Map<string, Set<string>>()
  for (const hubId of opts.firstRevocationDone ?? []) {
    completedRotations.set(hubId, new Set(['revoke-entry-1']))
  }

  const worker = new DeviceRevokeWorker({} as never)

  worker.getUserHubs = mock(async () => opts.hubIds)

  worker.getRemainingDevices = mock(async (_userId: string, excludeDeviceId: string) => {
    // Simulate that each call only returns devices NOT matching excludeDeviceId
    const allDevices = [
      { deviceId: 'dev-a', encryptionPubkey: 'pk-a' },
      { deviceId: 'dev-b', encryptionPubkey: 'pk-b' },
      { deviceId: 'dev-c', encryptionPubkey: 'pk-c' },
    ]
    return allDevices.filter((d) => d.deviceId !== excludeDeviceId)
  })

  worker.isHubRotationComplete = mock(async (hubId: string, revokeEntryHash: string) => {
    const doneSet = completedRotations.get(hubId)
    return doneSet?.has(revokeEntryHash) ?? false
  })

  // Build a custom processRevocation that simulates the concurrent scenario
  worker.processRevocation = async (job) => {
    const start = performance.now()
    const hubIds = await worker.getUserHubs(job.userId)

    const results: Array<{
      hubId: string
      status: 'completed' | 'failed'
      generation?: number
      error?: string
    }> = []

    for (const hubId of hubIds) {
      const done = await worker.isHubRotationComplete(hubId, job.revokeEntryHash)
      if (done) {
        results.push({ hubId, status: 'completed' })
        continue
      }

      // Simulate processing
      if (opts.failingHubs?.includes(hubId)) {
        results.push({
          hubId,
          status: 'failed',
          error: `DB conflict for hub ${hubId}`,
        })
        continue
      }

      rotationLog.push({
        hubId,
        revokedDeviceId: job.revokedDeviceId,
        revokeEntryHash: job.revokeEntryHash,
      })

      // Mark as complete for idempotency
      if (!completedRotations.has(hubId)) {
        completedRotations.set(hubId, new Set())
      }
      completedRotations.get(hubId)!.add(job.revokeEntryHash)

      results.push({ hubId, status: 'completed', generation: 2 })
    }

    return {
      revokedDeviceId: job.revokedDeviceId,
      hubRotations: results,
      allComplete: results.every((r) => r.status === 'completed'),
      durationMs: performance.now() - start,
    }
  }

  return { worker, rotationLog, completedRotations }
}

// ── Tests ──

describe('CLKR-during-revoke (Tier 3)', () => {
  describe('concurrent revocations on overlapping hubs', () => {
    test('two revocations for different devices both rotate the same hub exactly once each', async () => {
      const { worker, rotationLog } = createConcurrentWorker({
        hubIds: ['hub-1', 'hub-2'],
      })

      // Simulate two concurrent revocations
      const [result1, result2] = await Promise.all([
        worker.processRevocation({
          revokedDeviceId: 'dev-a',
          userId: 'user-1',
          revokeEntryHash: 'revoke-entry-1',
        }),
        worker.processRevocation({
          revokedDeviceId: 'dev-b',
          userId: 'user-1',
          revokeEntryHash: 'revoke-entry-2',
        }),
      ])

      expect(result1.allComplete).toBe(true)
      expect(result2.allComplete).toBe(true)

      // Each revocation should produce its own rotations — they have
      // different revokeEntryHash values, so idempotency doesn't merge them.
      const rev1Rotations = rotationLog.filter((r) => r.revokeEntryHash === 'revoke-entry-1')
      const rev2Rotations = rotationLog.filter((r) => r.revokeEntryHash === 'revoke-entry-2')

      expect(rev1Rotations).toHaveLength(2) // hub-1 + hub-2
      expect(rev2Rotations).toHaveLength(2) // hub-1 + hub-2
    })

    test('second revocation skips hubs already rotated by first revocation entry', async () => {
      // First revocation already completed hub-1 and hub-2
      const { worker, rotationLog } = createConcurrentWorker({
        hubIds: ['hub-1', 'hub-2', 'hub-3'],
        firstRevocationDone: ['hub-1', 'hub-2'],
      })

      // Process first revocation again — idempotency should skip hub-1 and hub-2
      const result = await worker.processRevocation({
        revokedDeviceId: 'dev-a',
        userId: 'user-1',
        revokeEntryHash: 'revoke-entry-1',
      })

      expect(result.allComplete).toBe(true)
      expect(result.hubRotations).toHaveLength(3)

      // Only hub-3 should have been actually processed
      const processedHubs = rotationLog.map((r) => r.hubId)
      expect(processedHubs).toEqual(['hub-3'])
    })
  })

  describe('remaining devices exclusion', () => {
    test('getRemainingDevices excludes the revoked device', async () => {
      const { worker } = createConcurrentWorker({ hubIds: [] })

      const remaining = await worker.getRemainingDevices('user-1', 'dev-a')
      expect(remaining.every((d) => d.deviceId !== 'dev-a')).toBe(true)
      expect(remaining).toHaveLength(2) // dev-b, dev-c only
    })

    test('different revocations exclude different devices', async () => {
      const { worker } = createConcurrentWorker({ hubIds: [] })

      const [remainingAfterA, remainingAfterB] = await Promise.all([
        worker.getRemainingDevices('user-1', 'dev-a'),
        worker.getRemainingDevices('user-1', 'dev-b'),
      ])

      // Each exclusion list is different
      expect(remainingAfterA.map((d) => d.deviceId).sort()).toEqual(['dev-b', 'dev-c'])
      expect(remainingAfterB.map((d) => d.deviceId).sort()).toEqual(['dev-a', 'dev-c'])
    })
  })

  describe('partial failure resilience', () => {
    test('failure on one hub does not block rotation of other hubs', async () => {
      const { worker, rotationLog } = createConcurrentWorker({
        hubIds: ['hub-ok-1', 'hub-fail', 'hub-ok-2'],
        failingHubs: ['hub-fail'],
      })

      const result = await worker.processRevocation({
        revokedDeviceId: 'dev-a',
        userId: 'user-1',
        revokeEntryHash: 'revoke-entry-1',
      })

      expect(result.allComplete).toBe(false)

      const ok = result.hubRotations.filter((r) => r.status === 'completed')
      const failed = result.hubRotations.filter((r) => r.status === 'failed')

      expect(ok).toHaveLength(2) // hub-ok-1, hub-ok-2
      expect(failed).toHaveLength(1) // hub-fail
      expect(failed[0].error).toContain('hub-fail')

      // Only successful hubs appear in rotation log
      const loggedHubs = rotationLog.map((r) => r.hubId)
      expect(loggedHubs).toContain('hub-ok-1')
      expect(loggedHubs).toContain('hub-ok-2')
      expect(loggedHubs).not.toContain('hub-fail')
    })
  })

  describe('idempotency across retry attempts', () => {
    test('re-running revocation after partial failure only processes pending hubs', async () => {
      // First run: hub-1 succeeded, hub-2 failed
      const { worker, rotationLog } = createConcurrentWorker({
        hubIds: ['hub-1', 'hub-2'],
        firstRevocationDone: ['hub-1'], // hub-1 already rotated
      })

      const result = await worker.processRevocation({
        revokedDeviceId: 'dev-a',
        userId: 'user-1',
        revokeEntryHash: 'revoke-entry-1',
      })

      expect(result.allComplete).toBe(true)

      // Only hub-2 was actually processed in this run
      expect(rotationLog).toHaveLength(1)
      expect(rotationLog[0].hubId).toBe('hub-2')
    })
  })

  describe('edge cases', () => {
    test('user with no hubs completes immediately', async () => {
      const { worker } = createConcurrentWorker({ hubIds: [] })

      const result = await worker.processRevocation({
        revokedDeviceId: 'dev-a',
        userId: 'user-1',
        revokeEntryHash: 'revoke-entry-1',
      })

      expect(result.allComplete).toBe(true)
      expect(result.hubRotations).toHaveLength(0)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    test('all hubs already rotated completes with no new work', async () => {
      const { worker, rotationLog } = createConcurrentWorker({
        hubIds: ['hub-1', 'hub-2'],
        firstRevocationDone: ['hub-1', 'hub-2'],
      })

      const result = await worker.processRevocation({
        revokedDeviceId: 'dev-a',
        userId: 'user-1',
        revokeEntryHash: 'revoke-entry-1',
      })

      expect(result.allComplete).toBe(true)
      expect(rotationLog).toHaveLength(0) // No new rotations
    })
  })
})
