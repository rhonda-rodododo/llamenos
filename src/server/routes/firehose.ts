import { createRoute, z } from '@hono/zod-openapi'
import { LABEL_FIREHOSE_AGENT_SEAL } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import {
  CreateFirehoseConnectionSchema,
  FirehoseConnectionHealthSchema,
  FirehoseConnectionSchema,
  FirehoseConnectionStatusSchema,
  UpdateFirehoseConnectionSchema,
} from '@shared/schemas/firehose'
import type { z as Zod } from 'zod/v4'
import type { firehoseConnections } from '../db/schema/firehose'
import { generateAgentKeypair } from '../lib/agent-identity'
import { createLogger } from '../lib/logger'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

type FirehoseConnectionRow = typeof firehoseConnections.$inferSelect

const log = createLogger('routes.firehose')

const firehoseRoutes = createRouter()

// ── Shared schemas ──

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'conn-abc123' }),
})

// Map a DB row to the API response shape.
// Strips encryptedAgentNsec — that field is never exposed via the API.
function mapConnection(row: FirehoseConnectionRow): Zod.infer<typeof FirehoseConnectionSchema> {
  return {
    id: row.id,
    hubId: row.hubId,
    signalGroupId: row.signalGroupId,
    displayName: row.displayName,
    encryptedDisplayName: row.encryptedDisplayName ?? undefined,
    reportTypeId: row.reportTypeId,
    agentPubkey: row.agentPubkey,
    geoContext: row.geoContext,
    geoContextCountryCodes: row.geoContextCountryCodes,
    inferenceEndpoint: row.inferenceEndpoint,
    extractionIntervalSec: row.extractionIntervalSec,
    systemPromptSuffix: row.systemPromptSuffix,
    bufferTtlDays: row.bufferTtlDays,
    notifyViaSignal: row.notifyViaSignal,
    status: FirehoseConnectionStatusSchema.parse(row.status),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }
}

// ── GET / — list connections for hub ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Firehose'],
  summary: 'List firehose connections',
  description: 'Returns all firehose connections for the current hub.',
  middleware: [requirePermission('firehose:read')],
  responses: {
    200: {
      description: 'Firehose connections list',
      content: {
        'application/json': {
          schema: z.object({ connections: z.array(FirehoseConnectionSchema) }),
        },
      },
    },
  },
})

firehoseRoutes.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const rows = await services.firehose.listConnections(hubId)
  const connections = rows.map(mapConnection)
  return c.json({ connections }, 200)
})

// ── POST / — create connection ──

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Firehose'],
  summary: 'Create a firehose connection',
  middleware: [requirePermission('firehose:manage')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateFirehoseConnectionSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Firehose connection created',
      content: {
        'application/json': {
          schema: z.object({ connection: FirehoseConnectionSchema }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Report type not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    503: {
      description: 'Firehose seal key not configured',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

firehoseRoutes.openapi(createRoute_, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  // Validate report type exists
  const reportType = await services.reportTypes.getReportType(hubId, body.reportTypeId)
  if (!reportType) {
    return c.json({ error: 'Report type not found' }, 404)
  }

  // Seal key must be configured
  const sealKey = c.env.FIREHOSE_AGENT_SEAL_KEY ?? process.env.FIREHOSE_AGENT_SEAL_KEY
  if (!sealKey) {
    return c.json({ error: 'Firehose agent seal key not configured' }, 503)
  }

  // Create the connection first with a placeholder so we get its auto-generated ID,
  // then generate the agent keypair bound to that real ID (HKDF uses connection ID as salt),
  // then update with the sealed result.
  const placeholder = 'pending'
  const raw = await services.firehose.createConnection(hubId, {
    id: body.id,
    displayName: body.displayName?.trim() ?? '',
    encryptedDisplayName: body.encryptedDisplayName?.trim() as Ciphertext | undefined,
    reportTypeId: body.reportTypeId,
    agentPubkey: placeholder,
    encryptedAgentNsec: placeholder,
    geoContext: body.geoContext ?? null,
    geoContextCountryCodes: body.geoContextCountryCodes ?? null,
    inferenceEndpoint: body.inferenceEndpoint ?? null,
    extractionIntervalSec: body.extractionIntervalSec,
    systemPromptSuffix: body.systemPromptSuffix ?? null,
    bufferTtlDays: body.bufferTtlDays,
    notifyViaSignal: body.notifyViaSignal,
    status: 'pending',
  })

  // Generate keypair bound to the real connection ID
  const { pubkey: agentPubkey, encryptedNsec } = generateAgentKeypair(
    raw.id,
    sealKey,
    LABEL_FIREHOSE_AGENT_SEAL
  )

  const updated = await services.firehose.setAgentKeypair(raw.id, agentPubkey, encryptedNsec)

  await services.records.addAuditEntry(hubId, 'firehoseConnectionCreated', pubkey, {
    connectionId: raw.id,
  })

  const connection = mapConnection(updated ?? raw)
  return c.json({ connection }, 201)
})

// ── GET /status — health status for all connections (BEFORE /:id to avoid path conflict) ──

const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Firehose'],
  summary: 'Get firehose connection health status',
  description: 'Returns health and buffer metrics for all connections in the hub.',
  middleware: [requirePermission('firehose:read')],
  responses: {
    200: {
      description: 'Health status for all connections',
      content: {
        'application/json': {
          schema: z.object({ statuses: z.array(FirehoseConnectionHealthSchema) }),
        },
      },
    },
  },
})

firehoseRoutes.openapi(statusRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'

  const connections = await services.firehose.listConnections(hubId)
  const statuses: Zod.infer<typeof FirehoseConnectionHealthSchema>[] = await Promise.all(
    connections.map(async (conn) => {
      const bufferSize = await services.firehose.getBufferSize(conn.id)
      return {
        id: conn.id,
        status: FirehoseConnectionStatusSchema.parse(conn.status),
        lastMessageReceived: null,
        lastReportSubmitted: null,
        bufferSize,
        extractionCount: 0,
        inferenceHealthMs: null,
      }
    })
  )

  return c.json({ statuses }, 200)
})

// ── GET /:id — get connection by ID ──

const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Firehose'],
  summary: 'Get firehose connection',
  middleware: [requirePermission('firehose:read')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Firehose connection',
      content: {
        'application/json': {
          schema: z.object({ connection: FirehoseConnectionSchema }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

firehoseRoutes.openapi(getRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')

  const row = await services.firehose.getConnection(id)
  if (!row) {
    return c.json({ error: 'Firehose connection not found' }, 404)
  }
  return c.json({ connection: mapConnection(row) }, 200)
})

// ── PATCH /:id — update connection ──

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Firehose'],
  summary: 'Update firehose connection',
  middleware: [requirePermission('firehose:manage')],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateFirehoseConnectionSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated connection',
      content: {
        'application/json': {
          schema: z.object({ connection: FirehoseConnectionSchema }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

firehoseRoutes.openapi(updateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')

  const existing = await services.firehose.getConnection(id)
  if (!existing) {
    return c.json({ error: 'Firehose connection not found' }, 404)
  }

  const row = await services.firehose.updateConnection(id, {
    ...(body.displayName !== undefined && body.encryptedDisplayName === undefined
      ? { displayName: body.displayName.trim() }
      : {}),
    ...(body.encryptedDisplayName !== undefined
      ? { encryptedDisplayName: body.encryptedDisplayName.trim() as Ciphertext }
      : {}),
    ...(body.reportTypeId !== undefined ? { reportTypeId: body.reportTypeId } : {}),
    ...(body.geoContext !== undefined ? { geoContext: body.geoContext } : {}),
    ...(body.geoContextCountryCodes !== undefined
      ? { geoContextCountryCodes: body.geoContextCountryCodes }
      : {}),
    ...(body.inferenceEndpoint !== undefined ? { inferenceEndpoint: body.inferenceEndpoint } : {}),
    ...(body.extractionIntervalSec !== undefined
      ? { extractionIntervalSec: body.extractionIntervalSec }
      : {}),
    ...(body.systemPromptSuffix !== undefined
      ? { systemPromptSuffix: body.systemPromptSuffix }
      : {}),
    ...(body.bufferTtlDays !== undefined ? { bufferTtlDays: body.bufferTtlDays } : {}),
    ...(body.notifyViaSignal !== undefined ? { notifyViaSignal: body.notifyViaSignal } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
  })

  if (!row) {
    return c.json({ error: 'Firehose connection not found' }, 404)
  }

  // Stop/start agent based on status change
  if (body.status === 'paused' || body.status === 'disabled') {
    services.firehoseAgent?.stopAgent(id)
  } else if (body.status === 'active' && existing.status !== 'active') {
    // Start agent if transitioning to active
    services.firehoseAgent
      ?.startAgent(id)
      .catch((err) => log.error('Failed to start agent', err, { connectionId: id }))
  }

  await services.records.addAuditEntry(hubId, 'firehoseConnectionUpdated', pubkey, {
    connectionId: id,
  })

  return c.json({ connection: mapConnection(row) }, 200)
})

// ── DELETE /:id — delete connection ──

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Firehose'],
  summary: 'Delete firehose connection',
  middleware: [requirePermission('firehose:manage')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Connection deleted',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

firehoseRoutes.openapi(deleteRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')

  const existing = await services.firehose.getConnection(id)
  if (!existing) {
    return c.json({ error: 'Firehose connection not found' }, 404)
  }

  // Stop running agent if any
  services.firehoseAgent?.stopAgent(id)

  await services.firehose.deleteConnection(id)
  await services.records.addAuditEntry(hubId, 'firehoseConnectionDeleted', pubkey, {
    connectionId: id,
  })

  return c.json({ ok: true }, 200)
})

export default firehoseRoutes
