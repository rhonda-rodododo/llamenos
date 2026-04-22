import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/openapi'
import { validateExternalUrl } from '../lib/ssrf-guard'
import { requirePermission } from '../middleware/permission-guard'

const setup = createRouter()

// ── GET /state — Get setup state (any authenticated user — used for redirect logic) ──

const getStateRoute = createRoute({
  method: 'get',
  path: '/state',
  tags: ['Setup'],
  summary: 'Get setup state',
  responses: {
    200: {
      description: 'Setup state',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

setup.openapi(getStateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const state = await services.settings.getSetupState(hubId ?? undefined)
  return c.json(state, 200)
})

// ── PATCH /state — Update setup state (admin only) ──

const updateStateRoute = createRoute({
  method: 'patch',
  path: '/state',
  tags: ['Setup'],
  summary: 'Update setup state',
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
      description: 'Updated setup state',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

setup.openapi(updateStateRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  const updated = await services.settings.updateSetupState(
    body as Parameters<typeof services.settings.updateSetupState>[0],
    hubId ?? undefined
  )
  await services.records.addAuditEntry(
    hubId ?? 'global',
    'setupStateUpdated',
    pubkey,
    body as Record<string, unknown>
  )
  return c.json(updated, 200)
})

// ── POST /complete — Complete setup (admin only) ──

const completeSetupRoute = createRoute({
  method: 'post',
  path: '/complete',
  tags: ['Setup'],
  summary: 'Complete setup wizard',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ demoMode: z.boolean().optional() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Setup completed',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

setup.openapi(completeSetupRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')

  // Create default hub if none exists
  try {
    const existingHubs = await services.settings.getHubs()
    if (existingHubs.length === 0) {
      const hotlineName = c.env.HOTLINE_NAME || 'Hotline'
      const newHub = await services.settings.createHub({
        id: crypto.randomUUID(),
        name: hotlineName,
        createdBy: pubkey,
      })
      // Assign admin to the default hub with all roles
      await services.identity.setHubRole({
        pubkey,
        hubId: newHub.id,
        roleIds: ['role-super-admin'],
      })
      // Generate and distribute hub key so field decryption works immediately
      const { envelopes } = services.crypto.generateAndWrapHubKey([pubkey])
      await services.settings.setHubKeyEnvelopes(newHub.id, envelopes)
    }
  } catch {
    // Non-fatal — hub creation failing shouldn't block setup completion
  }

  const updated = await services.settings.updateSetupState(
    { setupCompleted: true, demoMode: body.demoMode ?? false },
    hubId ?? undefined
  )

  await services.records.addAuditEntry(hubId ?? 'global', 'setupCompleted', pubkey, {
    demoMode: body.demoMode ?? false,
  })
  return c.json(updated, 200)
})

// ── POST /test/signal — Test Signal bridge connection ──

const testSignalRoute = createRoute({
  method: 'post',
  path: '/test/signal',
  tags: ['Setup'],
  summary: 'Test Signal bridge connection',
  middleware: [requirePermission('settings:manage-messaging')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            bridgeUrl: z.string(),
            bridgeApiKey: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Connection test result',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }).passthrough() } },
    },
    400: {
      description: 'Invalid request or connection failed',
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean(), error: z.string() }),
        },
      },
    },
  },
})

setup.openapi(testSignalRoute, async (c) => {
  const body = c.req.valid('json')

  if (!body.bridgeUrl) {
    return c.json({ ok: false, error: 'Bridge URL is required' }, 400)
  }

  const bridgeError = validateExternalUrl(body.bridgeUrl, 'Bridge URL')
  if (bridgeError) {
    return c.json({ ok: false, error: bridgeError }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const headers: Record<string, string> = {}
    if (body.bridgeApiKey) headers.Authorization = `Bearer ${body.bridgeApiKey}`

    const res = await fetch(`${body.bridgeUrl}/v1/about`, {
      headers,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (res.ok) {
      return c.json({ ok: true }, 200)
    }
    return c.json({ ok: false, error: `Bridge returned ${res.status}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return c.json({ ok: false, error: message }, 400)
  }
})

// ── POST /test/whatsapp — Test WhatsApp connection (direct Meta API) ──

const testWhatsappRoute = createRoute({
  method: 'post',
  path: '/test/whatsapp',
  tags: ['Setup'],
  summary: 'Test WhatsApp API connection',
  middleware: [requirePermission('settings:manage-messaging')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            phoneNumberId: z.string(),
            accessToken: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Connection test result',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }).passthrough() } },
    },
    400: {
      description: 'Invalid request or connection failed',
      content: {
        'application/json': {
          schema: z.object({ ok: z.boolean(), error: z.string() }),
        },
      },
    },
  },
})

setup.openapi(testWhatsappRoute, async (c) => {
  const body = c.req.valid('json')

  if (!body.phoneNumberId || !body.accessToken) {
    return c.json({ ok: false, error: 'Phone Number ID and Access Token are required' }, 400)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${encodeURIComponent(body.phoneNumberId)}`,
      {
        headers: { Authorization: `Bearer ${body.accessToken}` },
        signal: controller.signal,
      }
    )
    clearTimeout(timeout)

    if (res.ok) {
      return c.json({ ok: true }, 200)
    }
    return c.json({ ok: false, error: `WhatsApp API returned ${res.status}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return c.json({ ok: false, error: message }, 400)
  }
})

export default setup
