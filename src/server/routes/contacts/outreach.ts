import { createRoute, z } from '@hono/zod-openapi'
import type { MessagingChannelType } from '@shared/types'
import { getMessagingAdapter } from '../../lib/adapters'
import { createRouter } from '../../lib/openapi'
import { requirePermission } from '../../middleware/permission-guard'
import { baseMiddleware, ErrorSchema, IdParamSchema } from './shared'

const outreach = createRouter()

// ── POST /{id}/notify ──

const NotifyBodySchema = z.object({
  notifications: z.array(
    z.object({
      contactId: z.string(),
      channel: z.object({ type: z.string(), identifier: z.string() }),
      message: z.string(),
    })
  ),
})

const notifyRoute = createRoute({
  method: 'post',
  path: '/{id}/notify',
  tags: ['Contacts'],
  summary: 'Send notifications to support contacts',
  middleware: [
    ...baseMiddleware,
    requirePermission('contacts:envelope-full', 'conversations:send'),
  ],
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: NotifyBodySchema } } },
  },
  responses: {
    200: {
      description: 'Notification results',
      content: {
        'application/json': {
          schema: z.object({
            results: z.array(
              z.object({
                contactId: z.string(),
                status: z.enum(['sent', 'failed']),
                error: z.string().optional(),
              })
            ),
          }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

outreach.openapi(notifyRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const { id } = c.req.valid('param')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) return c.json({ error: 'Contact not found' }, 404)

  const body = c.req.valid('json')

  if (!body.notifications?.length) {
    return c.json({ error: 'notifications array is required' }, 400)
  }

  const results: Array<{ contactId: string; status: 'sent' | 'failed'; error?: string }> = []

  for (const notification of body.notifications) {
    try {
      const channelType = notification.channel.type as MessagingChannelType
      const adapter = await getMessagingAdapter(
        channelType,
        services.settings,
        services.crypto,
        hubId !== 'global' ? hubId : undefined
      )
      const result = await adapter.sendMessage({
        recipientIdentifier: notification.channel.identifier,
        body: notification.message,
      })
      results.push({
        contactId: notification.contactId,
        status: result.success ? 'sent' : 'failed',
        error: result.success ? undefined : result.error,
      })
    } catch (err) {
      results.push({
        contactId: notification.contactId,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return c.json({ results }, 200)
})

export default outreach
