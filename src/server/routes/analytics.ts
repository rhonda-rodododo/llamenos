import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

const analytics = createRouter()

// ── GET /calls — call volume by day ──

const callVolumeRoute = createRoute({
  method: 'get',
  path: '/calls',
  tags: ['Analytics'],
  summary: 'Get call volume grouped by day',
  middleware: [requirePermission('calls:read-history')],
  responses: {
    200: {
      description: 'Call volume data',
      content: {
        'application/json': {
          schema: z.object({ days: z.number(), data: z.array(z.object({}).passthrough()) }),
        },
      },
    },
  },
})

analytics.openapi(callVolumeRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const daysParam = c.req.query('days')
  const days = daysParam === '7' ? 7 : 30

  const data = await services.records.getCallVolumeByDay(hubId, days)
  return c.json({ days, data }, 200)
})

// ── GET /hours — call hour distribution ──

const callHoursRoute = createRoute({
  method: 'get',
  path: '/hours',
  tags: ['Analytics'],
  summary: 'Get call count per hour of day',
  middleware: [requirePermission('calls:read-history')],
  responses: {
    200: {
      description: 'Hourly call distribution',
      content: {
        'application/json': {
          schema: z.object({ days: z.number(), data: z.array(z.object({}).passthrough()) }),
        },
      },
    },
  },
})

analytics.openapi(callHoursRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const data = await services.records.getCallHourDistribution(hubId, 30)
  return c.json({ days: 30, data }, 200)
})

// ── GET /users — per-user call stats ──

const userStatsRoute = createRoute({
  method: 'get',
  path: '/users',
  tags: ['Analytics'],
  summary: 'Get per-user call statistics',
  middleware: [requirePermission('audit:read')],
  responses: {
    200: {
      description: 'Per-user call stats',
      content: {
        'application/json': {
          schema: z.object({ days: z.number(), data: z.array(z.object({}).passthrough()) }),
        },
      },
    },
  },
})

analytics.openapi(userStatsRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const data = await services.records.getUserCallStats(hubId, 30)
  return c.json({ days: 30, data }, 200)
})

export default analytics
