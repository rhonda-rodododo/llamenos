import { describe, expect, test } from 'bun:test'
import type { Database } from '../db'
import { RecoveryService } from './recovery-service'

/**
 * In-memory mock database that tracks recovery_requests rows.
 * Implements just enough of the Drizzle query builder chain to
 * exercise RecoveryService logic without a real Postgres connection.
 */
function createMockDb() {
  const rows: Array<Record<string, unknown>> = []
  let idCounter = 0

  function findRows(filters: Record<string, unknown>) {
    return rows.filter((r) => {
      for (const [key, val] of Object.entries(filters)) {
        if (r[key] !== val) return false
      }
      return true
    })
  }

  // The mock builds a chain that captures method calls and resolves
  // in .returning() / .limit() / the terminal await.
  function createChain(
    op: 'select' | 'insert' | 'update',
    state: {
      table?: string
      values?: Record<string, unknown>
      setData?: Record<string, unknown>
      filters: Record<string, unknown>
      returning?: Record<string, string>
      limitN?: number
      selectFields?: Record<string, unknown>
    }
  ) {
    const chain: Record<string, unknown> = {}

    // .from()
    chain.from = (_table: unknown) => {
      state.table = 'recovery_requests'
      return chain
    }

    // .values()
    chain.values = (vals: Record<string, unknown>) => {
      state.values = vals
      return chain
    }

    // .set()
    chain.set = (data: Record<string, unknown>) => {
      state.setData = data
      return chain
    }

    // .where() — parses drizzle-orm eq/and/lt calls by duck-typing the SQL objects
    chain.where = (condition: unknown) => {
      // We parse the condition objects produced by drizzle-orm's eq/and/lt.
      // Since these are opaque SQL objects, we extract filter info from their
      // serialized representation for our mock purposes.
      parseCondition(condition, state.filters)
      return chain
    }

    // .limit()
    chain.limit = (n: number) => {
      state.limitN = n
      return chain
    }

    // .returning()
    chain.returning = (fields?: Record<string, unknown>) => {
      state.returning = fields
        ? Object.fromEntries(Object.entries(fields).map(([k]) => [k, k]))
        : undefined

      if (op === 'insert' && state.values) {
        const newRow: Record<string, unknown> = {
          id: `mock-id-${++idCounter}`,
          userId: state.values.userId,
          initiatedByUserId: state.values.initiatedByUserId,
          recoveryType: state.values.recoveryType ?? 'admin_reset',
          status: state.values.status ?? 'pending',
          threshold: state.values.threshold ?? 2,
          participantsCount: state.values.participantsCount ?? 0,
          createdAt: new Date(),
          completedAt: null,
          expiredAt: null,
          newDeviceId: null,
          sigchainEntryId: null,
        }
        rows.push(newRow)
        return Promise.resolve(
          state.returning
            ? [Object.fromEntries(Object.keys(state.returning).map((k) => [k, newRow[k]]))]
            : [newRow]
        )
      }

      if (op === 'update' && state.setData) {
        const matched = findRows(state.filters)
        const updated: Array<Record<string, unknown>> = []
        for (const row of matched) {
          Object.assign(row, state.setData)
          updated.push(
            state.returning
              ? Object.fromEntries(Object.keys(state.returning).map((k) => [k, row[k]]))
              : row
          )
        }
        return Promise.resolve(updated)
      }

      return Promise.resolve([])
    }

    // Make the chain thenable for select operations (drizzle returns thenables)
    Object.defineProperty(chain, 'then', {
      value: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
        try {
          if (op === 'select') {
            let matched = findRows(state.filters)
            if (state.limitN !== undefined) {
              matched = matched.slice(0, state.limitN)
            }
            resolve(matched)
          } else if (op === 'update' && !state.returning) {
            const matched = findRows(state.filters)
            for (const row of matched) {
              Object.assign(row, state.setData)
            }
            resolve(matched)
          } else {
            resolve([])
          }
        } catch (err) {
          reject(err)
        }
      },
      writable: true,
      enumerable: false,
      configurable: true,
    })

    return chain
  }

  function parseCondition(condition: unknown, filters: Record<string, unknown>) {
    if (!condition || typeof condition !== 'object') return

    // drizzle-orm SQL objects have various internal shapes. For our mock,
    // we rely on the fact that we know exactly which columns/values the
    // service queries. We intercept the column name from the SQL chunk.
    const cond = condition as Record<string, unknown>

    // `and()` wraps children in a queryChunks array
    if (Array.isArray(cond.queryChunks)) {
      for (const child of cond.queryChunks) {
        parseCondition(child, filters)
      }
    }

    // `eq()` produces an object with left (column) and right (value)
    // We need to extract the column name and the value.
    // The column ref has a `.name` property with the DB column name.
    if ('left' in cond && 'right' in cond) {
      const left = cond.left as Record<string, unknown>
      const right = cond.right as unknown
      const colName = left?.name as string | undefined

      if (colName && right !== undefined) {
        // Map DB column names to our row property names
        const colMap: Record<string, string> = {
          id: 'id',
          user_id: 'userId',
          status: 'status',
          created_at: 'createdAt',
        }
        const propName = colMap[colName] ?? colName
        filters[propName] = right
      }
    }
  }

  // Build the mock Database-like object
  const mockDb = {
    select: (fields?: Record<string, unknown>) =>
      createChain('select', { filters: {}, selectFields: fields }),
    insert: (_table: unknown) => createChain('insert', { filters: {} }),
    update: (_table: unknown) => createChain('update', { filters: {} }),
    _rows: rows,
  }

  return mockDb as unknown as Database & { _rows: Array<Record<string, unknown>> }
}

describe('RecoveryService', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000'
  const adminUserId = '660e8400-e29b-41d4-a716-446655440001'

  test('initiateRecovery creates a pending request', async () => {
    const db = createMockDb()
    const svc = new RecoveryService(db)

    const result = await svc.initiateRecovery({
      userId,
      initiatedByUserId: adminUserId,
      recoveryType: 'admin_reset',
      threshold: 3,
    })

    expect(result.recoveryRequestId).toBeTruthy()
    expect(db._rows.length).toBe(1)
    expect(db._rows[0].status).toBe('pending')
    expect(db._rows[0].threshold).toBe(3)
    expect(db._rows[0].participantsCount).toBe(0)
  })

  test('addParticipant increments participant count', async () => {
    const db = createMockDb()
    const svc = new RecoveryService(db)

    const { recoveryRequestId } = await svc.initiateRecovery({
      userId,
      initiatedByUserId: adminUserId,
      recoveryType: 'recovery_group',
      threshold: 3,
    })

    const result = await svc.addParticipant({
      recoveryRequestId,
      participantUserId: 'participant-1',
      sharePayload: 'encrypted-share-data-1',
    })

    expect(result.participantsCount).toBe(1)
    expect(result.thresholdMet).toBe(false)
  })

  test('addParticipant returns thresholdMet: true when threshold reached', async () => {
    const db = createMockDb()
    const svc = new RecoveryService(db)

    const { recoveryRequestId } = await svc.initiateRecovery({
      userId,
      initiatedByUserId: adminUserId,
      recoveryType: 'recovery_group',
      threshold: 2,
    })

    await svc.addParticipant({
      recoveryRequestId,
      participantUserId: 'participant-1',
      sharePayload: 'share-1',
    })

    const result = await svc.addParticipant({
      recoveryRequestId,
      participantUserId: 'participant-2',
      sharePayload: 'share-2',
    })

    expect(result.participantsCount).toBe(2)
    expect(result.thresholdMet).toBe(true)
  })

  test('completeRecovery updates status to completed', async () => {
    const db = createMockDb()
    const svc = new RecoveryService(db)

    const { recoveryRequestId } = await svc.initiateRecovery({
      userId,
      initiatedByUserId: adminUserId,
      recoveryType: 'admin_reset',
    })

    await svc.completeRecovery({
      recoveryRequestId,
      newDeviceId: 'new-device-abc',
      sigchainEntryId: 'sigchain-entry-123',
    })

    const request = await svc.getRecoveryRequest(recoveryRequestId)
    expect(request).not.toBeNull()
    expect(request!.status).toBe('completed')
    expect(request!.newDeviceId).toBe('new-device-abc')
    expect(request!.sigchainEntryId).toBe('sigchain-entry-123')
    expect(request!.completedAt).toBeInstanceOf(Date)
  })

  test('completeRecovery on non-pending request throws', async () => {
    const db = createMockDb()
    const svc = new RecoveryService(db)

    const { recoveryRequestId } = await svc.initiateRecovery({
      userId,
      initiatedByUserId: adminUserId,
      recoveryType: 'admin_reset',
    })

    // Complete it first
    await svc.completeRecovery({
      recoveryRequestId,
      newDeviceId: 'device-1',
      sigchainEntryId: 'entry-1',
    })

    // Try to complete again — should throw
    await expect(
      svc.completeRecovery({
        recoveryRequestId,
        newDeviceId: 'device-2',
        sigchainEntryId: 'entry-2',
      })
    ).rejects.toThrow(/not pending|status is 'completed'/)
  })

  test('expireStaleRecoveries marks old pending requests as expired', async () => {
    const db = createMockDb()
    const svc = new RecoveryService(db)

    const { recoveryRequestId } = await svc.initiateRecovery({
      userId,
      initiatedByUserId: adminUserId,
      recoveryType: 'admin_reset',
    })

    // Backdate the createdAt to make it stale
    const row = db._rows.find((r) => r.id === recoveryRequestId)
    expect(row).toBeTruthy()
    row!.createdAt = new Date(Date.now() - 100_000_000) // ~27 hours ago

    const count = await svc.expireStaleRecoveries(86_400_000) // 24h

    expect(count).toBe(1)
    expect(row!.status).toBe('expired')
    expect(row!.expiredAt).toBeInstanceOf(Date)
  })
})
