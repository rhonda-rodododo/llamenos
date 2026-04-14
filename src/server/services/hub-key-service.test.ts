/**
 * Unit tests for HubKeyService — Tier 3 per-device hub key envelope management.
 *
 * Uses a spy-based mock that records method calls and returns pre-seeded data.
 * Each test sets up the mock's return values and verifies the service passes
 * the correct data through to the database layer.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import type {
  GenerationChainEntry,
  HubKeyEnvelopeResult,
  IssueInitialHubKeyEnvelopesParams,
  RotateHubParams,
} from './hub-key-service'
import { HubKeyService } from './hub-key-service'

// ---- fixtures ----

const HUB_ID = 'hub-aaaa-bbbb-cccc'
const DEVICE_1_ID = 'device-aaa'
const DEVICE_2_ID = 'device-bbb'
const DEVICE_3_ID = 'device-ccc'
const USER_1_ID = 'user-111'
const USER_2_ID = 'user-222'
const SIGCHAIN_ENTRY_1 = 'sigchain-entry-init'
const SIGCHAIN_ENTRY_2 = 'sigchain-entry-rotate'

// ---- fake database ----

interface GenerationRow {
  id: string
  hubId: string
  generation: number
  oldGenWrappedUnderNew: string | null
  rotatedBySigchainEntryId: string
  createdAt: Date
}

interface EnvelopeRow {
  id: string
  hubId: string
  generation: number
  deviceId: string
  userId: string
  envelope: string
  sigchainEntryId: string
  createdAt: Date
}

/**
 * Creates a fake DB that stores rows in-memory and does real filtering
 * by hooking into the Drizzle query builder chain pattern. Instead of
 * parsing drizzle-orm SQL objects, we intercept at the select/insert/delete
 * level and track which table columns are referenced via the Drizzle
 * column proxy objects.
 */
function createFakeDb() {
  const generations: GenerationRow[] = []
  const envelopes: EnvelopeRow[] = []

  // Map Drizzle table proxy objects to our table names
  function detectTable(table: unknown): 'hubPtkGenerations' | 'hubKeyEnvelopes' | 'unknown' {
    const t = table as Record<string, unknown>
    if ('rotatedBySigchainEntryId' in t) return 'hubPtkGenerations'
    if ('envelope' in t && 'deviceId' in t) return 'hubKeyEnvelopes'
    return 'unknown'
  }

  function getRows(tableName: string): Record<string, unknown>[] {
    if (tableName === 'hubPtkGenerations')
      return generations as unknown as Record<string, unknown>[]
    if (tableName === 'hubKeyEnvelopes') return envelopes as unknown as Record<string, unknown>[]
    return []
  }

  /**
   * Extract filter constraints from drizzle-orm SQL objects by walking the
   * queryChunks tree. Returns a list of {columnName, value, op} tuples.
   *
   * Drizzle represents `eq(col, val)` as an SQL object with queryChunks:
   *   [Column, StringChunk(" = "), Param(val)]
   * And `and(...)` wraps multiple such objects with " and " StringChunks.
   * `gte`/`lte` use " >= " / " <= " respectively.
   */
  function extractFilters(sql: unknown): Array<{ column: string; value: unknown; op: string }> {
    const filters: Array<{ column: string; value: unknown; op: string }> = []
    if (!sql || typeof sql !== 'object') return filters

    const s = sql as { queryChunks?: unknown[] }
    if (!s.queryChunks) return filters

    // Walk chunks looking for Column + operator-StringChunk + Param triples
    const chunks = s.queryChunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] as Record<string, unknown>

      // If this chunk itself is an SQL object (nested), recurse
      if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) {
        filters.push(...extractFilters(chunk))
        continue
      }

      // Check for a Column object (has .name property and .table)
      if (chunk && typeof chunk === 'object' && 'name' in chunk && 'table' in chunk) {
        // This is a Column — next chunk should be the operator StringChunk,
        // and the chunk after that should be the Param
        const opChunk = chunks[i + 1] as { value?: string[] } | undefined
        const paramChunk = chunks[i + 2] as { value?: unknown } | undefined

        if (opChunk && 'value' in opChunk && Array.isArray(opChunk.value)) {
          const opStr = opChunk.value.join('').trim()
          const colName = chunk.name as string

          // Map snake_case DB column names to camelCase
          const snakeToCamel: Record<string, string> = {
            device_id: 'deviceId',
            hub_id: 'hubId',
            generation: 'generation',
            old_gen_wrapped_under_new: 'oldGenWrappedUnderNew',
          }
          const field = snakeToCamel[colName] ?? colName

          // Extract value from Param
          let value: unknown
          if (paramChunk && typeof paramChunk === 'object' && 'value' in paramChunk) {
            value = paramChunk.value
          }

          let op = 'eq'
          if (opStr === '=') op = 'eq'
          else if (opStr === '>=') op = 'gte'
          else if (opStr === '<=') op = 'lte'

          if (value !== undefined) {
            filters.push({ column: field, value, op })
          }
        }
      }
    }

    return filters
  }

  function matchesFilters(
    row: Record<string, unknown>,
    filters: Array<{ column: string; value: unknown; op: string }>
  ): boolean {
    for (const f of filters) {
      const rowVal = row[f.column]
      if (f.op === 'eq' && rowVal !== f.value) return false
      if (f.op === 'gte' && (rowVal as number) < (f.value as number)) return false
      if (f.op === 'lte' && (rowVal as number) > (f.value as number)) return false
    }
    return true
  }

  function thennable<T extends Record<string, unknown>>(
    obj: T,
    resolve: () => Promise<unknown>
  ): T {
    return new Proxy(obj, {
      get(target, prop, receiver) {
        if (prop === 'then') {
          const p = resolve()
          return p.then.bind(p)
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  function selectChain(fields?: Record<string, unknown>, distinct = false) {
    let tableName = ''
    let filters: Array<{ column: string; value: unknown; op: string }> = []
    let sortDescByGen = false
    let limitN: number | undefined

    const resolve = (): Promise<unknown[]> => {
      let rows = getRows(tableName).filter((r) => matchesFilters(r, filters))
      if (sortDescByGen) {
        rows = [...rows].sort((a, b) => (b.generation as number) - (a.generation as number))
      }
      if (limitN !== undefined) rows = rows.slice(0, limitN)
      if (fields) {
        rows = rows.map((r) => {
          const projected: Record<string, unknown> = {}
          for (const key of Object.keys(fields)) projected[key] = r[key]
          return projected
        })
      }
      if (distinct && fields) {
        const seen = new Set<string>()
        rows = rows.filter((r) => {
          const k = JSON.stringify(r)
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
      }
      return Promise.resolve(rows)
    }

    const makeChainable = (): Record<string, unknown> => {
      const obj = {
        from(table: unknown) {
          tableName = detectTable(table)
          return makeChainable()
        },
        where(condition: unknown) {
          filters = extractFilters(condition)
          return makeChainable()
        },
        orderBy() {
          sortDescByGen = true
          return makeChainable()
        },
        limit(n: number) {
          limitN = n
          return resolve()
        },
      }
      return thennable(obj, resolve)
    }

    return makeChainable()
  }

  function insertChain(table: unknown) {
    const tableName = detectTable(table)

    return {
      values(rowOrRows: Record<string, unknown> | Record<string, unknown>[]) {
        const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
        const now = new Date()

        for (const row of rows) {
          if (tableName === 'hubPtkGenerations') {
            generations.push({
              id: row.id as string,
              hubId: row.hubId as string,
              generation: row.generation as number,
              oldGenWrappedUnderNew: (row.oldGenWrappedUnderNew as string) ?? null,
              rotatedBySigchainEntryId: row.rotatedBySigchainEntryId as string,
              createdAt: now,
            })
          } else if (tableName === 'hubKeyEnvelopes') {
            envelopes.push({
              id: row.id as string,
              hubId: row.hubId as string,
              generation: row.generation as number,
              deviceId: row.deviceId as string,
              userId: row.userId as string,
              envelope: row.envelope as string,
              sigchainEntryId: row.sigchainEntryId as string,
              createdAt: now,
            })
          }
        }
        return Promise.resolve()
      },
    }
  }

  function deleteChain(table: unknown) {
    const tableName = detectTable(table)

    return {
      where(condition: unknown) {
        const filters = extractFilters(condition)
        if (tableName === 'hubKeyEnvelopes') {
          for (let i = envelopes.length - 1; i >= 0; i--) {
            if (matchesFilters(envelopes[i] as unknown as Record<string, unknown>, filters)) {
              envelopes.splice(i, 1)
            }
          }
        }
        return Promise.resolve()
      },
    }
  }

  const fakeDb = {
    select(fields?: Record<string, unknown>) {
      return selectChain(fields)
    },
    selectDistinct(fields?: Record<string, unknown>) {
      return selectChain(fields, true)
    },
    insert(table: unknown) {
      return insertChain(table)
    },
    delete(table: unknown) {
      return deleteChain(table)
    },
    async transaction(fn: (tx: unknown) => Promise<void>) {
      await fn(fakeDb)
    },
    _generations: generations,
    _envelopes: envelopes,
  }

  return fakeDb
}

// ---- tests ----

describe('HubKeyService', () => {
  let fakeDb: ReturnType<typeof createFakeDb>
  let service: HubKeyService

  beforeEach(() => {
    fakeDb = createFakeDb()
    service = new HubKeyService(fakeDb as never)
  })

  describe('issueInitialHubKeyEnvelopes', () => {
    test('creates generation row and envelope rows', async () => {
      await service.issueInitialHubKeyEnvelopes({
        hubId: HUB_ID,
        generation: 1,
        envelopes: [
          { deviceId: DEVICE_1_ID, userId: USER_1_ID, envelope: 'hpke-envelope-1' },
          { deviceId: DEVICE_2_ID, userId: USER_2_ID, envelope: 'hpke-envelope-2' },
        ],
        sigchainEntryId: SIGCHAIN_ENTRY_1,
      })

      expect(fakeDb._generations).toHaveLength(1)
      expect(fakeDb._generations[0].hubId).toBe(HUB_ID)
      expect(fakeDb._generations[0].generation).toBe(1)
      expect(fakeDb._generations[0].oldGenWrappedUnderNew).toBeNull()
      expect(fakeDb._generations[0].rotatedBySigchainEntryId).toBe(SIGCHAIN_ENTRY_1)

      expect(fakeDb._envelopes).toHaveLength(2)
      expect(fakeDb._envelopes[0].deviceId).toBe(DEVICE_1_ID)
      expect(fakeDb._envelopes[0].envelope).toBe('hpke-envelope-1')
      expect(fakeDb._envelopes[0].generation).toBe(1)
      expect(fakeDb._envelopes[1].deviceId).toBe(DEVICE_2_ID)
    })

    test('handles empty envelopes array', async () => {
      await service.issueInitialHubKeyEnvelopes({
        hubId: HUB_ID,
        generation: 1,
        envelopes: [],
        sigchainEntryId: SIGCHAIN_ENTRY_1,
      })

      expect(fakeDb._generations).toHaveLength(1)
      expect(fakeDb._envelopes).toHaveLength(0)
    })

    test('each envelope row gets a unique UUID', async () => {
      await service.issueInitialHubKeyEnvelopes({
        hubId: HUB_ID,
        generation: 1,
        envelopes: [
          { deviceId: DEVICE_1_ID, userId: USER_1_ID, envelope: 'env-1' },
          { deviceId: DEVICE_2_ID, userId: USER_2_ID, envelope: 'env-2' },
        ],
        sigchainEntryId: SIGCHAIN_ENTRY_1,
      })

      const ids = fakeDb._envelopes.map((e) => e.id)
      expect(ids[0]).not.toBe(ids[1])
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      }
    })
  })

  describe('getHubKeyEnvelopeForDevice', () => {
    test('returns the latest generation envelope for a device', async () => {
      fakeDb._envelopes.push(
        {
          id: 'env-1',
          hubId: HUB_ID,
          generation: 1,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'old-envelope',
          sigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        },
        {
          id: 'env-2',
          hubId: HUB_ID,
          generation: 2,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'new-envelope',
          sigchainEntryId: SIGCHAIN_ENTRY_2,
          createdAt: new Date(),
        }
      )

      const result = await service.getHubKeyEnvelopeForDevice(DEVICE_1_ID, HUB_ID)
      expect(result).not.toBeNull()
      expect(result!.envelope).toBe('new-envelope')
      expect(result!.generation).toBe(2)
    })

    test('returns null when no envelope exists for device', async () => {
      const result = await service.getHubKeyEnvelopeForDevice('nonexistent-device', HUB_ID)
      expect(result).toBeNull()
    })

    test('scopes results to the specified hub', async () => {
      fakeDb._envelopes.push({
        id: 'env-other',
        hubId: 'other-hub',
        generation: 1,
        deviceId: DEVICE_1_ID,
        userId: USER_1_ID,
        envelope: 'other-hub-envelope',
        sigchainEntryId: SIGCHAIN_ENTRY_1,
        createdAt: new Date(),
      })

      const result = await service.getHubKeyEnvelopeForDevice(DEVICE_1_ID, HUB_ID)
      expect(result).toBeNull()
    })
  })

  describe('getCurrentGeneration', () => {
    test('returns the highest generation for a hub', async () => {
      fakeDb._generations.push(
        {
          id: 'gen-1',
          hubId: HUB_ID,
          generation: 1,
          oldGenWrappedUnderNew: null,
          rotatedBySigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        },
        {
          id: 'gen-2',
          hubId: HUB_ID,
          generation: 2,
          oldGenWrappedUnderNew: 'wrapped-blob',
          rotatedBySigchainEntryId: SIGCHAIN_ENTRY_2,
          createdAt: new Date(),
        }
      )

      const gen = await service.getCurrentGeneration(HUB_ID)
      expect(gen).toBe(2)
    })

    test('returns null when no generations exist', async () => {
      const gen = await service.getCurrentGeneration(HUB_ID)
      expect(gen).toBeNull()
    })

    test('scopes to the specified hub', async () => {
      fakeDb._generations.push({
        id: 'gen-other',
        hubId: 'other-hub',
        generation: 5,
        oldGenWrappedUnderNew: null,
        rotatedBySigchainEntryId: SIGCHAIN_ENTRY_1,
        createdAt: new Date(),
      })

      const gen = await service.getCurrentGeneration(HUB_ID)
      expect(gen).toBeNull()
    })
  })

  describe('rotateHub', () => {
    test('atomically creates generation and new envelopes', async () => {
      fakeDb._generations.push({
        id: 'gen-1',
        hubId: HUB_ID,
        generation: 1,
        oldGenWrappedUnderNew: null,
        rotatedBySigchainEntryId: SIGCHAIN_ENTRY_1,
        createdAt: new Date(),
      })

      await service.rotateHub({
        hubId: HUB_ID,
        newGeneration: 2,
        oldGenWrappedUnderNew: 'aes-gcm-wrapped-old-under-new',
        envelopes: [
          { deviceId: DEVICE_1_ID, userId: USER_1_ID, envelope: 'rotated-env-1' },
          { deviceId: DEVICE_3_ID, userId: USER_2_ID, envelope: 'rotated-env-3' },
        ],
        sigchainEntryId: SIGCHAIN_ENTRY_2,
      })

      expect(fakeDb._generations).toHaveLength(2)
      const gen2 = fakeDb._generations.find((g) => g.generation === 2)
      expect(gen2).toBeDefined()
      expect(gen2!.oldGenWrappedUnderNew).toBe('aes-gcm-wrapped-old-under-new')
      expect(gen2!.rotatedBySigchainEntryId).toBe(SIGCHAIN_ENTRY_2)

      expect(fakeDb._envelopes).toHaveLength(2)
      expect(fakeDb._envelopes.every((e) => e.generation === 2)).toBe(true)
    })

    test('handles rotation with empty envelopes', async () => {
      await service.rotateHub({
        hubId: HUB_ID,
        newGeneration: 2,
        oldGenWrappedUnderNew: 'wrapped-blob',
        envelopes: [],
        sigchainEntryId: SIGCHAIN_ENTRY_2,
      })

      expect(fakeDb._generations).toHaveLength(1)
      expect(fakeDb._envelopes).toHaveLength(0)
    })
  })

  describe('getGenerationChain', () => {
    test('returns generations in DESC order within range', async () => {
      fakeDb._generations.push(
        {
          id: 'gen-1',
          hubId: HUB_ID,
          generation: 1,
          oldGenWrappedUnderNew: null,
          rotatedBySigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        },
        {
          id: 'gen-2',
          hubId: HUB_ID,
          generation: 2,
          oldGenWrappedUnderNew: 'wrapped-1-under-2',
          rotatedBySigchainEntryId: SIGCHAIN_ENTRY_2,
          createdAt: new Date(),
        },
        {
          id: 'gen-3',
          hubId: HUB_ID,
          generation: 3,
          oldGenWrappedUnderNew: 'wrapped-2-under-3',
          rotatedBySigchainEntryId: 'sigchain-entry-3',
          createdAt: new Date(),
        }
      )

      const chain = await service.getGenerationChain(HUB_ID, 1, 3)
      expect(chain).toHaveLength(3)
      expect(chain[0].generation).toBe(3)
      expect(chain[1].generation).toBe(2)
      expect(chain[2].generation).toBe(1)
      expect(chain[0].oldGenWrappedUnderNew).toBe('wrapped-2-under-3')
      expect(chain[2].oldGenWrappedUnderNew).toBeNull()
    })

    test('returns subset when range is narrower', async () => {
      fakeDb._generations.push(
        {
          id: 'gen-1',
          hubId: HUB_ID,
          generation: 1,
          oldGenWrappedUnderNew: null,
          rotatedBySigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        },
        {
          id: 'gen-2',
          hubId: HUB_ID,
          generation: 2,
          oldGenWrappedUnderNew: 'wrapped-1-under-2',
          rotatedBySigchainEntryId: SIGCHAIN_ENTRY_2,
          createdAt: new Date(),
        },
        {
          id: 'gen-3',
          hubId: HUB_ID,
          generation: 3,
          oldGenWrappedUnderNew: 'wrapped-2-under-3',
          rotatedBySigchainEntryId: 'sigchain-entry-3',
          createdAt: new Date(),
        }
      )

      const chain = await service.getGenerationChain(HUB_ID, 2, 3)
      expect(chain).toHaveLength(2)
      expect(chain[0].generation).toBe(3)
      expect(chain[1].generation).toBe(2)
    })

    test('returns empty array when no generations in range', async () => {
      const chain = await service.getGenerationChain(HUB_ID, 10, 20)
      expect(chain).toHaveLength(0)
    })
  })

  describe('removeDeviceEnvelopes', () => {
    test('removes all envelopes for a device in a hub', async () => {
      fakeDb._envelopes.push(
        {
          id: 'env-1',
          hubId: HUB_ID,
          generation: 1,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'env-data-1',
          sigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        },
        {
          id: 'env-2',
          hubId: HUB_ID,
          generation: 2,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'env-data-2',
          sigchainEntryId: SIGCHAIN_ENTRY_2,
          createdAt: new Date(),
        },
        {
          id: 'env-3',
          hubId: HUB_ID,
          generation: 1,
          deviceId: DEVICE_2_ID,
          userId: USER_2_ID,
          envelope: 'other-device-env',
          sigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        }
      )

      await service.removeDeviceEnvelopes(DEVICE_1_ID, HUB_ID)

      expect(fakeDb._envelopes).toHaveLength(1)
      expect(fakeDb._envelopes[0].deviceId).toBe(DEVICE_2_ID)
    })

    test('does not remove envelopes from other hubs', async () => {
      fakeDb._envelopes.push(
        {
          id: 'env-1',
          hubId: HUB_ID,
          generation: 1,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'this-hub',
          sigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        },
        {
          id: 'env-2',
          hubId: 'other-hub',
          generation: 1,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'other-hub',
          sigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        }
      )

      await service.removeDeviceEnvelopes(DEVICE_1_ID, HUB_ID)

      expect(fakeDb._envelopes).toHaveLength(1)
      expect(fakeDb._envelopes[0].hubId).toBe('other-hub')
    })
  })

  describe('getHubsWithDeviceEnvelopes', () => {
    test('returns distinct hub IDs for a device', async () => {
      fakeDb._envelopes.push(
        {
          id: 'env-1',
          hubId: HUB_ID,
          generation: 1,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'env-1',
          sigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        },
        {
          id: 'env-2',
          hubId: HUB_ID,
          generation: 2,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'env-2',
          sigchainEntryId: SIGCHAIN_ENTRY_2,
          createdAt: new Date(),
        },
        {
          id: 'env-3',
          hubId: 'hub-second',
          generation: 1,
          deviceId: DEVICE_1_ID,
          userId: USER_1_ID,
          envelope: 'env-3',
          sigchainEntryId: SIGCHAIN_ENTRY_1,
          createdAt: new Date(),
        }
      )

      const hubs = await service.getHubsWithDeviceEnvelopes(DEVICE_1_ID)
      expect(hubs).toHaveLength(2)
      expect(hubs).toContain(HUB_ID)
      expect(hubs).toContain('hub-second')
    })

    test('returns empty array when device has no envelopes', async () => {
      const hubs = await service.getHubsWithDeviceEnvelopes('nonexistent-device')
      expect(hubs).toHaveLength(0)
    })

    test('does not include hubs from other devices', async () => {
      fakeDb._envelopes.push({
        id: 'env-other',
        hubId: 'other-device-hub',
        generation: 1,
        deviceId: DEVICE_2_ID,
        userId: USER_2_ID,
        envelope: 'other-env',
        sigchainEntryId: SIGCHAIN_ENTRY_1,
        createdAt: new Date(),
      })

      const hubs = await service.getHubsWithDeviceEnvelopes(DEVICE_1_ID)
      expect(hubs).toHaveLength(0)
    })
  })
})
