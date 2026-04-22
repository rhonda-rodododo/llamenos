import { createRoute, z } from '@hono/zod-openapi'
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { createRouter } from '../../lib/openapi'
import { requirePermission } from '../../middleware/permission-guard'
import {
  baseMiddleware,
  ErrorSchema,
  getContactUpdateScope,
  IdParamSchema,
  OkSchema,
  PassthroughSchema,
  RelationshipIdParamSchema,
} from './shared'

const relationships = createRouter()

// ── GET /relationships ──

const listRelationshipsRoute = createRoute({
  method: 'get',
  path: '/relationships',
  tags: ['Contacts'],
  summary: 'List all relationships for hub',
  middleware: [...baseMiddleware, requirePermission('contacts:envelope-full')],
  responses: {
    200: {
      description: 'Relationships list',
      content: {
        'application/json': {
          schema: z.object({ relationships: z.array(PassthroughSchema) }),
        },
      },
    },
  },
})

relationships.openapi(listRelationshipsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const rels = await services.contacts.listRelationships(hubId)
  return c.json({ relationships: rels }, 200)
})

// ── POST /relationships ──

const CreateRelationshipBodySchema = z.object({
  encryptedPayload: z.string(),
  payloadEnvelopes: z.array(z.object({}).passthrough()),
})

const createRelationshipRoute = createRoute({
  method: 'post',
  path: '/relationships',
  tags: ['Contacts'],
  summary: 'Create a relationship',
  middleware: [...baseMiddleware, requirePermission('contacts:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateRelationshipBodySchema } } },
  },
  responses: {
    201: {
      description: 'Relationship created',
      content: {
        'application/json': { schema: z.object({ relationship: PassthroughSchema }) },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

relationships.openapi(createRelationshipRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  if (!body.encryptedPayload || !body.payloadEnvelopes) {
    return c.json({ error: 'encryptedPayload and payloadEnvelopes are required' }, 400)
  }

  const relationship = await services.contacts.createRelationship({
    hubId,
    encryptedPayload: body.encryptedPayload as Ciphertext,
    payloadEnvelopes: body.payloadEnvelopes as unknown as RecipientEnvelope[],
    createdBy: pubkey ?? '',
  })

  return c.json({ relationship }, 201)
})

// ── DELETE /relationships/{id} ──

const deleteRelationshipRoute = createRoute({
  method: 'delete',
  path: '/relationships/{id}',
  tags: ['Contacts'],
  summary: 'Delete a relationship',
  middleware: [...baseMiddleware, requirePermission('contacts:delete')],
  request: { params: RelationshipIdParamSchema },
  responses: {
    200: {
      description: 'Relationship deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
  },
})

relationships.openapi(deleteRelationshipRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  await services.contacts.deleteRelationship(id, hubId)
  return c.json({ ok: true }, 200)
})

// ── POST /{id}/link ──

const LinkBodySchema = z.object({
  type: z.enum(['call', 'conversation']),
  targetId: z.string(),
})

const linkRoute = createRoute({
  method: 'post',
  path: '/{id}/link',
  tags: ['Contacts'],
  summary: 'Link a call or conversation to a contact',
  middleware: [...baseMiddleware, requirePermission('contacts:link')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: LinkBodySchema } } },
  },
  responses: {
    200: {
      description: 'Link created',
      content: { 'application/json': { schema: z.object({ link: PassthroughSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

relationships.openapi(linkRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) return c.json({ error: 'Forbidden' }, 403)
  if (updateScope !== 'all') {
    const accessible = await services.contacts.isContactAccessible(
      id,
      hubId,
      updateScope,
      pubkey ?? ''
    )
    if (!accessible) return c.json({ error: 'Contact not found' }, 404)
  }

  if (body.type === 'call') {
    const link = await services.contacts.linkCall(id, body.targetId, hubId, pubkey ?? '')
    return c.json({ link }, 200)
  }

  const link = await services.contacts.linkConversation(id, body.targetId, hubId, pubkey ?? '')
  return c.json({ link }, 200)
})

// ── DELETE /{id}/link ──

const unlinkRoute = createRoute({
  method: 'delete',
  path: '/{id}/link',
  tags: ['Contacts'],
  summary: 'Unlink a call or conversation from a contact',
  middleware: [...baseMiddleware, requirePermission('contacts:link')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: LinkBodySchema } } },
  },
  responses: {
    200: {
      description: 'Link removed',
      content: { 'application/json': { schema: OkSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

relationships.openapi(unlinkRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) return c.json({ error: 'Forbidden' }, 403)
  if (updateScope !== 'all') {
    const accessible = await services.contacts.isContactAccessible(
      id,
      hubId,
      updateScope,
      pubkey ?? ''
    )
    if (!accessible) return c.json({ error: 'Contact not found' }, 404)
  }

  if (body.type === 'call') {
    await services.contacts.unlinkCall(id, body.targetId)
  } else {
    await services.contacts.unlinkConversation(id, body.targetId)
  }

  return c.json({ ok: true }, 200)
})

export default relationships
