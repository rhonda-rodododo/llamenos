import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'

const notifications = createRouter()

// ── GET /vapid-public-key — public, returns VAPID public key from env ──

const getVapidKeyRoute = createRoute({
  method: 'get',
  path: '/vapid-public-key',
  tags: ['Notifications'],
  summary: 'Get VAPID public key',
  responses: {
    200: {
      description: 'VAPID public key',
      content: { 'application/json': { schema: z.object({ publicKey: z.string() }) } },
    },
    503: {
      description: 'Push notifications not configured',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

notifications.openapi(getVapidKeyRoute, (c) => {
  const key = c.env.VAPID_PUBLIC_KEY
  if (!key) {
    return c.json({ error: 'Push notifications not configured' }, 503)
  }
  return c.json({ publicKey: key }, 200)
})

// ── POST /subscribe — authenticated, stores a push subscription ──

const subscribeRoute = createRoute({
  method: 'post',
  path: '/subscribe',
  tags: ['Notifications'],
  summary: 'Subscribe to push notifications',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            endpoint: z.string(),
            keys: z.object({ auth: z.string(), p256dh: z.string() }),
            deviceLabel: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Subscription created',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Missing required fields',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

notifications.openapi(subscribeRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  if (!body.endpoint || !body.keys?.auth || !body.keys?.p256dh) {
    return c.json({ error: 'Missing required fields: endpoint, keys.auth, keys.p256dh' }, 400)
  }

  const services = c.get('services')
  const subscription = await services.push.subscribe({
    pubkey,
    endpoint: body.endpoint,
    authKey: body.keys.auth,
    p256dhKey: body.keys.p256dh,
    deviceLabel: body.deviceLabel,
  })

  return c.json(subscription, 200)
})

// ── DELETE /subscribe — authenticated, removes a push subscription ──

const unsubscribeRoute = createRoute({
  method: 'delete',
  path: '/subscribe',
  tags: ['Notifications'],
  summary: 'Unsubscribe from push notifications',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ endpoint: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Subscription removed',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Missing required field',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

notifications.openapi(unsubscribeRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  if (!body.endpoint) {
    return c.json({ error: 'Missing required field: endpoint' }, 400)
  }

  const services = c.get('services')
  await services.push.unsubscribe(body.endpoint, pubkey)

  return c.json({ ok: true }, 200)
})

export default notifications
