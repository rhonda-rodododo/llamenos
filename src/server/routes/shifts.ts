import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

const shifts = createRouter()

// ── Shared schemas ──
// Response schemas match the service layer output shape.

const ShiftResponseSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  name: z.string(),
  encryptedName: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  days: z.array(z.number()),
  userPubkeys: z.array(z.string()),
  ringGroupId: z.string().nullable().optional(),
  createdAt: z.string(),
})

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'shift-abc123' }),
})

const FallbackBodySchema = z.object({
  users: z.array(z.string()),
})

const CreateShiftBodySchema = z.object({
  // Client-generated UUID. Required when `encryptedName` is provided so the
  // server stores the same id the client used as AAD `recordId`.
  id: z.string().uuid().optional(),
  name: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  days: z.array(z.number()),
  userPubkeys: z.array(z.string()),
  ringGroupId: z.string().optional(),
  encryptedName: z.string().optional(),
  hubId: z.string().optional(),
})

const UpdateShiftBodySchema = z.object({
  name: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  days: z.array(z.number()).optional(),
  userPubkeys: z.array(z.string()).optional(),
  ringGroupId: z.string().optional(),
  encryptedName: z.string().optional(),
  hubId: z.string().optional(),
})

// ── GET /my-status — check own shift status ──

const myStatusRoute = createRoute({
  method: 'get',
  path: '/my-status',
  tags: ['Shifts'],
  summary: 'Get current user shift status',
  responses: {
    200: {
      description: 'User shift status',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

shifts.openapi(myStatusRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const status = await services.shifts.getUserStatus(pubkey, hubId)
  return c.json(status, 200)
})

// ── GET /fallback — get fallback group ──

const getFallbackRoute = createRoute({
  method: 'get',
  path: '/fallback',
  tags: ['Shifts'],
  summary: 'Get fallback group',
  middleware: [requirePermission('shifts:manage-fallback')],
  responses: {
    200: {
      description: 'Fallback group users',
      content: {
        'application/json': { schema: z.object({ users: z.array(z.string()) }) },
      },
    },
  },
})

shifts.openapi(getFallbackRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const fallback = await services.settings.getFallbackGroup(hubId)
  return c.json({ users: fallback }, 200)
})

// ── PUT /fallback — set fallback group ──

const setFallbackRoute = createRoute({
  method: 'put',
  path: '/fallback',
  tags: ['Shifts'],
  summary: 'Set fallback group',
  middleware: [requirePermission('shifts:manage-fallback')],
  request: {
    body: { content: { 'application/json': { schema: FallbackBodySchema } } },
  },
  responses: {
    200: {
      description: 'Fallback group updated',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

shifts.openapi(setFallbackRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = c.req.valid('json')
  await services.settings.setFallbackGroup(body.users || [], hubId)
  return c.json({ ok: true }, 200)
})

// ── GET / — list all shifts ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Shifts'],
  summary: 'List shift schedules',
  middleware: [requirePermission('shifts:read-all')],
  responses: {
    200: {
      description: 'Shift schedules list',
      content: {
        'application/json': { schema: z.object({ shifts: z.array(ShiftResponseSchema) }) },
      },
    },
  },
})

shifts.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const schedules = await services.shifts.getSchedules(hubId)
  return c.json({ shifts: schedules }, 200)
})

// ── POST / — create shift schedule ──

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Shifts'],
  summary: 'Create a shift schedule',
  middleware: [requirePermission('shifts:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateShiftBodySchema } } },
  },
  responses: {
    201: {
      description: 'Shift schedule created',
      content: {
        'application/json': { schema: z.object({ shift: ShiftResponseSchema }) },
      },
    },
  },
})

shifts.openapi(createRoute_, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const schedule = await services.shifts.createSchedule({ ...body, hubId: hubId ?? 'global' })
  await services.records.addAuditEntry(hubId ?? 'global', 'shiftCreated', pubkey)
  return c.json({ shift: schedule }, 201)
})

// ── PATCH /{id} — update shift schedule ──

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Shifts'],
  summary: 'Update a shift schedule',
  middleware: [requirePermission('shifts:update')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateShiftBodySchema } } },
  },
  responses: {
    200: {
      description: 'Shift schedule updated',
      content: {
        'application/json': { schema: z.object({ shift: ShiftResponseSchema }) },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

shifts.openapi(updateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)
  const body = c.req.valid('json')
  const updated = await services.shifts.updateSchedule(id, hubId ?? 'global', body)
  await services.records.addAuditEntry(hubId ?? 'global', 'shiftEdited', pubkey, { shiftId: id })
  return c.json({ shift: updated }, 200)
})

// ── DELETE /{id} — delete shift schedule ──

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Shifts'],
  summary: 'Delete a shift schedule',
  middleware: [requirePermission('shifts:delete')],
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Shift schedule deleted',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

shifts.openapi(deleteRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const { id } = c.req.valid('param')
  if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)
  await services.shifts.deleteSchedule(id, hubId ?? 'global')
  await services.records.addAuditEntry(hubId ?? 'global', 'shiftDeleted', pubkey, { shiftId: id })
  return c.json({ ok: true }, 200)
})

export default shifts
