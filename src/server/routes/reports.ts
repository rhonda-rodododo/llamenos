import { createRoute, z } from '@hono/zod-openapi'
import { KIND_CONVERSATION_ASSIGNED, KIND_MESSAGE_NEW } from '../../shared/nostr-events'
import type { RecipientEnvelope } from '../../shared/types'
import { getNostrPublisher } from '../lib/adapters'
import { createLogger } from '../lib/logger'
import { createRouter } from '../lib/openapi'
import { isReportOwner } from '../lib/report-access'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const log = createLogger('routes.reports')

/** Publish a report/conversation event to the Nostr relay */
function publishReportEvent(
  env: AppEnv['Bindings'],
  kind: number,
  content: Record<string, unknown>,
  hubId?: string
) {
  try {
    const publisher = getNostrPublisher(env)
    publisher
      .publish({
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', hubId ?? 'global'],
          ['t', 'llamenos:event'],
        ],
        content: JSON.stringify(content),
      })
      .catch((err) => log.error('Nostr report event publish failed', err))
  } catch {
    // Nostr not configured
  }
}

const reports = createRouter()

// ── Shared schemas ──

const PassthroughSchema = z.object({}).passthrough()
const ErrorSchema = z.object({ error: z.string() })

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'report-abc123' }),
})

// ── GET / — list reports ──

const listReportsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Reports'],
  summary: 'List reports',
  responses: {
    200: {
      description: 'Reports list',
      content: {
        'application/json': {
          schema: z.object({
            conversations: z.array(PassthroughSchema),
            total: z.number(),
          }),
        },
      },
    },
  },
})

reports.openapi(listReportsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  const status = c.req.query('status') || ''
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10), 100)

  const canReadAll = checkPermission(permissions, 'reports:read-all')
  const canReadAssigned = checkPermission(permissions, 'reports:read-assigned')

  const result = await services.conversations.listConversations({
    hubId: hubId ?? 'global',
    channelType: 'web',
    ...(status ? { status } : {}),
    page,
    limit,
  })

  let filteredConvs = result.conversations.filter(
    (c) => (c.metadata as Record<string, unknown>)?.type === 'report'
  )

  if (!canReadAll) {
    filteredConvs = filteredConvs.filter((conv) => {
      if (canReadAssigned && conv.assignedTo === pubkey) return true
      if (isReportOwner(conv, pubkey)) return true
      return false
    })
  }

  return c.json({ conversations: filteredConvs, total: filteredConvs.length }, 200)
})

// ── POST / — create report ──

const CreateReportBodySchema = z.object({
  title: z.string(),
  category: z.string().optional(),
  reportTypeId: z.string().optional(),
  encryptedContent: z.string(),
  readerEnvelopes: z.array(z.object({}).passthrough()),
})

const createReportRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Reports'],
  summary: 'Create a new report',
  middleware: [requirePermission('reports:create')],
  request: {
    body: { content: { 'application/json': { schema: CreateReportBodySchema } } },
  },
  responses: {
    201: {
      description: 'Report created',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

reports.openapi(createReportRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  if (!body.encryptedContent || !body.readerEnvelopes?.length) {
    return c.json({ error: 'Report content is required' }, 400)
  }

  // Validate reportTypeId belongs to this hub if provided
  if (body.reportTypeId) {
    const reportType = await services.reportTypes.getReportType(
      hubId ?? 'global',
      body.reportTypeId
    )
    if (!reportType || reportType.archivedAt) {
      return c.json({ error: 'Invalid or archived report type' }, 400)
    }
  }

  const conversation = await services.conversations.createConversation({
    hubId: hubId ?? 'global',
    channelType: 'web',
    contactIdentifierHash: pubkey,
    skipDedup: true,
    status: 'waiting',
    metadata: {
      type: 'report',
      reportTitle: body.title,
      reportCategory: body.category,
    },
    reportTypeId: body.reportTypeId,
  })

  const msg = await services.conversations.addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    authorPubkey: pubkey,
    encryptedContent: body.encryptedContent,
    readerEnvelopes: body.readerEnvelopes as unknown as RecipientEnvelope[],
    hasAttachments: false,
    status: 'delivered',
  })

  publishReportEvent(
    c.env,
    KIND_MESSAGE_NEW,
    {
      type: 'report:new',
      conversationId: conversation.id,
      category: body.category,
    },
    hubId ?? undefined
  )

  await services.records.addAuditEntry(hubId ?? 'global', 'reportCreated', pubkey, {
    conversationId: conversation.id,
    category: body.category,
  })

  return c.json({ ...conversation, firstMessage: msg }, 201)
})

// ── GET /categories ──

const getCategoriesRoute = createRoute({
  method: 'get',
  path: '/categories',
  tags: ['Reports'],
  summary: 'Get report categories',
  responses: {
    200: {
      description: 'Report categories',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

reports.openapi(getCategoriesRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const result = await services.settings.getReportCategories(hubId ?? undefined)
  return c.json(result, 200)
})

// ── GET /{id} — get single report ──

const getReportRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Reports'],
  summary: 'Get a single report',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Report details',
      content: { 'application/json': { schema: PassthroughSchema } },
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

reports.openapi(getReportRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  const report = await services.conversations.getConversation(id)
  if (!report) {
    return c.json({ error: 'Report not found' }, 404)
  }

  if ((report.metadata as Record<string, unknown>)?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }
  if (report.hubId !== (hubId ?? 'global')) {
    return c.json({ error: 'Report not found' }, 404)
  }

  const canReadAll = checkPermission(permissions, 'reports:read-all')
  const canReadAssigned = checkPermission(permissions, 'reports:read-assigned')

  if (!canReadAll) {
    if (canReadAssigned && report.assignedTo === pubkey) {
      // OK
    } else if (isReportOwner(report, pubkey)) {
      // Own report
    } else {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  return c.json(report, 200)
})

// ── GET /{id}/messages — get report messages ──

const getReportMessagesRoute = createRoute({
  method: 'get',
  path: '/{id}/messages',
  tags: ['Reports'],
  summary: 'Get report messages',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Report messages',
      content: { 'application/json': { schema: PassthroughSchema } },
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

reports.openapi(getReportMessagesRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  const report = await services.conversations.getConversation(id)
  if (!report) {
    return c.json({ error: 'Report not found' }, 404)
  }

  if ((report.metadata as Record<string, unknown>)?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  const canReadAll = checkPermission(permissions, 'reports:read-all')
  const canReadAssigned = checkPermission(permissions, 'reports:read-assigned')

  if (!canReadAll) {
    if (canReadAssigned && report.assignedTo === pubkey) {
      // OK
    } else if (isReportOwner(report, pubkey)) {
      // Own report
    } else {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '100', 10), 200)
  const page = Number.parseInt(c.req.query('page') || '1', 10)

  const result = await services.conversations.getMessages(id, page, limit)
  return c.json(result, 200)
})

// ── POST /{id}/messages — send message in report thread ──

const SendReportMessageBodySchema = z.object({
  encryptedContent: z.string(),
  readerEnvelopes: z.array(z.object({}).passthrough()),
  attachmentIds: z.array(z.string()).optional(),
})

const sendReportMessageRoute = createRoute({
  method: 'post',
  path: '/{id}/messages',
  tags: ['Reports'],
  summary: 'Send a message in a report thread',
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: SendReportMessageBodySchema } } },
  },
  responses: {
    200: {
      description: 'Message sent',
      content: { 'application/json': { schema: PassthroughSchema } },
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

reports.openapi(sendReportMessageRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  const report = await services.conversations.getConversation(id)
  if (!report) {
    return c.json({ error: 'Report not found' }, 404)
  }

  if ((report.metadata as Record<string, unknown>)?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  const canSendAny = checkPermission(permissions, 'reports:send-message')
  const canSendOwn = checkPermission(permissions, 'reports:send-message-own')

  if (!canSendAny) {
    if (canSendOwn && isReportOwner(report, pubkey)) {
      // Reporter can reply to own report
    } else if (report.assignedTo === pubkey) {
      // Assigned user can reply
    } else {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  const body = c.req.valid('json')

  const isReporter = isReportOwner(report, pubkey)
  const direction = isReporter ? 'inbound' : 'outbound'

  const msg = await services.conversations.addMessage({
    conversationId: id,
    direction,
    authorPubkey: pubkey,
    encryptedContent: body.encryptedContent,
    readerEnvelopes: body.readerEnvelopes as unknown as RecipientEnvelope[],
    hasAttachments: (body.attachmentIds?.length ?? 0) > 0,
    attachmentIds: body.attachmentIds,
    status: 'delivered',
  })

  publishReportEvent(
    c.env,
    KIND_MESSAGE_NEW,
    {
      type: 'message:new',
      conversationId: id,
    },
    hubId ?? undefined
  )

  return c.json(msg, 200)
})

// ── POST /{id}/assign — assign user to report ──

const AssignReportBodySchema = z.object({
  assignedTo: z.string(),
})

const assignReportRoute = createRoute({
  method: 'post',
  path: '/{id}/assign',
  tags: ['Reports'],
  summary: 'Assign a user to a report',
  middleware: [requirePermission('reports:assign')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: AssignReportBodySchema } } },
  },
  responses: {
    200: {
      description: 'Report assigned',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

reports.openapi(assignReportRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const updated = await services.conversations.updateConversation(id, {
    assignedTo: body.assignedTo,
    status: 'active',
  })

  await services.records.addAuditEntry(hubId ?? 'global', 'reportAssigned', pubkey, {
    reportId: id,
    assignedTo: body.assignedTo,
  })

  publishReportEvent(
    c.env,
    KIND_CONVERSATION_ASSIGNED,
    {
      type: 'conversation:assigned',
      conversationId: id,
      assignedTo: body.assignedTo,
    },
    hubId ?? undefined
  )

  return c.json(updated, 200)
})

// ── PATCH /{id} — update report status ──

const UpdateReportBodySchema = z.object({
  status: z.string().optional(),
})

const updateReportRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Reports'],
  summary: 'Update report status',
  middleware: [requirePermission('reports:update')],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateReportBodySchema } } },
  },
  responses: {
    200: {
      description: 'Report updated',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

reports.openapi(updateReportRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')

  const body = c.req.valid('json')

  const updated = await services.conversations.updateConversation(id, {
    ...(body.status !== undefined ? { status: body.status } : {}),
  })

  await services.records.addAuditEntry(hubId ?? 'global', 'reportUpdated', pubkey, {
    reportId: id,
    ...body,
  })
  return c.json(updated, 200)
})

// ── GET /{id}/files — get report files ──

const getReportFilesRoute = createRoute({
  method: 'get',
  path: '/{id}/files',
  tags: ['Reports'],
  summary: 'Get files attached to a report',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Report files',
      content: {
        'application/json': {
          schema: z.object({ files: z.array(PassthroughSchema) }),
        },
      },
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

reports.openapi(getReportFilesRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')

  const report = await services.conversations.getConversation(id)
  if (!report) {
    return c.json({ error: 'Report not found' }, 404)
  }

  if ((report.metadata as Record<string, unknown>)?.type !== 'report') {
    return c.json({ error: 'Not a report' }, 404)
  }

  const canReadAll = checkPermission(permissions, 'reports:read-all')
  const canReadAssigned = checkPermission(permissions, 'reports:read-assigned')

  if (!canReadAll) {
    if (canReadAssigned && report.assignedTo === pubkey) {
      // OK
    } else if (isReportOwner(report, pubkey)) {
      // Own
    } else {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  void hubId
  const { messages } = await services.conversations.getMessages(id, 1, 200)
  const filesFromMessages = messages
    .filter((m) => m.hasAttachments && m.attachmentIds?.length)
    .flatMap((m) =>
      (m.attachmentIds ?? []).map((fileId) => ({
        id: fileId,
        messageId: m.id,
        conversationId: id,
      }))
    )

  return c.json({ files: filesFromMessages }, 200)
})

export default reports
