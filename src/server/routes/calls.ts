import { createRoute, z } from '@hono/zod-openapi'
import { getTelephony } from '../lib/adapters'
import { createRouter } from '../lib/openapi'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AuditLogEntry } from '../types'

const calls = createRouter()

// ── Shared schemas ──

const ActiveCallResponseSchema = z.object({
  id: z.string(),
  callerNumber: z.string(),
  answeredBy: z.string().nullable(),
  startedAt: z.string(),
  status: z.string(),
})

const CallIdParamSchema = z.object({
  callId: z.string().openapi({ param: { name: 'callId', in: 'path' }, example: 'CA123abc' }),
})

const AnswerBodySchema = z.object({
  type: z.enum(['phone', 'browser']).optional(),
})

const ErrorSchema = z.object({ error: z.string() })
const OkSchema = z.object({ ok: z.boolean() })

// ── GET /active — list active calls ──

const activeRoute = createRoute({
  method: 'get',
  path: '/active',
  tags: ['Calls'],
  summary: 'List active calls',
  middleware: [requirePermission('calls:read-active')],
  responses: {
    200: {
      description: 'Active calls list',
      content: {
        'application/json': {
          schema: z.object({ calls: z.array(ActiveCallResponseSchema) }),
        },
      },
    },
  },
})

calls.openapi(activeRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const canSeeFullInfo = checkPermission(permissions, 'calls:read-active-full')
  const activeCalls = await services.calls.getActiveCalls(hubId)

  // Map server ActiveCall (callSid, assignedPubkey, Date) to client ActiveCall (id, answeredBy, string)
  const mapped = activeCalls.map((call) => ({
    id: call.callSid,
    callerNumber: canSeeFullInfo ? call.callerNumber : '[redacted]',
    answeredBy: call.assignedPubkey ?? null,
    startedAt: call.startedAt instanceof Date ? call.startedAt.toISOString() : call.startedAt,
    status: call.status,
  }))

  return c.json({ calls: mapped }, 200)
})

// ── GET /today-count — today's call count ──

const todayCountRoute = createRoute({
  method: 'get',
  path: '/today-count',
  tags: ['Calls'],
  summary: 'Get today call count',
  middleware: [requirePermission('calls:read-active')],
  responses: {
    200: {
      description: 'Call count for today',
      content: { 'application/json': { schema: z.object({ count: z.number() }) } },
    },
  },
})

calls.openapi(todayCountRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const count = await services.records.getCallsTodayCount(hubId)
  return c.json({ count }, 200)
})

// ── GET /presence — call presence info ──

const presenceRoute = createRoute({
  method: 'get',
  path: '/presence',
  tags: ['Calls'],
  summary: 'Get call presence info',
  middleware: [requirePermission('calls:read-presence')],
  responses: {
    200: {
      description: 'Presence info',
      content: {
        'application/json': {
          schema: z.object({
            activeCalls: z.number(),
            onShift: z.number(),
            users: z.array(z.string()),
          }),
        },
      },
    },
  },
})

calls.openapi(presenceRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const activeCalls = await services.calls.getActiveCalls(hubId)
  const onShift = await services.shifts.getActiveShifts(hubId)
  return c.json(
    {
      activeCalls: activeCalls.length,
      onShift: onShift.length,
      users: onShift.map((s) => s.pubkey),
    },
    200
  )
})

// ── GET /history — call history ──

const historyRoute = createRoute({
  method: 'get',
  path: '/history',
  tags: ['Calls'],
  summary: 'Get call history',
  middleware: [requirePermission('calls:read-history')],
  responses: {
    200: {
      description: 'Paginated call history',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

calls.openapi(historyRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)
  const filters = {
    ...(c.req.query('search') ? { search: c.req.query('search')! } : {}),
    ...(c.req.query('dateFrom') ? { dateFrom: c.req.query('dateFrom')! } : {}),
    ...(c.req.query('dateTo') ? { dateTo: c.req.query('dateTo')! } : {}),
    ...(c.req.query('voicemailOnly') === 'true' ? { voicemailOnly: true } : {}),
  }
  const result = await services.records.getCallHistory(page, limit, hubId, filters)
  return c.json(result, 200)
})

// ── GET /{callId}/detail — call detail ──

const detailRoute = createRoute({
  method: 'get',
  path: '/{callId}/detail',
  tags: ['Calls'],
  summary: 'Get call detail',
  request: { params: CallIdParamSchema },
  responses: {
    200: {
      description: 'Call detail with notes and audit entries',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
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

calls.openapi(detailRoute, async (c) => {
  const { callId } = c.req.valid('param')
  const services = c.get('services')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const isAdmin = checkPermission(permissions, 'calls:read-history')

  const call = await services.records.getCallRecord(callId, hubId)
  if (!call) return c.json({ error: 'Call not found' }, 404)

  // Users can only view calls they answered (check active + metadata)
  if (!isAdmin) {
    const activeCall = await services.calls.getActiveCall(callId, hubId)
    if (activeCall?.assignedPubkey && activeCall.assignedPubkey !== pubkey) {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  // Fetch notes for this call (admin sees all, user sees own)
  const notesResult = await services.records.getNotes({
    callId,
    hubId: hubId ?? 'global',
    ...(!isAdmin ? { authorPubkey: pubkey } : {}),
  })

  // Fetch audit entries for this call (admin only)
  let auditEntries: AuditLogEntry[] = []
  if (isAdmin) {
    const auditResult = await services.records.getAuditLog({
      search: callId,
      page: 1,
      limit: 100,
      hubId: hubId ?? 'global',
    })
    auditEntries = auditResult.entries
  }

  return c.json(
    {
      call,
      notes: notesResult.notes,
      auditEntries,
    },
    200
  )
})

// ── POST /{callId}/answer — answer a ringing call ──

const answerRoute = createRoute({
  method: 'post',
  path: '/{callId}/answer',
  tags: ['Calls'],
  summary: 'Answer a ringing call',
  middleware: [requirePermission('calls:answer')],
  request: {
    params: CallIdParamSchema,
    body: {
      content: { 'application/json': { schema: AnswerBodySchema } },
      required: false,
    },
  },
  responses: {
    200: {
      description: 'Call answered',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    404: {
      description: 'Call not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Call already answered',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

calls.openapi(answerRoute, async (c) => {
  const { callId } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const hubId = c.get('hubId')

  const body = await c.req
    .json<{ type?: 'phone' | 'browser' }>()
    .catch((): { type?: 'phone' | 'browser' } => ({}))
  const answerType = body.type

  const existing = await services.calls.getActiveCall(callId, hubId)
  if (!existing) return c.json({ error: 'Call not found' }, 404)
  if (existing.assignedPubkey) return c.json({ error: 'Call already answered' }, 409)

  const updated = await services.calls.updateActiveCall(
    callId,
    { assignedPubkey: pubkey, status: 'in-progress' },
    hubId
  )

  // Cancel other ringing legs (both in DB and via telephony adapter for phone legs)
  const phoneLegSidsToCancel = await services.calls.cancelOtherLegs(
    callId,
    hubId,
    pubkey,
    answerType
  )

  if (phoneLegSidsToCancel.length > 0) {
    const adapter = await getTelephony(services.settings, hubId, {
      TWILIO_ACCOUNT_SID: c.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: c.env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: c.env.TWILIO_PHONE_NUMBER,
    })
    if (adapter) {
      await adapter.cancelRinging(phoneLegSidsToCancel)
    }
  }

  return c.json({ call: updated }, 200)
})

// ── POST /{callId}/hangup — hang up an active call ──

const hangupRoute = createRoute({
  method: 'post',
  path: '/{callId}/hangup',
  tags: ['Calls'],
  summary: 'Hang up an active call',
  middleware: [requirePermission('calls:answer')],
  request: { params: CallIdParamSchema },
  responses: {
    200: {
      description: 'Call hung up',
      content: { 'application/json': { schema: OkSchema } },
    },
    403: {
      description: 'Not your call',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Call not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

calls.openapi(hangupRoute, async (c) => {
  const { callId } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const hubId = c.get('hubId')

  const call = await services.calls.getActiveCall(callId, hubId)
  if (!call) return c.json({ error: 'Call not found' }, 404)
  if (call.assignedPubkey !== pubkey) return c.json({ error: 'Not your call' }, 403)

  await services.calls.deleteActiveCall(callId, hubId)
  return c.json({ ok: true }, 200)
})

// ── POST /{callId}/spam — report a call as spam ──

const spamRoute = createRoute({
  method: 'post',
  path: '/{callId}/spam',
  tags: ['Calls'],
  summary: 'Report a call as spam',
  middleware: [requirePermission('calls:answer')],
  request: { params: CallIdParamSchema },
  responses: {
    200: {
      description: 'Reported as spam',
      content: { 'application/json': { schema: OkSchema } },
    },
    403: {
      description: 'Not your call',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Call not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

calls.openapi(spamRoute, async (c) => {
  const { callId } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const hubId = c.get('hubId')

  const call = await services.calls.getActiveCall(callId, hubId)
  if (!call) return c.json({ error: 'Call not found' }, 404)
  if (call.assignedPubkey !== pubkey) return c.json({ error: 'Not your call' }, 403)

  await services.calls.updateActiveCall(
    callId,
    { status: 'spam', metadata: { ...call.metadata, reportedSpam: true, reportedBy: pubkey } },
    hubId
  )
  return c.json({ ok: true }, 200)
})

// ── GET /{callId}/recording — fetch call recording audio ──
// This returns raw audio, not JSON — we use a standard Hono route for binary responses

calls.get('/:callId/recording', async (c) => {
  const callId = c.req.param('callId')
  const services = c.get('services')
  const hubId = c.get('hubId')
  const permissions = c.get('permissions')
  const pubkey = c.get('pubkey')

  const callRecord = await services.records.getCallRecord(callId, hubId)
  if (!callRecord) return c.json({ error: 'Call not found' }, 404)

  if (!callRecord.recordingSid || !callRecord.hasRecording) {
    return c.json({ error: 'No recording available for this call' }, 404)
  }

  const isAdmin = checkPermission(permissions, 'calls:read-recording')
  if (!isAdmin) {
    const activeCall = await services.calls.getActiveCall(callId, hubId)
    const isAnsweringUser = activeCall?.assignedPubkey === pubkey
    if (!isAnsweringUser) {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  const adapter = await getTelephony(services.settings, hubId, {
    TWILIO_ACCOUNT_SID: c.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: c.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: c.env.TWILIO_PHONE_NUMBER,
  })
  if (!adapter) return c.json({ error: 'Telephony provider not configured' }, 503)

  const audio = await adapter.getRecordingAudio(callRecord.recordingSid)
  if (!audio) return c.json({ error: 'Recording not available from provider' }, 404)

  return new Response(audio, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(audio.byteLength),
      'Cache-Control': 'private, no-store',
    },
  })
})

// ── GET /debug — diagnostic endpoint ──

const debugRoute = createRoute({
  method: 'get',
  path: '/debug',
  tags: ['Calls'],
  summary: 'Debug active calls and legs',
  middleware: [requirePermission('calls:debug')],
  responses: {
    200: {
      description: 'Debug info',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

calls.openapi(debugRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const activeCalls = await services.calls.getActiveCalls(hubId)
  const legs = await Promise.all(
    activeCalls.map((call) => services.calls.getCallLegs(call.callSid, hubId))
  )
  return c.json({ activeCalls, legs: legs.flat() }, 200)
})

export default calls
