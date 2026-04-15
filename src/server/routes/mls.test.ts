import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

const HUB_ID = 'hub-test-mls'
const DEVICE_ID = 'device-test-1'
const PUBKEY = 'a'.repeat(64)

let mockDbState: {
  mlsHubState: Array<Record<string, unknown>>
  mlsKeyPackages: Array<Record<string, unknown>>
  mlsEpochCommits: Array<Record<string, unknown>>
}

function resetDbState() {
  mockDbState = {
    mlsHubState: [],
    mlsKeyPackages: [],
    mlsEpochCommits: [],
  }
}

let auditEntries: Array<{ hubId: string; event: string; pubkey: string; data: unknown }> = []
let shouldThrowUnique = false

function createMockServices() {
  return {
    records: {
      addAuditEntry: mock(async (hubId: string, event: string, pubkey: string, data: unknown) => {
        auditEntries.push({ hubId, event, pubkey, data })
      }),
    },
  }
}

function buildChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.from = self
  chain.where = self
  chain.limit = () => Promise.resolve(Array.isArray(result) ? result : [result])
  chain.orderBy = () => Promise.resolve(Array.isArray(result) ? result : [result])
  chain.groupBy = () => Promise.resolve(Array.isArray(result) ? result : [result])
  chain.returning = () => Promise.resolve(Array.isArray(result) ? result : [result])
  chain.onConflictDoNothing = () => Promise.resolve()
  return chain
}

mock.module('../db', () => ({
  getDb: () => ({
    select: (..._args: unknown[]) => {
      return {
        from: (table: unknown) => {
          const name = String((table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')] ?? '')
          if (name.includes('hub_state')) {
            return buildChain(mockDbState.mlsHubState)
          }
          if (name.includes('key_packages')) {
            const unconsumed = mockDbState.mlsKeyPackages.filter((p) => !p.consumedAt)
            const counts = Object.entries(
              unconsumed.reduce(
                (acc: Record<string, number>, p) => {
                  const did = p.deviceId as string
                  acc[did] = (acc[did] ?? 0) + 1
                  return acc
                },
                {} as Record<string, number>
              )
            ).map(([deviceId, available]) => ({ deviceId, available }))

            return {
              where: () => {
                if (_args.length > 0 && typeof _args[0] === 'object') {
                  return buildChain(counts)
                }
                return buildChain(
                  unconsumed.length > 0 ? [{ count: unconsumed.length }] : [{ count: 0 }]
                )
              },
              groupBy: () => Promise.resolve(counts),
            }
          }
          if (name.includes('epoch_commits')) {
            return buildChain(mockDbState.mlsEpochCommits)
          }
          return buildChain([])
        },
      }
    },
    insert: (table: unknown) => ({
      values: (data: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const name = String((table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')] ?? '')
        if (name.includes('hub_state')) {
          mockDbState.mlsHubState.push(data as Record<string, unknown>)
        } else if (name.includes('key_packages')) {
          const items = Array.isArray(data) ? data : [data]
          mockDbState.mlsKeyPackages.push(...items)
        } else if (name.includes('epoch_commits')) {
          if (shouldThrowUnique) {
            shouldThrowUnique = false
            throw new Error(
              'duplicate key value violates unique constraint "mls_epoch_commits_hub_epoch_uniq"'
            )
          }
          mockDbState.mlsEpochCommits.push(data as Record<string, unknown>)
        }
        return { onConflictDoNothing: () => Promise.resolve() }
      },
    }),
    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: () => {
          const name = String((table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')] ?? '')
          if (name.includes('hub_state') && mockDbState.mlsHubState.length > 0) {
            Object.assign(mockDbState.mlsHubState[0], data)
            return Promise.resolve()
          }
          if (name.includes('key_packages')) {
            const unconsumed = mockDbState.mlsKeyPackages.find((p) => !p.consumedAt)
            if (unconsumed) {
              unconsumed.consumedAt = new Date()
              return {
                returning: () => Promise.resolve([unconsumed]),
              }
            }
            return { returning: () => Promise.resolve([]) }
          }
          return Promise.resolve()
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => ({
        returning: () => {
          const name = String((table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')] ?? '')
          if (name.includes('epoch_commits')) {
            const deleted = mockDbState.mlsEpochCommits.splice(
              0,
              mockDbState.mlsEpochCommits.length
            )
            return Promise.resolve(deleted.map((d) => ({ id: d.id })))
          }
          return Promise.resolve([])
        },
      }),
    }),
  }),
}))

const { default: mlsRoutes } = await import('./mls')

function createTestApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('pubkey', PUBKEY)
    c.set('permissions', ['*'])
    c.set('services', createMockServices() as unknown as AppEnv['Variables']['services'])
    await next()
  })
  app.route('/mls', mlsRoutes)
  return app
}

describe('MLS Routes', () => {
  let app: ReturnType<typeof createTestApp>

  beforeEach(() => {
    resetDbState()
    auditEntries = []
    shouldThrowUnique = false
    app = createTestApp()
  })

  describe('POST /mls/hub/:hubId/bootstrap', () => {
    test('creates hub state and emits mls_group_init audit event', async () => {
      const res = await app.request(`/mls/hub/${HUB_ID}/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: DEVICE_ID, groupId: `llamenos:hub:${HUB_ID}` }),
      })

      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.hubId).toBe(HUB_ID)
      expect(body.ciphersuite).toBe(1)
      expect(body.epoch).toBe(0)
      expect(mockDbState.mlsHubState).toHaveLength(1)
      expect(auditEntries).toHaveLength(1)
      expect(auditEntries[0].event).toBe('mls_group_init')
    })

    test('rejects if hub already bootstrapped (409)', async () => {
      mockDbState.mlsHubState.push({ hubId: HUB_ID })

      const res = await app.request(`/mls/hub/${HUB_ID}/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: DEVICE_ID, groupId: `llamenos:hub:${HUB_ID}` }),
      })

      expect(res.status).toBe(409)
    })
  })

  describe('POST /mls/hub/:hubId/key-packages', () => {
    test('uploads key packages and returns count', async () => {
      const keyPackages = [
        {
          keyPackageRef: Buffer.from('ref1').toString('base64'),
          keyPackageData: Buffer.from('data1').toString('base64'),
        },
        {
          keyPackageRef: Buffer.from('ref2').toString('base64'),
          keyPackageData: Buffer.from('data2').toString('base64'),
        },
      ]

      const res = await app.request(`/mls/hub/${HUB_ID}/key-packages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: DEVICE_ID, keyPackages }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.uploaded).toBe(2)
      expect(mockDbState.mlsKeyPackages).toHaveLength(2)
    })
  })

  describe('GET /mls/hub/:hubId/key-packages/:deviceId', () => {
    test('returns 404 if no unconsumed packages', async () => {
      const res = await app.request(`/mls/hub/${HUB_ID}/key-packages/${DEVICE_ID}`)
      expect(res.status).toBe(404)
    })

    test('consumes and returns one key package', async () => {
      mockDbState.mlsKeyPackages.push({
        id: 'kp-1',
        deviceId: DEVICE_ID,
        hubId: HUB_ID,
        keyPackageRef: Buffer.from('ref1'),
        keyPackageData: Buffer.from('data1'),
        consumedAt: null,
      })

      const res = await app.request(`/mls/hub/${HUB_ID}/key-packages/${DEVICE_ID}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe('kp-1')
    })
  })

  describe('POST /mls/hub/:hubId/commits', () => {
    test('accepts a valid commit', async () => {
      mockDbState.mlsHubState.push({ hubId: HUB_ID, currentEpoch: 0 })

      const res = await app.request(`/mls/hub/${HUB_ID}/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: DEVICE_ID,
          epoch: 1,
          commitData: Buffer.from('commit-bytes').toString('base64'),
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.epoch).toBe(1)
      expect(body.hubId).toBe(HUB_ID)
    })

    test('returns 409 on epoch collision (unique constraint violation)', async () => {
      mockDbState.mlsHubState.push({ hubId: HUB_ID, currentEpoch: 0 })
      shouldThrowUnique = true

      const res = await app.request(`/mls/hub/${HUB_ID}/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: DEVICE_ID,
          epoch: 1,
          commitData: Buffer.from('commit-bytes').toString('base64'),
        }),
      })

      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toContain('collision')
      expect(body.currentEpoch).toBeDefined()
    })
  })

  describe('GET /mls/hub/:hubId/commits', () => {
    test('returns empty array when caught up', async () => {
      const res = await app.request(`/mls/hub/${HUB_ID}/commits?sinceEpoch=5`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.commits).toEqual([])
    })

    test('returns commits since requested epoch', async () => {
      mockDbState.mlsEpochCommits.push({
        id: 'c1',
        epoch: 2,
        committerDeviceId: DEVICE_ID,
        commitData: Buffer.from('data'),
        welcomeData: null,
        createdAt: new Date(),
      })

      const res = await app.request(`/mls/hub/${HUB_ID}/commits?sinceEpoch=1`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.commits).toHaveLength(1)
      expect(body.commits[0].epoch).toBe(2)
    })
  })

  describe('GET /mls/hub/:hubId/epoch', () => {
    test('returns 404 if not bootstrapped', async () => {
      const res = await app.request(`/mls/hub/${HUB_ID}/epoch`)
      expect(res.status).toBe(404)
    })

    test('returns current epoch info', async () => {
      mockDbState.mlsHubState.push({
        hubId: HUB_ID,
        groupId: Buffer.from(`llamenos:hub:${HUB_ID}`, 'utf-8'),
        ciphersuite: 1,
        currentEpoch: 5,
        lastCommitAt: new Date(),
      })

      const res = await app.request(`/mls/hub/${HUB_ID}/epoch`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.hubId).toBe(HUB_ID)
      expect(body.currentEpoch).toBe(5)
      expect(body.ciphersuite).toBe(1)
    })
  })

  describe('POST /mls/hub/:hubId/commits/purge', () => {
    test('returns 404 if not bootstrapped', async () => {
      const res = await app.request(`/mls/hub/${HUB_ID}/commits/purge`, { method: 'POST' })
      expect(res.status).toBe(404)
    })

    test('purges old epochs and emits mls_epoch_purge audit event', async () => {
      mockDbState.mlsHubState.push({ hubId: HUB_ID, currentEpoch: 10 })
      for (let i = 0; i < 10; i++) {
        mockDbState.mlsEpochCommits.push({ id: `c${i}`, hubId: HUB_ID, epoch: i })
      }

      const res = await app.request(`/mls/hub/${HUB_ID}/commits/purge`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.purged).toBeGreaterThan(0)
      expect(auditEntries.some((e) => e.event === 'mls_epoch_purge')).toBe(true)
    })
  })
})
