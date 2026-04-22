import { createRoute, z } from '@hono/zod-openapi'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { createRouter } from '../../lib/openapi'
import { checkPermission, requirePermission } from '../../middleware/permission-guard'
import {
  ErrorSchema,
  IdParamSchema,
  OkSchema,
  PassthroughSchema,
  baseMiddleware,
  getContactReadScope,
  getContactUpdateScope,
} from './shared'

const core = createRouter()

// ── GET / — list contacts ──

const listContactsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Contacts'],
  summary: 'List contacts (filterable)',
  middleware: baseMiddleware,
  responses: {
    200: {
      description: 'Contacts list',
      content: {
        'application/json': { schema: z.object({ contacts: z.array(PassthroughSchema) }) },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
  },
})

core.openapi(listContactsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const readScope = getContactReadScope(permissions)
  if (!readScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:read-own' }, 403)
  }

  const contactType = c.req.query('contactType')
  const riskLevel = c.req.query('riskLevel')
  const tag = c.req.query('tag')
  const tagsQuery = c.req.query('tags')?.split(',').filter(Boolean)
  const assignedTo = c.req.query('assignedTo')

  const rows = await services.contacts.listContactsByScope(
    { hubId, contactType, riskLevel, tag, tags: tagsQuery, assignedTo },
    readScope,
    pubkey
  )

  return c.json({ contacts: rows }, 200)
})

// ── POST / — create contact ──

const CreateContactBodySchema = z.object({
  contactType: z.string(),
  riskLevel: z.string(),
  tags: z.array(z.string()).optional(),
  identifierHash: z.string().optional(),
  assignedTo: z.string().optional(),
  encryptedDisplayName: z.string(),
  displayNameEnvelopes: z.array(z.object({}).passthrough()),
  encryptedNotes: z.string().optional(),
  notesEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedFullName: z.string().optional(),
  fullNameEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPhone: z.string().optional(),
  phoneEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPII: z.string().optional(),
  piiEnvelopes: z.array(z.object({}).passthrough()).optional(),
})

const createContactRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Contacts'],
  summary: 'Create a contact',
  middleware: [...baseMiddleware, requirePermission('contacts:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateContactBodySchema } } },
  },
  responses: {
    201: {
      description: 'Contact created',
      content: { 'application/json': { schema: z.object({ contact: PassthroughSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

core.openapi(createContactRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  if (
    !body.contactType ||
    !body.riskLevel ||
    !body.encryptedDisplayName ||
    !body.displayNameEnvelopes
  ) {
    return c.json(
      {
        error:
          'contactType, riskLevel, encryptedDisplayName, and displayNameEnvelopes are required',
      },
      400
    )
  }

  const contact = await services.contacts.createContact({
    hubId,
    contactType: body.contactType,
    riskLevel: body.riskLevel,
    tags: body.tags ?? [],
    identifierHash: body.identifierHash as HmacHash | undefined,
    assignedTo: body.assignedTo,
    encryptedDisplayName: body.encryptedDisplayName as Ciphertext,
    displayNameEnvelopes: body.displayNameEnvelopes as unknown as RecipientEnvelope[],
    encryptedNotes: body.encryptedNotes as Ciphertext | undefined,
    notesEnvelopes: body.notesEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedFullName: body.encryptedFullName as Ciphertext | undefined,
    fullNameEnvelopes: body.fullNameEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPhone: body.encryptedPhone as Ciphertext | undefined,
    phoneEnvelopes: body.phoneEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPII: body.encryptedPII as Ciphertext | undefined,
    piiEnvelopes: body.piiEnvelopes as unknown as RecipientEnvelope[] | undefined,
    createdBy: pubkey ?? '',
  })

  return c.json({ contact }, 201)
})

// ── GET /{id} — single contact ──

const getContactRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Contacts'],
  summary: 'Get a single contact',
  middleware: baseMiddleware,
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Contact details',
      content: { 'application/json': { schema: z.object({ contact: PassthroughSchema }) } },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

core.openapi(getContactRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const readScope = getContactReadScope(permissions)
  if (!readScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:read-own' }, 403)
  }

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const accessible = await services.contacts.isContactAccessible(id, hubId, readScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  return c.json({ contact }, 200)
})

// ── PATCH /{id} — update contact ──

const UpdateContactBodySchema = z.object({
  contactType: z.string().optional(),
  riskLevel: z.string().optional(),
  tags: z.array(z.string()).optional(),
  identifierHash: z.string().optional(),
  assignedTo: z.string().nullable().optional(),
  encryptedDisplayName: z.string().optional(),
  displayNameEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedNotes: z.string().optional(),
  notesEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedFullName: z.string().optional(),
  fullNameEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPhone: z.string().optional(),
  phoneEnvelopes: z.array(z.object({}).passthrough()).optional(),
  encryptedPII: z.string().optional(),
  piiEnvelopes: z.array(z.object({}).passthrough()).optional(),
})

const updateContactRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Contacts'],
  summary: 'Update a contact',
  middleware: baseMiddleware,
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateContactBodySchema } } },
  },
  responses: {
    200: {
      description: 'Contact updated',
      content: { 'application/json': { schema: z.object({ contact: PassthroughSchema }) } },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

core.openapi(updateContactRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  // Determine which permission tier is needed
  const hasPiiFields =
    body.encryptedFullName !== undefined ||
    body.fullNameEnvelopes !== undefined ||
    body.encryptedPhone !== undefined ||
    body.phoneEnvelopes !== undefined ||
    body.encryptedPII !== undefined ||
    body.piiEnvelopes !== undefined

  const hasSummaryFields =
    body.encryptedDisplayName !== undefined ||
    body.displayNameEnvelopes !== undefined ||
    body.encryptedNotes !== undefined ||
    body.notesEnvelopes !== undefined ||
    body.contactType !== undefined ||
    body.riskLevel !== undefined ||
    body.tags !== undefined

  if (hasPiiFields && !checkPermission(permissions, 'contacts:update-pii')) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-pii' }, 403)
  }

  if (
    hasSummaryFields &&
    !hasPiiFields &&
    !checkPermission(permissions, 'contacts:update-summary')
  ) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-summary' }, 403)
  }

  if (
    !checkPermission(permissions, 'contacts:update-summary') &&
    !checkPermission(permissions, 'contacts:update-pii')
  ) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-summary' }, 403)
  }

  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-own' }, 403)
  }

  const accessible = await services.contacts.isContactAccessible(id, hubId, updateScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const contact = await services.contacts.updateContact(id, hubId, {
    contactType: body.contactType,
    riskLevel: body.riskLevel,
    tags: body.tags,
    identifierHash: body.identifierHash as HmacHash | undefined,
    assignedTo: body.assignedTo,
    encryptedDisplayName: body.encryptedDisplayName as Ciphertext | undefined,
    displayNameEnvelopes: body.displayNameEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedNotes: body.encryptedNotes as Ciphertext | undefined,
    notesEnvelopes: body.notesEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedFullName: body.encryptedFullName as Ciphertext | undefined,
    fullNameEnvelopes: body.fullNameEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPhone: body.encryptedPhone as Ciphertext | undefined,
    phoneEnvelopes: body.phoneEnvelopes as unknown as RecipientEnvelope[] | undefined,
    encryptedPII: body.encryptedPII as Ciphertext | undefined,
    piiEnvelopes: body.piiEnvelopes as unknown as RecipientEnvelope[] | undefined,
  })

  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  return c.json({ contact }, 200)
})

// ── DELETE /{id} — delete contact ──

const deleteContactRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Contacts'],
  summary: 'Delete a contact',
  middleware: [...baseMiddleware, requirePermission('contacts:delete')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Contact deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

core.openapi(deleteContactRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const updateScope = getContactUpdateScope(permissions)
  if (!updateScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:update-own' }, 403)
  }

  const accessible = await services.contacts.isContactAccessible(id, hubId, updateScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  await services.contacts.deleteContact(id, hubId)
  return c.json({ ok: true }, 200)
})

// ── GET /{id}/timeline ──

const getTimelineRoute = createRoute({
  method: 'get',
  path: '/{id}/timeline',
  tags: ['Contacts'],
  summary: 'Get contact timeline (calls, conversations, notes)',
  middleware: baseMiddleware,
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Contact timeline',
      content: {
        'application/json': {
          schema: z.object({
            calls: z.array(PassthroughSchema),
            conversations: z.array(PassthroughSchema),
            notes: z.array(PassthroughSchema),
          }),
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), required: z.string().optional() }),
        },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

core.openapi(getTimelineRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const readScope = getContactReadScope(permissions)
  if (!readScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:read-own' }, 403)
  }

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const accessible = await services.contacts.isContactAccessible(id, hubId, readScope, pubkey)
  if (!accessible) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const [callIds, conversationIds] = await Promise.all([
    services.contacts.getLinkedCallIds(id),
    services.contacts.getLinkedConversationIds(id),
  ])

  const [calls, convs, notes] = await Promise.all([
    services.records.getCallRecordsByIds(callIds, hubId),
    services.conversations.getConversationsByIds(conversationIds, hubId),
    services.records.getNotes({ hubId, contactHash: contact.identifierHash ?? undefined }),
  ])

  return c.json(
    {
      calls,
      conversations: convs,
      notes: notes.notes,
    },
    200
  )
})

const exportContactsRoute = createRoute({
  method: 'post',
  path: '/export',
  tags: ['Contacts'],
  summary: 'Export contacts as encrypted JSON',
  middleware: [...baseMiddleware, requirePermission('contacts:read-own')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ contactIds: z.array(z.string()).min(1) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Exported contacts',
      content: {
        'application/json': {
          schema: z.object({ contacts: z.array(PassthroughSchema) }),
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

core.openapi(exportContactsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const readScope = getContactReadScope(permissions)
  if (!readScope) {
    return c.json({ error: 'Forbidden', required: 'contacts:read-own' }, 403)
  }

  const body = c.req.valid('json')
  const exported: Record<string, unknown>[] = []

  for (const id of body.contactIds) {
    const accessible = await services.contacts.isContactAccessible(
      id,
      hubId,
      readScope,
      pubkey ?? ''
    )
    if (!accessible) continue
    const contact = await services.contacts.getContact(id, hubId)
    if (contact) exported.push(contact as Record<string, unknown>)
  }

  return c.json({ contacts: exported }, 200)
})

export default core
