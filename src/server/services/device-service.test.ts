/**
 * Unit tests for DeviceService — Tier 3 device CRUD.
 *
 * Uses a fake in-memory store behind the Drizzle Database interface so tests
 * run without a live Postgres instance. The fake intercepts `select`, `insert`,
 * and `update` chains to exercise the service's query logic.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { type DeviceRow, DeviceService, type RegisterDeviceParams } from './device-service'

// ---- fixtures ----

const USER_ID = '11111111-1111-4111-8111-111111111111'
const DEVICE_1_ID = 'device-aaa'
const DEVICE_2_ID = 'device-bbb'
const SIGNING_PUB_1 = 'aa'.repeat(32)
const SIGNING_PUB_2 = 'bb'.repeat(32)
const ENC_PUB_1 = 'cc'.repeat(32)
const ENC_PUB_2 = 'dd'.repeat(32)

function makeDevice(overrides: Partial<DeviceRow> = {}): DeviceRow {
  const now = new Date()
  return {
    deviceId: DEVICE_1_ID,
    userId: USER_ID,
    signingPubkey: SIGNING_PUB_1,
    encryptionPubkey: ENC_PUB_1,
    encryptedDisplayName: 'enc:My Device',
    addedByDeviceId: null,
    addedSigchainEntryId: 'entry-1',
    revokedAt: null,
    revokedBySigchainEntryId: null,
    revokedReason: null,
    createdAt: now,
    lastSeenAt: now,
    ...overrides,
  }
}

// ---- fake database ----

interface PukEnvelopeRow {
  id: string
  userId: string
  deviceId: string
  generation: number
  envelope: string
  sigchainEntryId: string
  createdAt: Date
}

/**
 * A promise-returning chain that mimics enough of the Drizzle query builder
 * for DeviceService. Each terminal method (limit, where on update) returns a
 * real Promise so we avoid adding `then` to plain objects (which biome flags).
 */
function createFakeDb() {
  const devices: DeviceRow[] = []
  const envelopes: PukEnvelopeRow[] = []

  function resolveRows(tableName: string, fields?: Record<string, unknown>): Promise<unknown[]> {
    if (tableName === 'userDevices') {
      const result = fields
        ? devices.map((d) => {
            const r: Record<string, unknown> = {}
            for (const key of Object.keys(fields))
              r[key] = (d as unknown as Record<string, unknown>)[key]
            return r
          })
        : [...devices]
      return Promise.resolve(result)
    }
    if (tableName === 'userPukEnvelopes') {
      const result = fields
        ? envelopes.map((e) => {
            const r: Record<string, unknown> = {}
            for (const key of Object.keys(fields))
              r[key] = (e as unknown as Record<string, unknown>)[key]
            return r
          })
        : [...envelopes]
      return Promise.resolve(result)
    }
    return Promise.resolve([])
  }

  function detectTable(table: unknown): string {
    const t = table as Record<string, unknown>
    if (t.signingPubkey !== undefined) return 'userDevices'
    if (t.envelope !== undefined) return 'userPukEnvelopes'
    if (t.roles !== undefined) return 'users'
    return 'unknown'
  }

  /**
   * Wrap an object in a Proxy that intercepts `then` to make it awaitable,
   * just like Drizzle query builders. The Proxy approach avoids adding an
   * explicit `then` property which biome's noThenProperty rule flags.
   */
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

  function selectChain(fields?: Record<string, unknown>) {
    let tableName = ''

    const makeChainable = (): Record<string, unknown> => {
      const promise = () => resolveRows(tableName, fields)
      const obj = {
        from(table: unknown) {
          tableName = detectTable(table)
          return makeChainable()
        },
        where(_condition: unknown) {
          return makeChainable()
        },
        limit(_n: number) {
          // Terminal — return the actual promise
          return promise()
        },
        orderBy() {
          return makeChainable()
        },
      }
      return thennable(obj, promise)
    }

    return makeChainable()
  }

  function insertChain(table: unknown) {
    const tableName = detectTable(table)

    return {
      values(row: Record<string, unknown>) {
        if (tableName === 'userDevices') {
          const now = new Date()
          devices.push({
            deviceId: row.deviceId as string,
            userId: row.userId as string,
            signingPubkey: row.signingPubkey as string,
            encryptionPubkey: row.encryptionPubkey as string,
            encryptedDisplayName: row.encryptedDisplayName as string,
            addedByDeviceId: (row.addedByDeviceId as string) ?? null,
            addedSigchainEntryId: row.addedSigchainEntryId as string,
            revokedAt: null,
            revokedBySigchainEntryId: null,
            revokedReason: null,
            createdAt: now,
            lastSeenAt: now,
          })
        } else {
          envelopes.push({
            id: row.id as string,
            userId: row.userId as string,
            deviceId: row.deviceId as string,
            generation: row.generation as number,
            envelope: row.envelope as string,
            sigchainEntryId: row.sigchainEntryId as string,
            createdAt: new Date(),
          })
        }
        return Promise.resolve()
      },
    }
  }

  function updateChain(_table: unknown) {
    return {
      set(values: Record<string, unknown>) {
        return {
          where(_condition: unknown) {
            // Apply the set to the first device (tests control population)
            if (devices.length > 0) {
              const d = devices[0]
              if (values.revokedAt !== undefined) d.revokedAt = values.revokedAt as Date
              if (values.revokedBySigchainEntryId !== undefined)
                d.revokedBySigchainEntryId = values.revokedBySigchainEntryId as string | null
              if (values.revokedReason !== undefined)
                d.revokedReason = values.revokedReason as string | null
            }
            return Promise.resolve()
          },
        }
      },
    }
  }

  const fakeDb = {
    select(fields?: Record<string, unknown>) {
      return selectChain(fields)
    },
    insert(table: unknown) {
      return insertChain(table)
    },
    update(table: unknown) {
      return updateChain(table)
    },
    // Expose internals for assertions
    _devices: devices,
    _envelopes: envelopes,
  }

  return fakeDb
}

// ---- tests ----

describe('DeviceService', () => {
  let fakeDb: ReturnType<typeof createFakeDb>
  let service: DeviceService

  beforeEach(() => {
    fakeDb = createFakeDb()
    // Cast the fake to Database — it implements the subset DeviceService uses
    service = new DeviceService(fakeDb as never)
  })

  describe('registerDevice', () => {
    test('inserts a device into the store', async () => {
      const params: RegisterDeviceParams = {
        deviceId: DEVICE_1_ID,
        userId: USER_ID,
        signingPubkey: SIGNING_PUB_1,
        encryptionPubkey: ENC_PUB_1,
        encryptedDisplayName: 'enc:Laptop',
        addedSigchainEntryId: 'entry-1',
      }
      await service.registerDevice(params)
      expect(fakeDb._devices).toHaveLength(1)
      expect(fakeDb._devices[0].deviceId).toBe(DEVICE_1_ID)
      expect(fakeDb._devices[0].signingPubkey).toBe(SIGNING_PUB_1)
      expect(fakeDb._devices[0].revokedAt).toBeNull()
    })

    test('sets addedByDeviceId when provided', async () => {
      await service.registerDevice({
        deviceId: DEVICE_2_ID,
        userId: USER_ID,
        signingPubkey: SIGNING_PUB_2,
        encryptionPubkey: ENC_PUB_2,
        encryptedDisplayName: 'enc:Phone',
        addedByDeviceId: DEVICE_1_ID,
        addedSigchainEntryId: 'entry-2',
      })
      expect(fakeDb._devices[0].addedByDeviceId).toBe(DEVICE_1_ID)
    })
  })

  describe('revokeDevice', () => {
    test('sets revokedAt and reason on the device', async () => {
      fakeDb._devices.push(makeDevice())

      await service.revokeDevice({
        deviceId: DEVICE_1_ID,
        revokedBySigchainEntryId: 'entry-revoke',
        revokedReason: 'lost',
      })
      expect(fakeDb._devices[0].revokedAt).toBeInstanceOf(Date)
      expect(fakeDb._devices[0].revokedBySigchainEntryId).toBe('entry-revoke')
      expect(fakeDb._devices[0].revokedReason).toBe('lost')
    })

    test('defaults revokedReason to null when not provided', async () => {
      fakeDb._devices.push(makeDevice())

      await service.revokeDevice({
        deviceId: DEVICE_1_ID,
        revokedBySigchainEntryId: 'entry-revoke',
      })
      expect(fakeDb._devices[0].revokedReason).toBeNull()
    })
  })

  describe('findDeviceBySigningPubkey', () => {
    test('returns the device when found', async () => {
      fakeDb._devices.push(makeDevice())

      const result = await service.findDeviceBySigningPubkey(SIGNING_PUB_1)
      expect(result).not.toBeNull()
      expect(result?.deviceId).toBe(DEVICE_1_ID)
    })

    test('returns null when store is empty', async () => {
      const result = await service.findDeviceBySigningPubkey('ff'.repeat(32))
      expect(result).toBeNull()
    })
  })

  describe('findDeviceById', () => {
    test('returns the device when found', async () => {
      fakeDb._devices.push(makeDevice())

      const result = await service.findDeviceById(DEVICE_1_ID)
      expect(result).not.toBeNull()
      expect(result?.signingPubkey).toBe(SIGNING_PUB_1)
    })

    test('returns null when store is empty', async () => {
      const result = await service.findDeviceById('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('listActiveDevices', () => {
    test('returns active devices for a user', async () => {
      fakeDb._devices.push(makeDevice())

      const result = await service.listActiveDevices(USER_ID)
      expect(result).toHaveLength(1)
      expect(result[0].deviceId).toBe(DEVICE_1_ID)
    })

    test('returns empty array when no devices exist', async () => {
      const result = await service.listActiveDevices(USER_ID)
      expect(result).toHaveLength(0)
    })
  })

  describe('storePukEnvelope', () => {
    test('inserts an envelope into the store', async () => {
      await service.storePukEnvelope({
        id: 'env-1',
        userId: USER_ID,
        deviceId: DEVICE_1_ID,
        generation: 1,
        envelope: 'encrypted-puk-data',
        sigchainEntryId: 'entry-puk',
      })
      expect(fakeDb._envelopes).toHaveLength(1)
      expect(fakeDb._envelopes[0].envelope).toBe('encrypted-puk-data')
      expect(fakeDb._envelopes[0].generation).toBe(1)
    })
  })

  describe('getPukEnvelope', () => {
    test('returns the envelope string when found', async () => {
      fakeDb._envelopes.push({
        id: 'env-1',
        userId: USER_ID,
        deviceId: DEVICE_1_ID,
        generation: 1,
        envelope: 'encrypted-puk-data',
        sigchainEntryId: 'entry-puk',
        createdAt: new Date(),
      })

      const result = await service.getPukEnvelope(DEVICE_1_ID, 1)
      expect(result).toBe('encrypted-puk-data')
    })

    test('returns null when no envelope exists', async () => {
      const result = await service.getPukEnvelope(DEVICE_1_ID, 99)
      expect(result).toBeNull()
    })
  })
})
