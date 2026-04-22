import { createRoute, z } from '@hono/zod-openapi'
import { CONSENT_VERSION } from '../../shared/types'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

const gdpr = createRouter()

// ── GET /consent — check consent status for authenticated user ──

const getConsentRoute = createRoute({
  method: 'get',
  path: '/consent',
  tags: ['GDPR'],
  summary: 'Get consent status',
  responses: {
    200: {
      description: 'Consent status',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

gdpr.openapi(getConsentRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const status = await services.gdpr.getConsentStatus(pubkey)
  return c.json(status, 200)
})

// ── POST /consent — record consent ──

const postConsentRoute = createRoute({
  method: 'post',
  path: '/consent',
  tags: ['GDPR'],
  summary: 'Record consent',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ version: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Consent recorded',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid version',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

gdpr.openapi(postConsentRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  if (!body.version) {
    return c.json({ error: 'version is required' }, 400)
  }
  if (body.version !== CONSENT_VERSION) {
    return c.json({ error: `Invalid consent version. Expected ${CONSENT_VERSION}` }, 400)
  }
  await services.gdpr.recordConsent(pubkey, body.version)
  return c.json({ ok: true }, 200)
})

// ── GET /export — GDPR data export for authenticated user ──
// Returns file attachment — kept as standard Hono route

gdpr.get('/export', requirePermission('gdpr:export'), async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const data = await services.gdpr.exportForUser(pubkey)
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="llamenos-export-${date}.json"`,
    },
  })
})

// ── GET /export/:targetPubkey — admin export of any user's data ──
// Returns file attachment — kept as standard Hono route

gdpr.get('/export/:targetPubkey', requirePermission('gdpr:admin'), async (c) => {
  const services = c.get('services')
  const adminPubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const targetPubkey = c.req.param('targetPubkey')
  const data = await services.gdpr.exportForUser(targetPubkey)
  await services.records.addAuditEntry(hubId ?? 'global', 'gdprExportRequested', adminPubkey, {
    targetPubkey,
  })
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="llamenos-export-${targetPubkey.slice(0, 8)}-${date}.json"`,
    },
  })
})

// ── GET /me/erasure — check self erasure request ──

const getErasureRoute = createRoute({
  method: 'get',
  path: '/me/erasure',
  tags: ['GDPR'],
  summary: 'Check self erasure request status',
  responses: {
    200: {
      description: 'Erasure request status',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

gdpr.openapi(getErasureRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const request = await services.gdpr.getErasureRequest(pubkey)
  if (!request) return c.json({ request: null }, 200)
  return c.json({ request }, 200)
})

// ── DELETE /me — create self-erasure request (72h delay) ──

const createErasureRoute = createRoute({
  method: 'delete',
  path: '/me',
  tags: ['GDPR'],
  summary: 'Request self-erasure (72h delay)',
  middleware: [requirePermission('gdpr:erase-self')],
  responses: {
    202: {
      description: 'Erasure request created',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

gdpr.openapi(createErasureRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const request = await services.gdpr.createErasureRequest(pubkey)
  await services.records.addAuditEntry(hubId ?? 'global', 'gdprErasureRequested', pubkey, {
    executeAt: request.executeAt,
  })
  return c.json({ request }, 202)
})

// ── DELETE /me/cancel — cancel pending self-erasure ──

const cancelErasureRoute = createRoute({
  method: 'delete',
  path: '/me/cancel',
  tags: ['GDPR'],
  summary: 'Cancel pending self-erasure',
  responses: {
    200: {
      description: 'Erasure cancelled',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

gdpr.openapi(cancelErasureRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  await services.gdpr.cancelErasureRequest(pubkey)
  return c.json({ ok: true }, 200)
})

// ── GET /erasure-requests — admin: list all erasure requests ──

const listErasureRequestsRoute = createRoute({
  method: 'get',
  path: '/erasure-requests',
  tags: ['GDPR'],
  summary: 'List all erasure requests (admin)',
  middleware: [requirePermission('gdpr:admin')],
  request: {
    query: z.object({
      status: z.enum(['pending', 'cancelled', 'executed']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of erasure requests',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

gdpr.openapi(listErasureRequestsRoute, async (c) => {
  const services = c.get('services')
  const { status } = c.req.valid('query')
  const requests = await services.gdpr.listErasureRequests(status)
  return c.json({ requests }, 200)
})

// ── DELETE /{targetPubkey} — admin-initiated immediate erasure ──

const adminEraseRoute = createRoute({
  method: 'delete',
  path: '/{targetPubkey}',
  tags: ['GDPR'],
  summary: 'Admin-initiated immediate erasure',
  middleware: [requirePermission('gdpr:admin')],
  request: {
    params: z.object({
      targetPubkey: z.string().openapi({ param: { name: 'targetPubkey', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      description: 'User erased',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

gdpr.openapi(adminEraseRoute, async (c) => {
  const services = c.get('services')
  const adminPubkey = c.get('pubkey')
  const hubId = c.get('hubId')
  const { targetPubkey } = c.req.valid('param')
  await services.gdpr.eraseUser(targetPubkey)
  await services.records.addAuditEntry(hubId ?? 'global', 'gdprErasureExecuted', adminPubkey, {
    targetPubkey,
    initiator: adminPubkey,
  })
  return c.json({ ok: true }, 200)
})

export default gdpr
