import { createRoute, z } from '@hono/zod-openapi'
import { KIND_CONVERSATION_ASSIGNED, KIND_MESSAGE_NEW } from '../../shared/nostr-events'
import { canClaimChannel, getClaimableChannels } from '../../shared/permissions'
import type { MessagingChannelType, RecipientEnvelope } from '../../shared/types'
import { getMessagingAdapter, getNostrPublisher } from '../lib/adapters'
import { createLogger } from '../lib/logger'
import { createRouter } from '../lib/openapi'
import { checkPermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const log = createLogger('routes.conversations')

const conversations = createRouter()

// ── Shared schemas ──

const PassthroughSchema = z.object({}).passthrough()
const ErrorSchema = z.object({ error: z.string() })

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'conv-abc123' }),
})

/** Publish a conversation event to the Nostr relay */
function publishConversationEvent(
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
      .catch((err) => log.error('Nostr conversation event publish failed', err))
  } catch {
    // Nostr not configured
  }
}

// ── GET / — list conversations ──

const listConversationsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Conversations'],
  summary: 'List conversations',
  responses: {
    200: {
      description: 'Conversations list',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

conversations.openapi(listConversationsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const user = c.get('user')
  const canReadAll = checkPermission(permissions, 'conversations:read-all')
  const status = c.req.query('status')
  const channel = c.req.query('channel')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)

  if (!canReadAll) {
    const [assignedResult, waitingResult] = await Promise.all([
      services.conversations.listConversations({
        hubId: hubId ?? 'global',
        ...(status ? { status } : {}),
        ...(channel ? { channelType: channel } : {}),
        assignedTo: pubkey,
        page,
        limit,
      }),
      services.conversations.listConversations({
        hubId: hubId ?? 'global',
        status: 'waiting',
        ...(channel ? { channelType: channel } : {}),
        page: 1,
        limit: 200,
      }),
    ])

    const claimableChannels = getClaimableChannels(permissions)
    const userChannels = user.supportedMessagingChannels

    let filteredWaiting = waitingResult.conversations
    if (claimableChannels.length > 0) {
      filteredWaiting = filteredWaiting.filter((conv) =>
        claimableChannels.includes(conv.channelType)
      )
    }
    if (userChannels && userChannels.length > 0) {
      filteredWaiting = filteredWaiting.filter((conv) =>
        userChannels.includes(conv.channelType as MessagingChannelType)
      )
    }
    if (user.messagingEnabled === false) {
      filteredWaiting = []
    }

    return c.json(
      {
        conversations: [...assignedResult.conversations, ...filteredWaiting],
        assignedCount: assignedResult.total,
        waitingCount: filteredWaiting.length,
        claimableChannels,
      },
      200
    )
  }

  const result = await services.conversations.listConversations({
    hubId: hubId ?? 'global',
    ...(status ? { status } : {}),
    ...(channel ? { channelType: channel } : {}),
    page,
    limit,
  })
  return c.json(result, 200)
})

// ── GET /stats — conversation metrics ──

const conversationStatsRoute = createRoute({
  method: 'get',
  path: '/stats',
  tags: ['Conversations'],
  summary: 'Get conversation metrics',
  responses: {
    200: {
      description: 'Conversation stats',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

conversations.openapi(conversationStatsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const stats = await services.conversations.getConversationStats(hubId ?? 'global')
  return c.json(stats, 200)
})

// ── GET /load — user load counts ──

const conversationLoadRoute = createRoute({
  method: 'get',
  path: '/load',
  tags: ['Conversations'],
  summary: 'Get user load counts (active conversations per user)',
  responses: {
    200: {
      description: 'User load counts',
      content: {
        'application/json': {
          schema: z.object({ loads: z.record(z.string(), z.number()) }),
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

conversations.openapi(conversationLoadRoute, async (c) => {
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'conversations:read-all')
  if (!canReadAll) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const services = c.get('services')
  const hubId = c.get('hubId')

  const { conversations: activeConvs } = await services.conversations.listConversations({
    hubId: hubId ?? 'global',
    status: 'active',
    limit: 1000,
  })

  const loads: Record<string, number> = {}
  for (const conv of activeConvs) {
    if (conv.assignedTo) {
      loads[conv.assignedTo] = (loads[conv.assignedTo] ?? 0) + 1
    }
  }

  return c.json({ loads }, 200)
})

// ── GET /{id} — get single conversation ──

const getConversationRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Conversations'],
  summary: 'Get a single conversation',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Conversation details',
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

conversations.openapi(getConversationRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'conversations:read-all')

  const conv = await services.conversations.getConversation(id)
  if (!conv) return c.json({ error: 'Not found' }, 404)

  if (!canReadAll && conv.assignedTo !== pubkey && conv.status !== 'waiting') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  return c.json(conv, 200)
})

// ── GET /{id}/messages — paginated messages ──

const getConversationMessagesRoute = createRoute({
  method: 'get',
  path: '/{id}/messages',
  tags: ['Conversations'],
  summary: 'Get conversation messages',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Conversation messages',
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

conversations.openapi(getConversationMessagesRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canReadAll = checkPermission(permissions, 'conversations:read-all')
  const page = Number.parseInt(c.req.query('page') || '1', 10)
  const limit = Number.parseInt(c.req.query('limit') || '50', 10)

  const conv = await services.conversations.getConversation(id)
  if (!conv) return c.json({ error: 'Not found' }, 404)
  if (!canReadAll && conv.assignedTo !== pubkey && conv.status !== 'waiting') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const result = await services.conversations.getMessages(id, page, limit)
  return c.json(result, 200)
})

// ── POST /{id}/messages — send outbound message ──

const SendMessageBodySchema = z.object({
  encryptedContent: z.string(),
  readerEnvelopes: z.array(z.object({}).passthrough()),
  plaintextForSending: z.string().optional(),
})

const sendMessageRoute = createRoute({
  method: 'post',
  path: '/{id}/messages',
  tags: ['Conversations'],
  summary: 'Send an outbound message',
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: SendMessageBodySchema } } },
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

conversations.openapi(sendMessageRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canSendAny = checkPermission(permissions, 'conversations:send-any')

  const conv = await services.conversations.getConversation(id)
  if (!conv) return c.json({ error: 'Not found' }, 404)
  if (!canSendAny && conv.assignedTo !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = c.req.valid('json')

  let messageStatus = 'pending'
  let messageExternalId: string | undefined
  let messageFailureReason: string | undefined

  if (body.plaintextForSending && conv.channelType !== 'web') {
    try {
      const adapter = await getMessagingAdapter(
        conv.channelType as 'sms' | 'whatsapp' | 'signal',
        services.settings,
        services.crypto,
        hubId ?? undefined
      )
      const identifier = conv.externalId
      if (!identifier) throw new Error('Contact identifier not available for outbound')
      const result = await adapter.sendMessage({
        recipientIdentifier: identifier,
        body: body.plaintextForSending,
        conversationId: id,
      })

      if (result.success && result.externalId) {
        messageExternalId = result.externalId
        messageStatus = 'sent'
      } else if (!result.success) {
        messageStatus = 'failed'
        messageFailureReason = result.error
      }
    } catch (err) {
      log.error('Failed to send outbound message', err, { channelType: conv.channelType })
      messageStatus = 'failed'
      messageFailureReason = err instanceof Error ? err.message : 'Unknown error'
    }
  } else if (conv.channelType === 'web') {
    messageStatus = 'delivered'
  }

  const stored = await services.conversations.addMessage({
    conversationId: id,
    direction: 'outbound',
    authorPubkey: pubkey,
    encryptedContent: body.encryptedContent,
    readerEnvelopes: body.readerEnvelopes as unknown as RecipientEnvelope[],
    hasAttachments: false,
    externalId: messageExternalId,
    status: messageStatus,
  })

  publishConversationEvent(
    c.env,
    KIND_MESSAGE_NEW,
    {
      type: 'message:new',
      conversationId: id,
      channelType: 'outbound',
    },
    hubId ?? undefined
  )

  c.executionCtx.waitUntil(
    services.records.addAuditEntry(hubId ?? 'global', 'messageSent', pubkey, {
      conversationId: id,
      channel: conv.channelType,
      ...(messageFailureReason ? { failureReason: messageFailureReason } : {}),
    })
  )

  return c.json(stored, 200)
})

// ── PATCH /{id} — update conversation ──

const UpdateConversationBodySchema = z.object({
  status: z.string().optional(),
  assignedTo: z.string().optional(),
})

const updateConversationRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Conversations'],
  summary: 'Update conversation (assign, close, reopen)',
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: UpdateConversationBodySchema } } },
  },
  responses: {
    200: {
      description: 'Conversation updated',
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

conversations.openapi(updateConversationRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const canUpdate = checkPermission(permissions, 'conversations:update')
  const body = c.req.valid('json')

  const existing = await services.conversations.getConversation(id)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!canUpdate && existing.assignedTo !== pubkey) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const updated = await services.conversations.updateConversation(id, {
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo } : {}),
  })

  const convEventType = body.status === 'closed' ? 'conversation:closed' : 'conversation:assigned'
  publishConversationEvent(
    c.env,
    KIND_CONVERSATION_ASSIGNED,
    {
      type: convEventType,
      conversationId: id,
      assignedTo: body.assignedTo,
    },
    hubId ?? undefined
  )

  c.executionCtx.waitUntil(
    services.records.addAuditEntry(
      hubId ?? 'global',
      body.status === 'closed' ? 'conversationClosed' : 'conversationUpdated',
      pubkey,
      { conversationId: id }
    )
  )

  return c.json(updated, 200)
})

// ── POST /{id}/claim — claim a waiting conversation ──

const claimConversationRoute = createRoute({
  method: 'post',
  path: '/{id}/claim',
  tags: ['Conversations'],
  summary: 'Claim a waiting conversation',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Conversation claimed',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    400: {
      description: 'Not in waiting state',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

conversations.openapi(claimConversationRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const user = c.get('user')

  const conv = await services.conversations.getConversation(id)
  if (!conv) return c.json({ error: 'Not found' }, 404)

  if (!canClaimChannel(permissions, conv.channelType)) {
    return c.json(
      {
        error: 'No permission to claim this channel type',
        channelType: conv.channelType,
        allowedChannels: getClaimableChannels(permissions),
      },
      403
    )
  }

  if (user.supportedMessagingChannels && user.supportedMessagingChannels.length > 0) {
    if (!user.supportedMessagingChannels.includes(conv.channelType as MessagingChannelType)) {
      return c.json(
        {
          error: 'User not configured for this channel',
          channelType: conv.channelType,
          supportedChannels: user.supportedMessagingChannels,
        },
        403
      )
    }
  }

  if (user.messagingEnabled === false) {
    return c.json({ error: 'Messaging not enabled for this user' }, 403)
  }

  if (conv.status !== 'waiting') {
    return c.json({ error: 'Conversation is not waiting to be claimed' }, 400)
  }

  const claimed = await services.conversations.updateConversation(id, {
    assignedTo: pubkey,
    status: 'active',
  })

  publishConversationEvent(
    c.env,
    KIND_CONVERSATION_ASSIGNED,
    {
      type: 'conversation:assigned',
      conversationId: id,
      assignedTo: pubkey,
    },
    hubId ?? undefined
  )

  c.executionCtx.waitUntil(
    services.records.addAuditEntry(hubId ?? 'global', 'conversationClaimed', pubkey, {
      conversationId: id,
      channelType: conv.channelType,
    })
  )

  return c.json(claimed, 200)
})

export default conversations
