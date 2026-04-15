import { createRoute, z } from '@hono/zod-openapi'
import {
  MlsBootstrapRequestSchema,
  MlsBootstrapResponseSchema,
  MlsCommitRequestSchema,
  MlsCommitResponseSchema,
  MlsCurrentEpochResponseSchema,
  MlsDeviceIdParamSchema,
  MlsFetchCommitsResponseSchema,
  MlsFetchKeyPackageResponseSchema,
  MlsHubIdParamSchema,
  MlsKeyPackageCountsResponseSchema,
  MlsPurgeEpochResponseSchema,
  MlsUploadKeyPackagesRequestSchema,
  MlsUploadKeyPackagesResponseSchema,
} from '@shared/schemas/mls'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { mlsEpochCommits, mlsHubState, mlsKeyPackages } from '../db/schema/mls'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

const MLS_EPOCH_RETENTION = 5

const mlsRoutes = createRouter()

// ── POST /hub/:hubId/bootstrap — initialize MLS group for a hub ──

const bootstrapRoute = createRoute({
  method: 'post',
  path: '/hub/{hubId}/bootstrap',
  tags: ['MLS'],
  summary: 'Bootstrap MLS group for a hub',
  description:
    'Creates the mls_hub_state row for a new hub. Admin-only, called once on hub creation.',
  middleware: [requirePermission('settings:manage')],
  request: {
    params: MlsHubIdParamSchema,
    body: { content: { 'application/json': { schema: MlsBootstrapRequestSchema } } },
  },
  responses: {
    201: {
      description: 'MLS group bootstrapped',
      content: { 'application/json': { schema: MlsBootstrapResponseSchema } },
    },
    409: {
      description: 'MLS group already exists for this hub',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

mlsRoutes.openapi(bootstrapRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = getDb()

  const groupIdBytes = Buffer.from(`llamenos:hub:${hubId}`, 'utf-8')

  const existing = await db
    .select({ hubId: mlsHubState.hubId })
    .from(mlsHubState)
    .where(eq(mlsHubState.hubId, hubId))
    .limit(1)

  if (existing.length > 0) {
    return c.json({ error: 'MLS group already bootstrapped for this hub' }, 409)
  }

  const now = new Date().toISOString()
  await db.insert(mlsHubState).values({
    hubId,
    groupId: groupIdBytes,
    ciphersuite: 1,
    currentEpoch: 0,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  })

  const services = c.get('services')
  const pubkey = c.get('pubkey')
  await services.records.addAuditEntry(hubId, 'mls_group_init', pubkey, {
    hubId,
    groupId: body.groupId,
    ciphersuite: 1,
    creatorDeviceId: body.deviceId,
    epoch: 0,
  })

  return c.json(
    {
      hubId,
      groupId: body.groupId,
      ciphersuite: 1,
      epoch: 0,
      createdAt: now,
    },
    201
  )
})

// ── POST /hub/:hubId/key-packages — upload key packages for a device ──

const uploadKeyPackagesRoute = createRoute({
  method: 'post',
  path: '/hub/{hubId}/key-packages',
  tags: ['MLS'],
  summary: 'Upload MLS key packages',
  description: 'A device uploads N fresh KeyPackages for this hub.',
  request: {
    params: MlsHubIdParamSchema,
    body: { content: { 'application/json': { schema: MlsUploadKeyPackagesRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Key packages uploaded',
      content: { 'application/json': { schema: MlsUploadKeyPackagesResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

mlsRoutes.openapi(uploadKeyPackagesRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = getDb()

  const rows = body.keyPackages.map((kp) => ({
    id: crypto.randomUUID(),
    deviceId: body.deviceId,
    hubId,
    keyPackageRef: Buffer.from(kp.keyPackageRef, 'base64'),
    keyPackageData: Buffer.from(kp.keyPackageData, 'base64'),
  }))

  await db.insert(mlsKeyPackages).values(rows).onConflictDoNothing()

  return c.json({ uploaded: rows.length }, 200)
})

// ── GET /hub/:hubId/key-packages/counts — key package counts per device ──
// Registered before the :deviceId route so "counts" isn't captured as a deviceId param.

const keyPackageCountsRoute = createRoute({
  method: 'get',
  path: '/hub/{hubId}/key-packages/counts',
  tags: ['MLS'],
  summary: 'Key package counts per device',
  description: 'Returns the number of unconsumed key packages per device so clients can refill.',
  request: { params: MlsHubIdParamSchema },
  responses: {
    200: {
      description: 'Key package counts',
      content: { 'application/json': { schema: MlsKeyPackageCountsResponseSchema } },
    },
  },
})

mlsRoutes.openapi(keyPackageCountsRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const db = getDb()

  const rows = await db
    .select({
      deviceId: mlsKeyPackages.deviceId,
      available: sql<number>`count(*)::int`,
    })
    .from(mlsKeyPackages)
    .where(and(eq(mlsKeyPackages.hubId, hubId), isNull(mlsKeyPackages.consumedAt)))
    .groupBy(mlsKeyPackages.deviceId)

  return c.json({ counts: rows }, 200)
})

// ── GET /hub/:hubId/key-packages/:deviceId — fetch one unconsumed key package ──

const fetchKeyPackageRoute = createRoute({
  method: 'get',
  path: '/hub/{hubId}/key-packages/{deviceId}',
  tags: ['MLS'],
  summary: 'Fetch one unconsumed key package for a device',
  description: 'Atomically marks one unconsumed KeyPackage as consumed and returns it.',
  request: { params: MlsDeviceIdParamSchema },
  responses: {
    200: {
      description: 'Key package fetched',
      content: { 'application/json': { schema: MlsFetchKeyPackageResponseSchema } },
    },
    404: {
      description: 'No unconsumed key packages available',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

mlsRoutes.openapi(fetchKeyPackageRoute, async (c) => {
  const { hubId, deviceId } = c.req.valid('param')
  const db = getDb()

  const consumed = await db
    .update(mlsKeyPackages)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(mlsKeyPackages.hubId, hubId),
        eq(mlsKeyPackages.deviceId, deviceId),
        isNull(mlsKeyPackages.consumedAt),
        eq(
          mlsKeyPackages.id,
          sql`(
          SELECT ${mlsKeyPackages.id} FROM ${mlsKeyPackages}
          WHERE ${mlsKeyPackages.hubId} = ${hubId}
            AND ${mlsKeyPackages.deviceId} = ${deviceId}
            AND ${mlsKeyPackages.consumedAt} IS NULL
          ORDER BY ${mlsKeyPackages.createdAt} ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )`
        )
      )
    )
    .returning()

  if (consumed.length === 0) {
    return c.json({ error: 'No unconsumed key packages available for this device' }, 404)
  }

  const pkg = consumed[0]

  const remaining = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mlsKeyPackages)
    .where(
      and(
        eq(mlsKeyPackages.hubId, hubId),
        eq(mlsKeyPackages.deviceId, deviceId),
        isNull(mlsKeyPackages.consumedAt)
      )
    )

  return c.json(
    {
      id: pkg.id,
      keyPackageRef: pkg.keyPackageRef.toString('base64'),
      keyPackageData: pkg.keyPackageData.toString('base64'),
      keyPackagesRemaining: remaining[0]?.count ?? 0,
    },
    200
  )
})

// ── POST /hub/:hubId/commits — submit an MLS commit ──

const commitRoute = createRoute({
  method: 'post',
  path: '/hub/{hubId}/commits',
  tags: ['MLS'],
  summary: 'Submit an MLS commit',
  description:
    'Submit a new Commit for the hub. Optimistic locking via UNIQUE(hub_id, epoch) — returns 409 on collision.',
  request: {
    params: MlsHubIdParamSchema,
    body: { content: { 'application/json': { schema: MlsCommitRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Commit accepted',
      content: { 'application/json': { schema: MlsCommitResponseSchema } },
    },
    409: {
      description: 'Epoch collision — another commit landed first',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), currentEpoch: z.number().int() }),
        },
      },
    },
  },
})

mlsRoutes.openapi(commitRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const body = c.req.valid('json')
  const db = getDb()

  const commitId = crypto.randomUUID()

  try {
    await db.insert(mlsEpochCommits).values({
      id: commitId,
      hubId,
      epoch: body.epoch,
      committerDeviceId: body.deviceId,
      commitData: Buffer.from(body.commitData, 'base64'),
      welcomeData: body.welcomeData ? Buffer.from(body.welcomeData, 'base64') : null,
    })

    await db
      .update(mlsHubState)
      .set({
        currentEpoch: body.epoch,
        lastCommitAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mlsHubState.hubId, hubId))

    return c.json(
      {
        id: commitId,
        epoch: body.epoch,
        hubId,
        createdAt: new Date().toISOString(),
      },
      200
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('unique') ||
      msg.includes('duplicate') ||
      msg.includes('UNIQUE') ||
      msg.includes('23505')
    ) {
      const state = await db
        .select({ currentEpoch: mlsHubState.currentEpoch })
        .from(mlsHubState)
        .where(eq(mlsHubState.hubId, hubId))
        .limit(1)

      return c.json(
        {
          error: 'Epoch collision — another commit landed first',
          currentEpoch: state[0]?.currentEpoch ?? 0,
        },
        409
      )
    }
    throw err
  }
})

// ── GET /hub/:hubId/commits?sinceEpoch=N — fetch commits since epoch ──

const fetchCommitsRoute = createRoute({
  method: 'get',
  path: '/hub/{hubId}/commits',
  tags: ['MLS'],
  summary: 'Fetch MLS commits since a given epoch',
  description: 'Returns all commits after sinceEpoch for client catch-up.',
  request: {
    params: MlsHubIdParamSchema,
    query: z.object({ sinceEpoch: z.string().optional() }),
  },
  responses: {
    200: {
      description: 'Commits list',
      content: { 'application/json': { schema: MlsFetchCommitsResponseSchema } },
    },
  },
})

mlsRoutes.openapi(fetchCommitsRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const { sinceEpoch } = c.req.valid('query')
  const db = getDb()

  const sinceEpochNum = sinceEpoch ? Number.parseInt(sinceEpoch, 10) : 0

  const rows = await db
    .select()
    .from(mlsEpochCommits)
    .where(and(eq(mlsEpochCommits.hubId, hubId), gt(mlsEpochCommits.epoch, sinceEpochNum)))
    .orderBy(mlsEpochCommits.epoch)

  return c.json(
    {
      commits: rows.map((r) => ({
        id: r.id,
        epoch: r.epoch,
        committerDeviceId: r.committerDeviceId,
        commitData: r.commitData.toString('base64'),
        welcomeData: r.welcomeData?.toString('base64') ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    200
  )
})

// ── GET /hub/:hubId/epoch — current epoch info ──

const currentEpochRoute = createRoute({
  method: 'get',
  path: '/hub/{hubId}/epoch',
  tags: ['MLS'],
  summary: 'Get current MLS epoch for a hub',
  request: { params: MlsHubIdParamSchema },
  responses: {
    200: {
      description: 'Current epoch info',
      content: { 'application/json': { schema: MlsCurrentEpochResponseSchema } },
    },
    404: {
      description: 'MLS group not bootstrapped',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

mlsRoutes.openapi(currentEpochRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const db = getDb()

  const rows = await db.select().from(mlsHubState).where(eq(mlsHubState.hubId, hubId)).limit(1)
  if (rows.length === 0) {
    return c.json({ error: 'MLS group not bootstrapped for this hub' }, 404)
  }

  const state = rows[0]
  return c.json(
    {
      hubId: state.hubId,
      groupId: state.groupId.toString('utf-8'),
      ciphersuite: state.ciphersuite,
      currentEpoch: state.currentEpoch,
      lastCommitAt: state.lastCommitAt?.toISOString() ?? null,
    },
    200
  )
})

// ── POST /hub/:hubId/commits/purge — purge old epochs (admin-only) ──

const purgeRoute = createRoute({
  method: 'post',
  path: '/hub/{hubId}/commits/purge',
  tags: ['MLS'],
  summary: 'Purge old MLS epoch commits',
  description: 'Admin-only. Deletes all but the 5 most recent epoch commits. Idempotent.',
  middleware: [requirePermission('settings:manage')],
  request: { params: MlsHubIdParamSchema },
  responses: {
    200: {
      description: 'Purge result',
      content: { 'application/json': { schema: MlsPurgeEpochResponseSchema } },
    },
    404: {
      description: 'MLS group not bootstrapped',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

mlsRoutes.openapi(purgeRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const db = getDb()

  const stateRows = await db.select().from(mlsHubState).where(eq(mlsHubState.hubId, hubId)).limit(1)
  if (stateRows.length === 0) {
    return c.json({ error: 'MLS group not bootstrapped for this hub' }, 404)
  }

  const currentEpoch = stateRows[0].currentEpoch
  const cutoffEpoch = currentEpoch - MLS_EPOCH_RETENTION

  let purged = 0
  if (cutoffEpoch > 0) {
    const deleted = await db
      .delete(mlsEpochCommits)
      .where(and(eq(mlsEpochCommits.hubId, hubId), sql`${mlsEpochCommits.epoch} < ${cutoffEpoch}`))
      .returning({ id: mlsEpochCommits.id })

    purged = deleted.length
  }

  const remainingRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mlsEpochCommits)
    .where(eq(mlsEpochCommits.hubId, hubId))

  const remaining = remainingRows[0]?.count ?? 0

  if (purged > 0) {
    const services = c.get('services')
    const pubkey = c.get('pubkey')
    const purgedRange = cutoffEpoch > 1 ? `0-${cutoffEpoch - 1}` : '0'
    await services.records.addAuditEntry(hubId, 'mls_epoch_purge', pubkey, {
      hubId,
      purgedEpochRange: purgedRange,
      reason: 'retention_policy',
    })
  }

  return c.json({ purged, remaining }, 200)
})

export default mlsRoutes
