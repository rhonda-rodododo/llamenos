import { createRoute, z } from '@hono/zod-openapi'
import type { GeocodingConfigAdmin } from '../../shared/types'
import { createGeocodingAdapter } from '../geocoding/factory'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'

const geocoding = createRouter()

/**
 * Helper: load geocoding config from SettingsService and create an adapter.
 */
async function getAdapter(c: {
  get: (key: 'services') => {
    settings: { getGeocodingConfig: () => Promise<GeocodingConfigAdmin> }
  }
}) {
  const config = await c.get('services').settings.getGeocodingConfig()
  return { adapter: createGeocodingAdapter(config), config }
}

/**
 * Helper: check rate limit via SettingsService.
 */
async function isRateLimited(
  c: {
    get: (key: 'services') => {
      settings: { checkRateLimit: (key: string, maxPerMinute: number) => Promise<boolean> }
    }
  },
  key: string,
  maxPerMinute: number
): Promise<boolean> {
  return c.get('services').settings.checkRateLimit(key, maxPerMinute)
}

// ── POST /autocomplete — Geocoding autocomplete ──

const autocompleteRoute = createRoute({
  method: 'post',
  path: '/autocomplete',
  tags: ['Geocoding'],
  summary: 'Geocoding autocomplete',
  middleware: [requirePermission('notes:create')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            query: z.string(),
            limit: z.number().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Autocomplete results',
      content: { 'application/json': { schema: z.array(z.object({}).passthrough()) } },
    },
    400: {
      description: 'Missing query',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limit exceeded',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    502: {
      description: 'Geocoding failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

geocoding.openapi(autocompleteRoute, async (c) => {
  const body = c.req.valid('json')
  if (!body.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
    return c.json({ error: 'Query string required' }, 400)
  }
  const query = body.query.trim()
  const limit = Math.min(Math.max(body.limit ?? 5, 1), 10)
  const pubkey = c.get('pubkey')

  if (await isRateLimited(c, `geocoding:autocomplete:${pubkey}`, 60)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c)
    const results = await adapter.autocomplete(query, { limit })
    return c.json(results, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Geocoding failed'
    return c.json({ error: message }, 502)
  }
})

// ── POST /geocode — Forward geocode ──

const geocodeRoute = createRoute({
  method: 'post',
  path: '/geocode',
  tags: ['Geocoding'],
  summary: 'Forward geocode an address',
  middleware: [requirePermission('notes:create')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ address: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Geocode result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Missing address',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limit exceeded',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    502: {
      description: 'Geocoding failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

geocoding.openapi(geocodeRoute, async (c) => {
  const body = c.req.valid('json')
  if (!body.address || typeof body.address !== 'string' || body.address.trim().length === 0) {
    return c.json({ error: 'Address string required' }, 400)
  }
  const pubkey = c.get('pubkey')

  if (await isRateLimited(c, `geocoding:geocode:${pubkey}`, 20)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c)
    const result = await adapter.geocode(body.address.trim())
    return c.json(result ?? { error: 'No results found' }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Geocoding failed'
    return c.json({ error: message }, 502)
  }
})

// ── POST /reverse — Reverse geocode ──

const reverseRoute = createRoute({
  method: 'post',
  path: '/reverse',
  tags: ['Geocoding'],
  summary: 'Reverse geocode coordinates',
  middleware: [requirePermission('notes:create')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            lat: z.number(),
            lon: z.number(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Reverse geocode result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Invalid coordinates',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limit exceeded',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    502: {
      description: 'Geocoding failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

geocoding.openapi(reverseRoute, async (c) => {
  const body = c.req.valid('json')
  if (typeof body.lat !== 'number' || typeof body.lon !== 'number') {
    return c.json({ error: 'lat and lon numbers required' }, 400)
  }
  if (body.lat < -90 || body.lat > 90 || body.lon < -180 || body.lon > 180) {
    return c.json({ error: 'Invalid coordinates' }, 400)
  }
  const pubkey = c.get('pubkey')

  if (await isRateLimited(c, `geocoding:reverse:${pubkey}`, 20)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  try {
    const { adapter } = await getAdapter(c)
    const result = await adapter.reverse(body.lat, body.lon)
    return c.json(result ?? { error: 'No results found' }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Geocoding failed'
    return c.json({ error: message }, 502)
  }
})

// ── GET /settings — Admin geocoding config ──

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/settings',
  tags: ['Geocoding'],
  summary: 'Get geocoding settings (admin)',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Geocoding configuration',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

geocoding.openapi(getSettingsRoute, async (c) => {
  const config = await c.get('services').settings.getGeocodingConfig()
  return c.json(config, 200)
})

// ── PATCH /settings — Update geocoding config ──

const updateSettingsRoute = createRoute({
  method: 'patch',
  path: '/settings',
  tags: ['Geocoding'],
  summary: 'Update geocoding settings (admin)',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({}).passthrough() },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated geocoding configuration',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

geocoding.openapi(updateSettingsRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await c.get('services').settings.updateGeocodingConfig(body)
  await c.get('services').records.addAuditEntry('global', 'geocodingConfigUpdated', pubkey, {
    provider: (body as { provider?: string }).provider,
  })
  return c.json(updated, 200)
})

// ── GET /test — Test geocoding configuration ──

const testRoute = createRoute({
  method: 'get',
  path: '/test',
  tags: ['Geocoding'],
  summary: 'Test geocoding configuration',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Test result',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            latency: z.number(),
            error: z.string().optional(),
          }),
        },
      },
    },
  },
})

geocoding.openapi(testRoute, async (c) => {
  try {
    const start = Date.now()
    const { adapter, config } = await getAdapter(c)

    if (!config.enabled || !config.provider || !config.apiKey) {
      return c.json({ ok: false, latency: 0, error: 'Geocoding not configured' }, 200)
    }

    const timeout = setTimeout(() => {}, 5000)
    try {
      const result = await adapter.geocode('London, UK')
      clearTimeout(timeout)
      const latency = Date.now() - start
      return c.json({ ok: !!result, latency }, 200)
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Test failed'
    return c.json({ ok: false, latency: 0, error: message }, 200)
  }
})

// ── GET /config — Public geocoding config (no apiKey) ──

const publicConfigRoute = createRoute({
  method: 'get',
  path: '/config',
  tags: ['Geocoding'],
  summary: 'Get public geocoding config',
  responses: {
    200: {
      description: 'Public geocoding configuration (no API key)',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

geocoding.openapi(publicConfigRoute, async (c) => {
  const full = await c.get('services').settings.getGeocodingConfig()
  // Strip apiKey for public response
  const { apiKey: _, ...publicConfig } = full
  return c.json({ ...publicConfig }, 200)
})

export default geocoding
