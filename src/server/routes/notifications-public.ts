/**
 * Public notification routes (no auth required).
 *
 * Browsers need the VAPID public key BEFORE authenticating in order to
 * subscribe to push notifications, so this endpoint lives outside the
 * authenticated notifications router.
 */

import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'

const notificationsPublic = createRouter()

const vapidPublicKeyRoute = createRoute({
  method: 'get',
  path: '/vapid-public-key',
  tags: ['Notifications'],
  summary: 'Get VAPID public key',
  description:
    'Returns the VAPID public key for push notification subscription. No authentication required.',
  responses: {
    200: {
      description: 'VAPID public key',
      content: {
        'application/json': {
          schema: z.object({ publicKey: z.string() }),
        },
      },
    },
    503: {
      description: 'Push notifications not configured',
      content: {
        'application/json': {
          schema: z.object({ error: z.string() }),
        },
      },
    },
  },
})

notificationsPublic.openapi(vapidPublicKeyRoute, (c) => {
  const key = c.env.VAPID_PUBLIC_KEY
  if (!key) return c.json({ error: 'Push notifications not configured' }, 503)
  return c.json({ publicKey: key }, 200)
})

export { notificationsPublic }
