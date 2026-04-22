import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'

const blasts = createRouter()

// ── Shared schemas ──

const PassthroughSchema = z.object({}).passthrough()
const ErrorSchema = z.object({ error: z.string() })
const OkSchema = z.object({ ok: z.boolean() })

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'blast-abc123' }),
})

const SubscriberIdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'subscriber-abc123' }),
})

// --- Subscribers ---

// ── GET /subscribers ──

const listSubscribersRoute = createRoute({
  method: 'get',
  path: '/subscribers',
  tags: ['Blasts'],
  summary: 'List blast subscribers',
  responses: {
    200: {
      description: 'Subscribers list',
      content: {
        'application/json': { schema: z.object({ subscribers: z.array(PassthroughSchema) }) },
      },
    },
  },
})

blasts.openapi(listSubscribersRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const subscribers = await services.blasts.listSubscribers(hubId ?? undefined)
  return c.json({ subscribers }, 200)
})

// ── DELETE /subscribers/{id} ──

const deleteSubscriberRoute = createRoute({
  method: 'delete',
  path: '/subscribers/{id}',
  tags: ['Blasts'],
  summary: 'Delete a subscriber',
  request: { params: SubscriberIdParamSchema },
  responses: {
    200: {
      description: 'Subscriber deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
  },
})

blasts.openapi(deleteSubscriberRoute, async (c) => {
  const { id } = c.req.valid('param')
  const services = c.get('services')
  await services.blasts.deleteSubscriber(id)
  return c.json({ ok: true }, 200)
})

// ── GET /subscribers/stats ──

const subscriberStatsRoute = createRoute({
  method: 'get',
  path: '/subscribers/stats',
  tags: ['Blasts'],
  summary: 'Get subscriber statistics',
  responses: {
    200: {
      description: 'Subscriber stats',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

blasts.openapi(subscriberStatsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const stats = await services.blasts.getSubscriberStats(hubId ?? undefined)
  return c.json(stats, 200)
})

// ── POST /subscribers/import ──

const importSubscribersRoute = createRoute({
  method: 'post',
  path: '/subscribers/import',
  tags: ['Blasts'],
  summary: 'Import subscribers in bulk',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              identifierHash: z.string(),
              channels: z
                .array(
                  z.object({
                    type: z.enum(['sms', 'whatsapp', 'signal', 'rcs']),
                    verified: z.boolean(),
                  })
                )
                .optional(),
              tags: z.array(z.string()).optional(),
              language: z.string().optional(),
              status: z.string().optional(),
              preferenceToken: z.string().optional(),
            })
          ),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Import results',
      content: {
        'application/json': {
          schema: z.object({
            imported: z.number(),
            failed: z.number(),
            skipped: z.number(),
          }),
        },
      },
    },
    400: {
      description: 'Invalid input',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

blasts.openapi(importSubscribersRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = c.req.valid('json')
  if (!Array.isArray(body)) {
    return c.json({ error: 'Expected array of subscribers' }, 400)
  }
  const results = await Promise.allSettled(
    body.map((sub) =>
      services.blasts.createSubscriber({
        hubId: hubId ?? 'global',
        identifierHash: sub.identifierHash,
        channels: sub.channels,
        tags: sub.tags,
        language: sub.language,
        status: sub.status,
        preferenceToken: sub.preferenceToken,
      })
    )
  )
  const imported = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length
  return c.json({ imported, failed, skipped: failed }, 200)
})

// --- Blasts ---

// ── GET / — list blasts ──

const listBlastsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Blasts'],
  summary: 'List blasts',
  responses: {
    200: {
      description: 'Blasts list',
      content: {
        'application/json': { schema: z.object({ blasts: z.array(PassthroughSchema) }) },
      },
    },
  },
})

blasts.openapi(listBlastsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const blastList = await services.blasts.listBlasts(hubId ?? undefined)
  return c.json({ blasts: blastList }, 200)
})

// ── POST / — create blast ──

const CreateBlastBodySchema = z.object({
  name: z.string(),
  targetChannels: z.array(z.string()).optional(),
  targetTags: z.array(z.string()).optional(),
  targetLanguages: z.array(z.string()).optional(),
  encryptedContent: z.string().optional(),
  contentEnvelopes: z.array(z.object({}).passthrough()).optional(),
  status: z.string().optional(),
})

const createBlastRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Blasts'],
  summary: 'Create a blast',
  request: {
    body: { content: { 'application/json': { schema: CreateBlastBodySchema } } },
  },
  responses: {
    201: {
      description: 'Blast created',
      content: { 'application/json': { schema: z.object({ blast: PassthroughSchema }) } },
    },
  },
})

blasts.openapi(createBlastRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = c.req.valid('json')
  const blast = await services.blasts.createBlast({
    hubId: hubId ?? 'global',
    name: body.name,
    targetChannels: body.targetChannels,
    targetTags: body.targetTags,
    targetLanguages: body.targetLanguages,
    encryptedContent: body.encryptedContent,
    contentEnvelopes:
      body.contentEnvelopes as unknown as import('../../shared/types').RecipientEnvelope[],
    status: body.status,
  })
  return c.json({ blast }, 201)
})

// ── GET /{id} — get blast ──

const getBlastRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Blasts'],
  summary: 'Get a blast',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Blast details',
      content: { 'application/json': { schema: z.object({ blast: PassthroughSchema }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

blasts.openapi(getBlastRoute, async (c) => {
  const { id } = c.req.valid('param')
  const services = c.get('services')
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  return c.json({ blast }, 200)
})

// ── PATCH /{id} — update blast ──

const updateBlastRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Blasts'],
  summary: 'Update a blast',
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Blast updated',
      content: { 'application/json': { schema: z.object({ blast: PassthroughSchema }) } },
    },
  },
})

blasts.openapi(updateBlastRoute, async (c) => {
  const { id } = c.req.valid('param')
  const services = c.get('services')
  const body = c.req.valid('json')
  const updated = await services.blasts.updateBlast(
    id,
    body as Parameters<typeof services.blasts.updateBlast>[1]
  )
  return c.json({ blast: updated }, 200)
})

// ── DELETE /{id} — delete blast ──

const deleteBlastRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Blasts'],
  summary: 'Delete a blast',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Blast deleted',
      content: { 'application/json': { schema: OkSchema } },
    },
  },
})

blasts.openapi(deleteBlastRoute, async (c) => {
  const { id } = c.req.valid('param')
  const services = c.get('services')
  await services.blasts.deleteBlast(id)
  return c.json({ ok: true }, 200)
})

// ── POST /{id}/send — send blast ──

const sendBlastRoute = createRoute({
  method: 'post',
  path: '/{id}/send',
  tags: ['Blasts'],
  summary: 'Send a blast',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Blast sending initiated',
      content: { 'application/json': { schema: z.object({ blast: PassthroughSchema }) } },
    },
    400: {
      description: 'Invalid state',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

blasts.openapi(sendBlastRoute, async (c) => {
  const { id } = c.req.valid('param')
  const services = c.get('services')
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  if (blast.status !== 'draft' && blast.status !== 'scheduled') {
    return c.json({ error: 'Blast cannot be sent in its current state' }, 400)
  }
  const updated = await services.blasts.updateBlast(id, {
    status: 'sending',
    sentAt: new Date(),
  })
  return c.json({ blast: updated }, 200)
})

// ── POST /{id}/schedule — schedule blast ──

const ScheduleBlastBodySchema = z.object({
  scheduledAt: z.string(),
})

const scheduleBlastRoute = createRoute({
  method: 'post',
  path: '/{id}/schedule',
  tags: ['Blasts'],
  summary: 'Schedule a blast',
  request: {
    params: IdParamSchema,
    body: { content: { 'application/json': { schema: ScheduleBlastBodySchema } } },
  },
  responses: {
    200: {
      description: 'Blast scheduled',
      content: { 'application/json': { schema: z.object({ blast: PassthroughSchema }) } },
    },
    400: {
      description: 'Invalid state or missing scheduledAt',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

blasts.openapi(scheduleBlastRoute, async (c) => {
  const { id } = c.req.valid('param')
  const services = c.get('services')
  const body = c.req.valid('json')
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  if (blast.status !== 'draft') {
    return c.json({ error: 'Only draft blasts can be scheduled' }, 400)
  }
  const updated = await services.blasts.updateBlast(id, {
    status: 'scheduled',
    scheduledAt: new Date(body.scheduledAt),
  })
  return c.json({ blast: updated }, 200)
})

// ── POST /{id}/cancel — cancel blast ──

const cancelBlastRoute = createRoute({
  method: 'post',
  path: '/{id}/cancel',
  tags: ['Blasts'],
  summary: 'Cancel a blast',
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: 'Blast cancelled',
      content: { 'application/json': { schema: z.object({ blast: PassthroughSchema }) } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

blasts.openapi(cancelBlastRoute, async (c) => {
  const { id } = c.req.valid('param')
  const services = c.get('services')
  const blast = await services.blasts.getBlast(id)
  if (!blast) return c.json({ error: 'Blast not found' }, 404)
  const updated = await services.blasts.updateBlast(id, { status: 'cancelled' })
  return c.json({ blast: updated }, 200)
})

// --- Settings ---

// ── GET /settings ──

const getBlastSettingsRoute = createRoute({
  method: 'get',
  path: '/settings',
  tags: ['Blasts'],
  summary: 'Get blast settings',
  responses: {
    200: {
      description: 'Blast settings',
      content: {
        'application/json': {
          schema: z.object({
            subscribeKeyword: z.string(),
            autoRespond: z.boolean(),
          }),
        },
      },
    },
  },
})

blasts.openapi(getBlastSettingsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const config = await services.settings.getMessagingConfig(hubId ?? undefined)
  return c.json(
    {
      subscribeKeyword:
        (config as typeof config & { subscribeKeyword?: string }).subscribeKeyword ?? 'JOIN',
      autoRespond: (config as typeof config & { autoRespond?: boolean }).autoRespond ?? false,
    },
    200
  )
})

// ── PATCH /settings ──

const updateBlastSettingsRoute = createRoute({
  method: 'patch',
  path: '/settings',
  tags: ['Blasts'],
  summary: 'Update blast settings',
  request: {
    body: { content: { 'application/json': { schema: PassthroughSchema } } },
  },
  responses: {
    200: {
      description: 'Settings updated',
      content: { 'application/json': { schema: PassthroughSchema } },
    },
  },
})

blasts.openapi(updateBlastSettingsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = c.req.valid('json')
  const updated = await services.settings.updateMessagingConfig(
    body as Parameters<typeof services.settings.updateMessagingConfig>[0],
    hubId ?? undefined
  )
  return c.json(updated, 200)
})

export default blasts
