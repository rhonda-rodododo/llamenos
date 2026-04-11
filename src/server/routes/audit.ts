import { createRoute, z } from '@hono/zod-openapi'
import { SignedAuditEntrySchema } from '@shared/schemas/audit-entries'
import { createLogger } from '../lib/logger'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'
import { AuditChainError } from '../services/audit-log-service'

const log = createLogger('api:audit')
const auditRoutes = createRouter()

// ── GET / — list legacy (activity) audit log entries ──

const listAuditRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Audit'],
  summary: 'List audit log entries',
  middleware: [requirePermission('audit:read')],
  responses: {
    200: {
      description: 'Paginated audit log entries',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

auditRoutes.openapi(listAuditRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const result = await services.records.getAuditLog({
    page: Number.parseInt(c.req.query('page') || '1', 10),
    limit: Number.parseInt(c.req.query('limit') || '50', 10),
    ...(c.req.query('actorPubkey') ? { actorPubkey: c.req.query('actorPubkey')! } : {}),
    ...(c.req.query('eventType') ? { eventType: c.req.query('eventType')! } : {}),
    ...(c.req.query('dateFrom') ? { dateFrom: c.req.query('dateFrom')! } : {}),
    ...(c.req.query('dateTo') ? { dateTo: c.req.query('dateTo')! } : {}),
    ...(c.req.query('search') ? { search: c.req.query('search')! } : {}),
    hubId: hubId ?? 'global',
  })
  return c.json(result, 200)
})

// ── POST / — append signed audit entry (Tier 0 signed chain) ──
//
// Uses plain Hono post() (not .openapi) because the SignedAuditEntry
// discriminated-union schema is too deeply nested for zod-openapi's
// response-type inference without blowing past TS's instantiation budget.
// The request body is parsed inside the handler via SignedAuditEntrySchema.

auditRoutes.post('/', async (c) => {
  const services = c.get('services')
  const body = await c.req.json().catch(() => null)
  const parsed = SignedAuditEntrySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid signed audit entry',
        code: 'validation_failed' as const,
        details: { issues: parsed.error.issues },
      },
      400
    )
  }
  try {
    await services.auditLog.appendSigned(parsed.data)
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof AuditChainError) {
      log.warn('signed audit append rejected', { code: err.code, details: err.details })
      return c.json({ error: err.message, code: err.code, details: err.details ?? {} }, 400)
    }
    throw err
  }
})

// ── GET /signed — list signed audit entries (for client chain verifier) ──

auditRoutes.get('/signed', requirePermission('audit:read'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  if (!hubId) {
    return c.json({ entries: [] }, 200)
  }
  const sinceEntryHash = c.req.query('sinceEntryHash')
  const isValidHash = typeof sinceEntryHash === 'string' && /^[0-9a-f]{64}$/.test(sinceEntryHash)
  const entries = await services.auditLog.list(hubId, isValidHash ? { sinceEntryHash } : {})
  return c.json({ entries }, 200)
})

export default auditRoutes
