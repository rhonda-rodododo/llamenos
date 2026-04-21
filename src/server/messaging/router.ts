import { LABEL_FIREHOSE_BUFFER_ENCRYPT, LABEL_MESSAGE } from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { Hono } from 'hono'
import {
  KIND_CONVERSATION_ASSIGNED,
  KIND_FIREHOSE_MESSAGE,
  KIND_MESSAGE_NEW,
} from '../../shared/nostr-events'
import type { MessagingChannelType, MessagingConfig, WhatsAppConfig } from '../../shared/types'
import { getMessagingAdapter, getNostrPublisher } from '../lib/adapters'
import { createLogger } from '../lib/logger'
import type { Services } from '../services'

const log = createLogger('messaging.router')
import type { AppEnv } from '../types'
import type { IncomingMessage, MessageStatusUpdate, MessagingAdapter } from './adapter'

const messaging = new Hono<AppEnv>()

/**
 * WhatsApp webhook verification (GET).
 * Meta's Cloud API sends a GET request with hub.mode, hub.verify_token, hub.challenge
 * to verify webhook ownership during setup.
 */
messaging.get('/whatsapp/webhook', async (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return c.text('Bad request', 400)
  }

  // Read WhatsApp config to check verify token
  const services = c.get('services')
  try {
    const config = await services.settings.getMessagingConfig()
    const waConfig = config?.whatsapp as WhatsAppConfig | null
    if (waConfig?.verifyToken && token === waConfig.verifyToken) {
      return c.text(challenge)
    }
  } catch {
    /* fall through */
  }

  return c.text('Forbidden', 403)
})

/**
 * RCS webhook verification (GET).
 * Google RBM sends a GET request to verify webhook ownership during setup.
 */
messaging.get('/rcs/webhook', async (c) => {
  // Google RBM webhook verification — just return 200
  return c.text('OK', 200)
})

/**
 * Messaging webhook handler.
 * Each channel has its own webhook URL:
 *   /api/messaging/sms/webhook?hub={hubId}
 *   /api/messaging/whatsapp/webhook?hub={hubId}
 *   /api/messaging/signal/webhook?hub={hubId}
 *
 * No auth middleware — each adapter validates its own webhook signature.
 */
messaging.post('/:channel/webhook', async (c) => {
  const channel = c.req.param('channel') as MessagingChannelType
  const validChannels: MessagingChannelType[] = ['sms', 'whatsapp', 'signal', 'rcs', 'telegram']
  if (!validChannels.includes(channel)) {
    return c.json({ error: 'Unknown channel' }, 404)
  }

  // Hub-scoped routing: read hubId from query param, fall back to global
  const url = new URL(c.req.url)
  const hubId = url.searchParams.get('hub') || undefined
  const services = c.get('services')

  let adapter: MessagingAdapter
  try {
    adapter = await getMessagingAdapter(channel, services.settings, services.crypto, hubId)
  } catch {
    return c.json({ error: `${channel} channel is not configured` }, 404)
  }

  // Dev bypass: skip signature validation for localhost simulation POSTs
  const isDev = c.env.ENVIRONMENT === 'development'
  const isLocal =
    isDev && (c.req.header('CF-Connecting-IP') === '127.0.0.1' || url.hostname === 'localhost')

  if (!isLocal) {
    const isValid = await adapter.validateWebhook(c.req.raw)
    if (!isValid) {
      log.error('Webhook signature validation failed', undefined, { channel })
      return new Response('Forbidden', { status: 403 })
    }
  }

  // Try to parse as status update first (if adapter supports it)
  if (adapter.parseStatusWebhook) {
    try {
      const statusUpdate = await adapter.parseStatusWebhook(c.req.raw.clone() as Request)
      if (statusUpdate) {
        // This is a status update — find the message by externalId and update its status
        await handleStatusUpdate(services, hubId, statusUpdate, c.env)
        return c.json({ ok: true })
      }
    } catch {
      // Not a status update, continue to parse as message
    }
  }

  // Parse the incoming message
  let incoming: IncomingMessage
  try {
    incoming = await adapter.parseIncomingMessage(c.req.raw)
  } catch (err) {
    log.error('Failed to parse webhook', err, { channel })
    return c.json({ error: 'Failed to parse message' }, 400)
  }

  // --- Firehose group detection ---
  // If this is a Signal group message, check if it belongs to a firehose connection.
  // If so, encrypt for the agent + admins and buffer it. Do NOT create a conversation.
  if (incoming.channelType === 'signal' && incoming.metadata?.groupId) {
    const firehoseResult = await handleFirehoseMessage(services, c.env, hubId ?? 'global', incoming)
    if (firehoseResult) {
      return c.json({ ok: true })
    }
    // Not a firehose group — continue normal flow
  }

  // Keyword interception for blast subscribe/unsubscribe
  if (incoming.body) {
    const normalizedBody = incoming.body.trim().toUpperCase()
    const hId = hubId ?? 'global'
    // STOP is always recognized (TCPA compliance)
    if (normalizedBody === 'STOP') {
      // Find subscriber and deactivate them
      const existing = await services.blasts.findSubscriberByHash(
        incoming.senderIdentifierHash,
        hId
      )
      if (existing) {
        await services.blasts.updateSubscriber(existing.id, { status: 'unsubscribed' })
      }
      // Still forward to conversation for logging
    } else {
      // Firehose notification opt-out detection (STOP-{8-char connection shortcode})
      const firehoseOptoutMatch = normalizedBody.match(/^STOP-([A-Z0-9]{8})$/)
      if (firehoseOptoutMatch) {
        const shortCode = firehoseOptoutMatch[1]
        const connections = await services.firehose.listConnections(hId)
        const conn = connections.find((c) => c.id.slice(0, 8).toUpperCase() === shortCode)
        if (conn) {
          // Map sender to user — requires identity lookup by phone hash which is complex.
          // For now, log the opt-out request. Future: find user by Signal phone hash,
          // then call services.firehose.addOptout(conn.id, userId).
          log.info('Firehose opt-out request', {
            connectionId: conn.id,
            senderHash: incoming.senderIdentifierHash,
          })
        }
      }

      // Check if it matches the subscribe keyword
      try {
        const config = await services.settings.getMessagingConfig(hId)
        const subscribeKeyword = (config as MessagingConfig & { subscribeKeyword?: string })
          .subscribeKeyword
        if (subscribeKeyword && normalizedBody === subscribeKeyword.toUpperCase()) {
          await services.blasts.createSubscriber({
            hubId: hId,
            identifierHash: incoming.senderIdentifierHash,
            channels: [
              {
                type: incoming.channelType as 'sms' | 'whatsapp' | 'signal' | 'rcs' | 'telegram',
                verified: false,
              },
            ],
            status: 'active',
          })
        }
      } catch {
        /* blast settings not configured — ignore */
      }
    }
  }

  // Find or create conversation for this inbound message
  const hId = hubId ?? 'global'
  let conversation = await services.conversations.findByExternalId(
    hId,
    incoming.channelType,
    incoming.senderIdentifier
  )

  const isNew = !conversation
  if (!conversation) {
    conversation = await services.conversations.createConversation({
      hubId: hId,
      channelType: incoming.channelType,
      contactIdentifierHash: incoming.senderIdentifierHash,
      externalId: incoming.senderIdentifier,
      status: 'waiting',
    })

    // Auto-link to contact if identifier hash matches a known contact
    try {
      const contact = await services.contacts.findByIdentifierHash(
        incoming.senderIdentifierHash as import('@shared/crypto-types').HmacHash,
        hId
      )
      if (contact) {
        await services.contacts.linkConversation(contact.id, conversation.id, hId, 'auto')
      }
    } catch (err) {
      log.error('Auto-link contact failed (non-fatal)', err)
    }
  }

  // Server-encrypt the inbound message body under LABEL_MESSAGE.
  // The first client to fetch decrypts via serverDecrypt, re-encrypts via MLS,
  // and PATCHes back via /conversations/{id}/messages/{msgId}/claim.
  const serverEncryptedBody = services.crypto.serverEncrypt(incoming.body || '', LABEL_MESSAGE)

  // Store the encrypted message
  await services.conversations.addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    authorPubkey: 'system:inbound',
    encryptedContent: '',
    readerEnvelopes: [],
    hasAttachments: !!(incoming.mediaUrls && incoming.mediaUrls.length > 0),
    externalId: incoming.externalId,
    status: 'delivered',
    serverEncryptedBody,
  })

  // Auto-assignment for new conversations
  if (isNew && conversation.status === 'waiting') {
    tryAutoAssign(services, c.env, conversation.id, channel, hId).catch((err) =>
      log.error('Auto-assign background task failed', err)
    )
  }

  // Audit the incoming message (no PII — only hashed identifier)
  services.records
    .addAuditEntry(hId, 'messageReceived', 'system', {
      channel,
      senderHash: incoming.senderIdentifierHash,
    })
    .catch((err) => log.error('Audit entry background task failed', err))

  // Return 200 to acknowledge webhook (providers expect fast acknowledgment)
  return c.json({ ok: true })
})

/**
 * Handle a delivery status update for a previously-sent message.
 * Updates the message's deliveryStatus in the DB and publishes a Nostr event.
 */
async function handleStatusUpdate(
  services: Services,
  hubId: string | undefined,
  statusUpdate: MessageStatusUpdate,
  env: AppEnv['Bindings']
): Promise<void> {
  if (!statusUpdate.externalId) return

  // Update the message delivery status in DB by providerMessageId
  try {
    await services.conversations.updateMessageDeliveryByExternalId(statusUpdate.externalId, {
      deliveryStatus: statusUpdate.status,
      deliveryError: statusUpdate.failureReason,
    })
  } catch (err) {
    log.error('Failed to update message delivery status', err)
  }

  // Publish status update to Nostr relay so clients can react in real-time
  try {
    const publisher = getNostrPublisher(env)
    publisher
      .publish({
        kind: KIND_MESSAGE_NEW,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', hubId ?? 'global'],
          ['t', 'llamenos:event'],
        ],
        content: JSON.stringify({
          type: 'message:status',
          externalId: statusUpdate.externalId,
          status: statusUpdate.status,
          timestamp: statusUpdate.timestamp,
          ...(statusUpdate.failureReason ? { failureReason: statusUpdate.failureReason } : {}),
        }),
      })
      .catch((err) => log.error('Nostr status event publish failed', err))
  } catch {
    // Nostr not configured
  }
}

/**
 * Try to auto-assign a new conversation to an available user.
 * This runs in background via executionCtx.waitUntil() to not delay webhook response.
 */
async function tryAutoAssign(
  services: Services,
  env: AppEnv['Bindings'],
  conversationId: string,
  channelType: MessagingChannelType,
  hubId: string
): Promise<void> {
  try {
    // 1. Check if auto-assign is enabled
    const messagingConfig = await services.settings.getMessagingConfig(hubId)
    if (!messagingConfig?.autoAssign) return

    const maxConcurrent = messagingConfig.maxConcurrentPerUser || 3

    // 2. Get current on-shift users
    const onShiftShifts = await services.shifts.getActiveShifts(hubId)
    if (onShiftShifts.length === 0) return
    const onShiftPubkeys = onShiftShifts.map((s) => s.pubkey)

    // 3. Get user details to filter by channel capability
    const allUsers = await services.identity.getUsers()
    const onShiftUsers = allUsers.filter(
      (v) =>
        onShiftPubkeys.includes(v.pubkey) && v.active && !v.onBreak && v.messagingEnabled !== false
    )

    // Filter by channel capability
    const eligibleUsers = onShiftUsers.filter((v) => {
      // If no channels specified, user can handle all
      if (!v.supportedMessagingChannels || v.supportedMessagingChannels.length === 0) {
        return true
      }
      return v.supportedMessagingChannels.includes(channelType)
    })

    if (eligibleUsers.length === 0) return

    // 4. Get user load counts (active conversations per user)
    const { conversations: activeConvs } = await services.conversations.listConversations({
      hubId,
      status: 'active',
      limit: 1000,
    })
    const loads: Record<string, number> = {}
    for (const conv of activeConvs) {
      if (conv.assignedTo) {
        loads[conv.assignedTo] = (loads[conv.assignedTo] ?? 0) + 1
      }
    }

    // 5. Find least-loaded user under max capacity
    let bestCandidate: string | null = null
    let lowestLoad = Number.POSITIVE_INFINITY

    for (const vol of eligibleUsers) {
      const currentLoad = loads[vol.pubkey] || 0
      if (currentLoad < maxConcurrent && currentLoad < lowestLoad) {
        lowestLoad = currentLoad
        bestCandidate = vol.pubkey
      }
    }

    if (!bestCandidate) return // All users at capacity

    // 6. Auto-assign the conversation
    await services.conversations.updateConversation(conversationId, {
      assignedTo: bestCandidate,
      status: 'active',
    })

    // Publish assignment to Nostr relay
    try {
      const publisher = getNostrPublisher(env)
      publisher
        .publish({
          kind: KIND_CONVERSATION_ASSIGNED,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', hubId],
            ['t', 'llamenos:event'],
          ],
          content: JSON.stringify({
            type: 'conversation:assigned',
            conversationId,
            assignedTo: bestCandidate,
            autoAssigned: true,
          }),
        })
        .catch((err: unknown) => {
          log.warn('Nostr notify for auto-assignment failed', {
            err: err instanceof Error ? err.message : String(err),
          })
        })
    } catch (err) {
      log.warn('Failed to get Nostr publisher for auto-assignment', {
        err: err instanceof Error ? err.message : String(err),
      })
    }

    log.info('Auto-assigned conversation', { conversationId })
  } catch (err) {
    log.error('Auto-assignment failed', err)
  }
}

/**
 * Check if an incoming Signal group message belongs to a firehose connection.
 * If so, encrypt and buffer it for the agent. Returns true if handled.
 */
async function handleFirehoseMessage(
  services: Services,
  env: AppEnv['Bindings'],
  hubId: string,
  incoming: IncomingMessage
): Promise<boolean> {
  const groupId = incoming.metadata?.groupId
  if (!groupId) return false

  // Look up active firehose connection for this Signal group
  const connection = await services.firehose.findConnectionBySignalGroup(groupId, hubId)
  if (!connection) return false // No active connection for this group — not a firehose message

  if (connection.status === 'disabled') return false

  // Encrypt message body for the agent + admins
  const adminPubkey = env.ADMIN_DECRYPTION_PUBKEY || env.ADMIN_PUBKEY
  if (!adminPubkey) {
    log.warn('Cannot buffer firehose message: admin pubkeys unconfigured', {
      connectionId: connection.id,
    })
    return false
  }

  const readerPubkeys = [connection.agentPubkey, adminPubkey]
  const encrypted = services.crypto.envelopeEncrypt(
    incoming.body || '',
    readerPubkeys,
    LABEL_FIREHOSE_BUFFER_ENCRYPT
  )

  // Encrypt sender info separately
  const senderInfo = JSON.stringify({
    identifier: incoming.senderIdentifier,
    identifierHash: incoming.senderIdentifierHash,
    username: incoming.metadata?.senderName || incoming.senderIdentifier,
    timestamp: incoming.timestamp,
  })
  const encryptedSender = services.crypto.envelopeEncrypt(
    senderInfo,
    [connection.agentPubkey, adminPubkey],
    LABEL_FIREHOSE_BUFFER_ENCRYPT
  )

  // Buffer the message — store full envelope JSON so the agent can decrypt
  const ttlMs = connection.bufferTtlDays * 24 * 60 * 60 * 1000
  await services.firehose.addBufferMessage(connection.id, {
    signalTimestamp: new Date(incoming.timestamp),
    encryptedContent: JSON.stringify({
      encrypted: encrypted.encrypted,
      envelopes: encrypted.envelopes,
    }),
    encryptedSenderInfo: JSON.stringify({
      encrypted: encryptedSender.encrypted,
      envelopes: encryptedSender.envelopes,
    }),
    expiresAt: new Date(Date.now() + ttlMs),
  })

  // Publish Nostr event for agent subscription
  try {
    const publisher = getNostrPublisher(env)
    publisher
      .publish({
        kind: KIND_FIREHOSE_MESSAGE,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', hubId],
          ['t', 'llamenos:event'],
          ['c', connection.id],
        ],
        content: JSON.stringify({
          type: 'firehose:message',
          connectionId: connection.id,
        }),
      })
      .catch((err) => log.error('Nostr firehose event publish failed', err))
  } catch (err) {
    if (err instanceof Error && !err.message.includes('not configured')) {
      log.error('Unexpected Nostr error', err)
    }
  }

  // Audit log
  services.records
    .addAuditEntry(hubId, 'firehoseMessageReceived', 'system', {
      connectionId: connection.id,
      senderHash: incoming.senderIdentifierHash,
    })
    .catch((err) => log.error('Firehose audit entry background task failed', err))

  return true
}

export default messaging
