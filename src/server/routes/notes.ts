import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'
import { checkPermission, requirePermission } from '../middleware/permission-guard'

const notes = createRouter()

// All notes endpoints require at least notes:read-own
const baseMiddleware = requirePermission('notes:read-own')

// ── Shared schemas ──

const NoteResponseSchema = z.object({
  id: z.string(),
  callId: z.string().optional(),
  conversationId: z.string().optional(),
  contactHash: z.string().optional(),
  authorPubkey: z.string(),
  // encryptedContent + ephemeralPubkey retained for server-created transcription notes
  encryptedContent: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ephemeralPubkey: z.string().optional(),
  mlsCiphertext: z.string().optional(),
  mlsEpoch: z.number().optional(),
  replyCount: z.number().optional(),
})

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'note-abc123' }),
})

const CreateNoteBodySchema = z.object({
  callId: z.string().optional(),
  conversationId: z.string().optional(),
  contactHash: z.string().optional(),
  mlsCiphertext: z.string(),
  mlsEpoch: z.number(),
})

const UpdateNoteBodySchema = z.object({
  mlsCiphertext: z.string(),
  mlsEpoch: z.number(),
})

const CreateReplyBodySchema = z.object({
  mlsCiphertext: z.string(),
  mlsEpoch: z.number(),
})

// ── GET / — list notes ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Notes'],
  summary: 'List notes',
  middleware: [baseMiddleware],
  responses: {
    200: {
      description: 'Paginated notes',
      content: {
        'application/json': {
          schema: z.object({ notes: z.array(NoteResponseSchema), total: z.number() }),
        },
      },
    },
  },
})

notes.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'notes:read-all')
  const callId = c.req.query('callId')
  const conversationId = c.req.query('conversationId')
  const contactHash = c.req.query('contactHash')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)

  const result = await services.records.getNotes({
    ...(callId ? { callId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(contactHash ? { contactHash } : {}),
    ...(!canReadAll ? { authorPubkey: pubkey } : {}),
    page,
    limit,
    hubId: hubId ?? 'global',
  })
  return c.json(result, 200)
})

// ── POST / — create note ──

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Notes'],
  summary: 'Create a note',
  middleware: [baseMiddleware, requirePermission('notes:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateNoteBodySchema } } },
  },
  responses: {
    201: {
      description: 'Note created',
      content: { 'application/json': { schema: z.object({ note: NoteResponseSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

notes.openapi(createRoute_, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  if (!body.callId && !body.conversationId) {
    return c.json({ error: 'callId or conversationId required' }, 400)
  }
  const note = await services.records.createNote({
    ...body,
    authorPubkey: pubkey,
    hubId: hubId ?? 'global',
  })
  await services.records.addAuditEntry(hubId ?? 'global', 'noteCreated', pubkey, {
    noteId: note.id,
    callId: body.callId,
    conversationId: body.conversationId,
  })
  return c.json({ note }, 201)
})

// ── GET /{id} — get note by id ──

const getByIdRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Notes'],
  summary: 'Get a note by ID',
  middleware: [baseMiddleware],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Note details',
      content: { 'application/json': { schema: z.object({ note: NoteResponseSchema }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

notes.openapi(getByIdRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const { id } = c.req.valid('param')

  const canReadAll = checkPermission(permissions, 'notes:read-all')
  const note = await services.records.getNote(id)
  if (!note) return c.json({ error: 'Note not found' }, 404)

  // Users can only view their own notes
  if (!canReadAll && note.authorPubkey !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json({ note }, 200)
})

// ── PATCH /{id} — update note ──

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Notes'],
  summary: 'Update a note',
  middleware: [baseMiddleware, requirePermission('notes:update-own')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateNoteBodySchema } } },
  },
  responses: {
    200: {
      description: 'Note updated',
      content: { 'application/json': { schema: z.object({ note: NoteResponseSchema }) } },
    },
    404: {
      description: 'Note not found or not in current hub',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

notes.openapi(updateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  // Verify the note belongs to the current hub before allowing update
  const existing = await services.records.getNote(id)
  if (!existing || existing.hubId !== (hubId ?? 'global')) {
    return c.json({ error: 'Note not found' }, 404)
  }
  const updated = await services.records.updateNote(id, { ...body, authorPubkey: pubkey })
  await services.records.addAuditEntry(hubId ?? 'global', 'noteEdited', pubkey, { noteId: id })
  return c.json({ note: updated }, 200)
})

// ── GET /{id}/replies — get replies to a note ──

const getRepliesRoute = createRoute({
  method: 'get',
  path: '/{id}/replies',
  tags: ['Notes'],
  summary: 'Get replies to a note',
  middleware: [baseMiddleware],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Note replies',
      content: {
        'application/json': { schema: z.object({ notes: z.array(NoteResponseSchema) }) },
      },
    },
  },
})

notes.openapi(getRepliesRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  // Replies are notes linked to the parent note via callId or conversationId
  const parent = await services.records.getNote(id)
  if (!parent) return c.json({ notes: [] }, 200)
  const result = await services.records.getNotes({
    ...(parent.callId ? { callId: parent.callId } : {}),
    ...(parent.conversationId ? { conversationId: parent.conversationId } : {}),
    hubId: hubId ?? 'global',
  })
  // Filter to only replies (notes after the parent that have the same context)
  const replies = result.notes.filter((n) => n.id !== id)
  return c.json({ notes: replies }, 200)
})

// ── POST /{id}/replies — create a reply ──

const createReplyRoute = createRoute({
  method: 'post',
  path: '/{id}/replies',
  tags: ['Notes'],
  summary: 'Reply to a note',
  middleware: [baseMiddleware, requirePermission('notes:reply')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: CreateReplyBodySchema } } },
  },
  responses: {
    201: {
      description: 'Reply created',
      content: { 'application/json': { schema: NoteResponseSchema } },
    },
    404: {
      description: 'Parent note not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

notes.openapi(createReplyRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  // Get parent note for context
  const parent = await services.records.getNote(id)
  if (!parent) return c.json({ error: 'Parent note not found' }, 404)
  const reply = await services.records.createNote({
    mlsCiphertext: body.mlsCiphertext,
    mlsEpoch: body.mlsEpoch,
    authorPubkey: pubkey,
    callId: parent.callId,
    conversationId: parent.conversationId,
    contactHash: parent.contactHash,
    hubId: hubId ?? 'global',
  })
  await services.records.addAuditEntry(hubId ?? 'global', 'noteReplyCreated', pubkey, {
    noteId: id,
  })
  return c.json(reply, 201)
})

export default notes
