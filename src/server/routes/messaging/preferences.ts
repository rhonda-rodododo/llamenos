/**
 * Public subscriber preferences endpoints (token-validated, no auth).
 *
 * Subscribers receive a preference token in their messages, which they use to
 * view/update their subscription status, language, and tags without needing an
 * account. The token is a per-subscriber HMAC generated server-side.
 */

import { createRoute, z } from '@hono/zod-openapi'
import { PreferencesUpdateSchema } from '@shared/schemas/blasts'
import { createRouter } from '../../lib/openapi'

const preferencesRoutes = createRouter()

const TokenQuerySchema = z.object({
  token: z.string().openapi({ param: { name: 'token', in: 'query' }, example: 'pref_abc123' }),
})

const SubscriberResponseSchema = z.object({
  id: z.string(),
  channels: z.array(z.object({ type: z.string(), verified: z.boolean() })),
  status: z.string(),
  tags: z.array(z.string()),
  language: z.string().nullable(),
})

const getPreferencesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Messaging Preferences'],
  summary: 'Get subscriber preferences',
  request: {
    query: TokenQuerySchema,
  },
  responses: {
    200: {
      description: 'Subscriber preferences',
      content: { 'application/json': { schema: SubscriberResponseSchema } },
    },
    400: {
      description: 'Token required',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Invalid token',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

preferencesRoutes.openapi(getPreferencesRoute, async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Token required' }, 400)
  const services = c.get('services')
  const subscriber = await services.blasts.getSubscriberByPreferenceToken(token)
  if (!subscriber) return c.json({ error: 'Invalid token' }, 404)
  return c.json(
    {
      id: subscriber.id,
      channels: subscriber.channels,
      status: subscriber.status,
      tags: subscriber.tags,
      language: subscriber.language ?? null,
    },
    200
  )
})

const updatePreferencesRoute = createRoute({
  method: 'patch',
  path: '/',
  tags: ['Messaging Preferences'],
  summary: 'Update subscriber preferences',
  request: {
    query: TokenQuerySchema,
    body: {
      content: { 'application/json': { schema: PreferencesUpdateSchema } },
    },
  },
  responses: {
    200: {
      description: 'Updated subscriber preferences',
      content: { 'application/json': { schema: SubscriberResponseSchema } },
    },
    400: {
      description: 'Invalid token or request body',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), details: z.any().optional() }),
        },
      },
    },
    404: {
      description: 'Invalid token',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

preferencesRoutes.openapi(updatePreferencesRoute, async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Token required' }, 400)
  // Validate body BEFORE DB lookup to fail fast on malformed input and avoid
  // hitting the subscribers table with bogus requests.
  const parsed = PreferencesUpdateSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
  }
  const services = c.get('services')
  const subscriber = await services.blasts.getSubscriberByPreferenceToken(token)
  if (!subscriber) return c.json({ error: 'Invalid token' }, 404)
  const body = parsed.data
  const updated = await services.blasts.updateSubscriber(subscriber.id, {
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.language !== undefined ? { language: body.language } : {}),
    ...(body.tags !== undefined ? { tags: body.tags } : {}),
  })
  return c.json(
    {
      id: updated.id,
      channels: updated.channels,
      status: updated.status,
      tags: updated.tags,
      language: updated.language ?? null,
    },
    200
  )
})

export { preferencesRoutes }
