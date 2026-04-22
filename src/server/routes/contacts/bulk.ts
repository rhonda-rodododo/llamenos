import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../../lib/openapi'
import { requirePermission } from '../../middleware/permission-guard'
import { baseMiddleware, ErrorSchema, getContactUpdateScope } from './shared'

const bulk = createRouter()

// ── PATCH /bulk ──

const BulkUpdateBodySchema = z.object({
  contactIds: z.array(z.string()).min(1),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  riskLevel: z.string().optional(),
})

const bulkUpdateRoute = createRoute({
  method: 'patch',
  path: '/bulk',
  tags: ['Contacts'],
  summary: 'Bulk update contacts (tags/risk level)',
  middleware: [...baseMiddleware, requirePermission('contacts:update-own')],
  request: {
    body: { content: { 'application/json': { schema: BulkUpdateBodySchema } } },
  },
  responses: {
    200: {
      description: 'Bulk update result',
      content: {
        'application/json': {
          schema: z.object({ updated: z.number(), skipped: z.number() }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

bulk.openapi(bulkUpdateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const scope = getContactUpdateScope(permissions)
  if (!scope) return c.json({ error: 'Forbidden' }, 403)

  let accessibleIds = body.contactIds
  if (scope !== 'all') {
    const accessible = await Promise.all(
      body.contactIds.map(async (id) => {
        const ok = await services.contacts.isContactAccessible(id, hubId, scope, pubkey ?? '')
        return ok ? id : null
      })
    )
    accessibleIds = accessible.filter((id): id is string => id !== null)
  }

  let updated = 0
  for (const contactId of accessibleIds) {
    const updateData: Record<string, unknown> = {}
    if (body.riskLevel) updateData.riskLevel = body.riskLevel

    if (body.addTags || body.removeTags) {
      const contact = await services.contacts.getContact(contactId, hubId)
      if (contact) {
        let currentTags = (contact.tags as string[]) ?? []
        if (body.addTags) currentTags = [...new Set([...currentTags, ...body.addTags])]
        if (body.removeTags) currentTags = currentTags.filter((t) => !body.removeTags?.includes(t))
        updateData.tags = currentTags
      }
    }

    if (Object.keys(updateData).length > 0) {
      await services.contacts.updateContact(contactId, hubId, updateData)
      updated++
    }
  }

  return c.json(
    {
      updated,
      skipped: body.contactIds.length - accessibleIds.length,
    },
    200
  )
})

// ── DELETE /bulk ──

const BulkDeleteBodySchema = z.object({
  contactIds: z.array(z.string()).min(1),
})

const bulkDeleteRoute = createRoute({
  method: 'delete',
  path: '/bulk',
  tags: ['Contacts'],
  summary: 'Bulk delete contacts',
  middleware: [...baseMiddleware, requirePermission('contacts:delete')],
  request: {
    body: { content: { 'application/json': { schema: BulkDeleteBodySchema } } },
  },
  responses: {
    200: {
      description: 'Bulk delete result',
      content: {
        'application/json': {
          schema: z.object({ deleted: z.number(), skipped: z.number() }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

bulk.openapi(bulkDeleteRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const scope = getContactUpdateScope(permissions)
  if (!scope) return c.json({ error: 'Forbidden' }, 403)

  let deleted = 0
  for (const contactId of body.contactIds) {
    if (scope !== 'all') {
      const ok = await services.contacts.isContactAccessible(contactId, hubId, scope, pubkey ?? '')
      if (!ok) continue
    }
    const result = await services.contacts.deleteContact(contactId, hubId)
    if (result) deleted++
  }

  return c.json(
    {
      deleted,
      skipped: body.contactIds.length - deleted,
    },
    200
  )
})

export default bulk
