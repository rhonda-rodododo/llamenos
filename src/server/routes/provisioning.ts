import { createRoute, z } from '@hono/zod-openapi'
import { HMAC_IP_PREFIX } from '@shared/crypto-labels'
import { createRouter } from '../lib/openapi'
import { auth } from '../middleware/auth'

const provisioning = createRouter()

/**
 * Device provisioning relay — enables Signal-style device linking.
 *
 * Protocol:
 * 1. New device: POST /rooms → creates room with ephemeral pubkey
 * 2. New device: displays QR/code with { roomId, token }
 * 3. Primary device (authenticated): POST /rooms/:id/payload → sends encrypted nsec
 * 4. New device: GET /rooms/:id → polls for encrypted payload
 */

// ── POST /rooms — Create provisioning room (public — new device has no auth yet) ──

const createRoomRoute = createRoute({
  method: 'post',
  path: '/rooms',
  tags: ['Provisioning'],
  summary: 'Create provisioning room',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ ephemeralPubkey: z.string().min(60) }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Provisioning room created',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Invalid ephemeral pubkey',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

provisioning.openapi(createRoomRoute, async (c) => {
  const services = c.get('services')
  const body = c.req.valid('json')
  if (!body.ephemeralPubkey || body.ephemeralPubkey.length < 60) {
    return c.json({ error: 'Invalid ephemeral pubkey' }, 400)
  }
  const result = await services.identity.createProvisionRoom({
    ephemeralPubkey: body.ephemeralPubkey,
  })
  return c.json(result, 201)
})

// ── GET /rooms/{id} — Get room status (public — new device polls this) ──

const getRoomRoute = createRoute({
  method: 'get',
  path: '/rooms/{id}',
  tags: ['Provisioning'],
  summary: 'Get provisioning room status',
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'room-abc123' }),
    }),
    query: z.object({
      token: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Room status',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Missing token',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Room not found or expired',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

provisioning.openapi(getRoomRoute, async (c) => {
  const services = c.get('services')
  const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const limited = await services.settings.checkRateLimit(
    `provision:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
    30
  )
  if (limited) return c.json({ error: 'Rate limited' }, 429)
  const { id } = c.req.valid('param')
  const { token } = c.req.valid('query')
  if (!token) return c.json({ error: 'Missing token' }, 400)
  try {
    const result = await services.identity.getProvisionRoom(id, token)
    return c.json(result, 200)
  } catch {
    return c.json({ error: 'Room not found or expired' }, 404)
  }
})

// ── POST /rooms/{id}/payload — Send encrypted payload (authenticated — primary device) ──

const sendPayloadRoute = createRoute({
  method: 'post',
  path: '/rooms/{id}/payload',
  tags: ['Provisioning'],
  summary: 'Send encrypted provisioning payload',
  middleware: [auth],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'room-abc123' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            token: z.string(),
            encryptedNsec: z.string(),
            primaryPubkey: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Payload sent',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Missing fields',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Room not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    410: {
      description: 'Room expired',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

provisioning.openapi(sendPayloadRoute, async (c) => {
  const services = c.get('services')
  const { id } = c.req.valid('param')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  if (!body.token || !body.encryptedNsec || !body.primaryPubkey) {
    return c.json({ error: 'Missing fields' }, 400)
  }
  try {
    await services.identity.setProvisionPayload(id, {
      token: body.token,
      encryptedNsec: body.encryptedNsec,
      primaryPubkey: body.primaryPubkey,
      senderPubkey: pubkey,
    })
    return c.json({ ok: true }, 200)
  } catch (err) {
    const status = err instanceof Error && err.message.includes('expired') ? 410 : 404
    return c.json(
      { error: err instanceof Error ? err.message : 'Room not found' },
      status as 404 | 410
    )
  }
})

export default provisioning
