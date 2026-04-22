import { createRoute, z } from '@hono/zod-openapi'
import type { NumberSearchQuery, TelephonyProviderType } from '@shared/types'
import { createRouter } from '../lib/openapi'
import { requirePermission } from '../middleware/permission-guard'
import { OAuthStateError, ProviderApiError, ProviderSetup } from '../provider-setup/index'
import { TELEPHONY_CAPABILITIES } from '../telephony/capabilities'

const providerSetup = createRouter()

// --- Error handling helper ---
function formatProviderError(err: unknown): {
  error: string
  message?: string
  providerStatus?: number
} {
  if (err instanceof OAuthStateError) {
    return { error: 'invalid_state', message: err.message }
  }
  if (err instanceof ProviderApiError) {
    return { error: err.message, providerStatus: err.statusCode }
  }
  return { error: err instanceof Error ? err.message : 'Unknown error' }
}

function getProviderErrorStatus(err: unknown): 400 | 500 {
  if (err instanceof OAuthStateError || err instanceof ProviderApiError) return 400
  return 500
}

// ── POST /validate — Validate provider credentials ──

const validateRoute = createRoute({
  method: 'post',
  path: '/validate',
  tags: ['Provider Setup'],
  summary: 'Validate telephony provider credentials',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ provider: z.string() }).passthrough() },
      },
    },
  },
  responses: {
    200: {
      description: 'Validation result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Invalid credentials or unknown provider',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(validateRoute, async (c) => {
  const body = c.req.valid('json')
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)

  const credentials = (body as Record<string, unknown>).credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  const result = await capabilities.testConnection(parsed.data)
  return c.json(result, 200)
})

// ── POST /webhooks — Get webhook URLs ──

const postWebhooksRoute = createRoute({
  method: 'post',
  path: '/webhooks',
  tags: ['Provider Setup'],
  summary: 'Get webhook URLs for provider',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            provider: z.string(),
            baseUrl: z.string().optional(),
            hubId: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Webhook URLs',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Unknown provider',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

providerSetup.openapi(postWebhooksRoute, async (c) => {
  const body = c.req.valid('json')
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  const baseUrl = body.baseUrl || c.env.APP_URL || new URL(c.req.url).origin
  return c.json(capabilities.getWebhookUrls(baseUrl, body.hubId), 200)
})

// ── GET /webhooks — Get webhook URLs (frontend calls without body) ──

const getWebhooksRoute = createRoute({
  method: 'get',
  path: '/webhooks',
  tags: ['Provider Setup'],
  summary: 'Get webhook URLs for current provider',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Webhook URLs',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Unknown provider',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

providerSetup.openapi(getWebhooksRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId')
  const config = await services.settings.getTelephonyProvider(hubId ?? undefined)
  const provider = (config?.type ?? 'twilio') as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${provider}` }, 400)
  const baseUrl = c.env.APP_URL || new URL(c.req.url).origin
  return c.json(capabilities.getWebhookUrls(baseUrl, hubId ?? undefined), 200)
})

// ── POST /phone-numbers — List owned phone numbers ──

const listPhoneNumbersRoute = createRoute({
  method: 'post',
  path: '/phone-numbers',
  tags: ['Provider Setup'],
  summary: 'List owned phone numbers',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ provider: z.string() }).passthrough() },
      },
    },
  },
  responses: {
    200: {
      description: 'Owned phone numbers',
      content: {
        'application/json': {
          schema: z.object({ numbers: z.array(z.object({}).passthrough()) }),
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(listPhoneNumbersRoute, async (c) => {
  const body = c.req.valid('json')
  const provider = (body as Record<string, unknown>).provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${provider}` }, 400)
  if (!capabilities.listOwnedNumbers)
    return c.json({ error: 'Provider does not support number listing' }, 400)

  const credentials = (body as Record<string, unknown>).credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  const numbers = await capabilities.listOwnedNumbers(parsed.data)
  return c.json({ numbers }, 200)
})

// ── POST /phone-numbers/search — Search available phone numbers ──

const searchPhoneNumbersRoute = createRoute({
  method: 'post',
  path: '/phone-numbers/search',
  tags: ['Provider Setup'],
  summary: 'Search available phone numbers',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ provider: z.string() }).passthrough() },
      },
    },
  },
  responses: {
    200: {
      description: 'Available phone numbers',
      content: {
        'application/json': {
          schema: z.object({ numbers: z.array(z.object({}).passthrough()) }),
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(searchPhoneNumbersRoute, async (c) => {
  const body = c.req.valid('json') as Record<string, unknown>
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.searchAvailableNumbers)
    return c.json({ error: 'Provider does not support number search' }, 400)

  const credentials = body.credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  // Frontend may send query fields at top level or nested
  const query: NumberSearchQuery = (body.query as NumberSearchQuery) ?? {
    country: (body.country as string) ?? 'US',
    areaCode: body.areaCode as string | undefined,
    contains: body.contains as string | undefined,
  }
  const numbers = await capabilities.searchAvailableNumbers(parsed.data, query)
  return c.json({ numbers }, 200)
})

// ── POST /phone-numbers/provision — Provision a phone number ──

const provisionNumberRoute = createRoute({
  method: 'post',
  path: '/phone-numbers/provision',
  tags: ['Provider Setup'],
  summary: 'Provision a phone number',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({ provider: z.string(), phoneNumber: z.string().optional() })
            .passthrough(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Provisioning result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(provisionNumberRoute, async (c) => {
  const body = c.req.valid('json') as Record<string, unknown>
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.provisionNumber)
    return c.json({ error: 'Provider does not support number provisioning' }, 400)

  const credentials = body.credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  const phoneNumber = (body.phoneNumber as string) || (body.number as string)
  if (!phoneNumber) return c.json({ error: 'phoneNumber is required' }, 400)

  const result = await capabilities.provisionNumber(parsed.data, phoneNumber)
  return c.json(result, 200)
})

// ── POST /configure-webhooks — Auto-configure webhooks on provider ──

const configureWebhooksRoute = createRoute({
  method: 'post',
  path: '/configure-webhooks',
  tags: ['Provider Setup'],
  summary: 'Auto-configure webhooks on provider',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ provider: z.string(), phoneNumber: z.string() }).passthrough(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Configuration result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(configureWebhooksRoute, async (c) => {
  const body = c.req.valid('json') as Record<string, unknown>
  const provider = body.provider as TelephonyProviderType
  const capabilities = TELEPHONY_CAPABILITIES[provider]
  if (!capabilities) return c.json({ error: `Unknown provider: ${body.provider}` }, 400)
  if (!capabilities.configureWebhooks)
    return c.json({ error: 'Provider does not support webhook auto-config' }, 400)

  const credentials = body.credentials ?? body
  const parsed = capabilities.credentialSchema.safeParse(credentials)
  if (!parsed.success) return c.json({ error: 'Invalid credentials', details: parsed.error }, 400)

  const webhookUrls = capabilities.getWebhookUrls(
    c.env.APP_URL || new URL(c.req.url).origin,
    c.get('hubId') ?? undefined
  )
  const result = await capabilities.configureWebhooks(
    parsed.data,
    body.phoneNumber as string,
    webhookUrls
  )
  return c.json(result, 200)
})

// ── GET /status — Provider status ──

const providerStatusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Provider Setup'],
  summary: 'Get provider connection status',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'Provider status',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

providerSetup.openapi(providerStatusRoute, async (c) => {
  const services = c.get('services')
  const config = await services.settings.getProviderConfig()
  return c.json(config ?? { connected: false }, 200)
})

// --- OAuth routes (delegate to ProviderSetup class) ---

// ── POST /oauth/start ──

const oauthStartRoute = createRoute({
  method: 'post',
  path: '/oauth/start',
  tags: ['Provider Setup'],
  summary: 'Start OAuth flow',
  middleware: [requirePermission('settings:manage')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ provider: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'OAuth start result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'OAuth not supported for provider',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
    500: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(oauthStartRoute, async (c) => {
  try {
    const body = c.req.valid('json')
    const provider = body.provider as 'twilio' | 'telnyx'
    if (provider !== 'twilio' && provider !== 'telnyx') {
      return c.json({ error: `OAuth not supported for provider: ${body.provider}` }, 400)
    }
    const setup = new ProviderSetup(c.get('services').settings, c.get('services').crypto, c.env)
    const result = await setup.oauthStart(provider)
    return c.json(result, 200)
  } catch (err) {
    return c.json(formatProviderError(err), getProviderErrorStatus(err))
  }
})

// ── GET /oauth/callback — OAuth callback (redirects) ──
// Standard Hono route — returns redirects, not JSON

providerSetup.get('/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const provider = c.req.query('provider') as 'twilio' | 'telnyx' | undefined

  if (!code || !state) {
    return c.redirect('/admin/setup?status=error&message=missing_params')
  }

  try {
    const setup = new ProviderSetup(c.get('services').settings, c.get('services').crypto, c.env)
    const oauthProvider = provider ?? 'twilio'
    await setup.oauthCallback(oauthProvider, code, state)
    return c.redirect(`/admin/setup?provider=${oauthProvider}&status=success`)
  } catch (err) {
    const message = err instanceof Error ? encodeURIComponent(err.message) : 'unknown'
    return c.redirect(`/admin/setup?status=error&message=${message}`)
  }
})

// ── GET /oauth/status/{stateToken} — OAuth status check ──

const oauthStatusRoute = createRoute({
  method: 'get',
  path: '/oauth/status/{stateToken}',
  tags: ['Provider Setup'],
  summary: 'Check OAuth status',
  middleware: [requirePermission('settings:manage')],
  request: {
    params: z.object({
      stateToken: z.string().openapi({ param: { name: 'stateToken', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      description: 'OAuth status',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
    500: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(oauthStatusRoute, async (c) => {
  try {
    const services = c.get('services')
    const config = await services.settings.getProviderConfig()
    if (config?.connected) {
      return c.json(
        {
          provider: config.provider,
          status: 'connected' as const,
          connectedAt: new Date().toISOString(),
        },
        200
      )
    }
    return c.json({ provider: 'unknown', status: 'pending' as const }, 200)
  } catch (err) {
    return c.json(formatProviderError(err), getProviderErrorStatus(err))
  }
})

// --- A2P routes (Twilio only, delegate to ProviderSetup class) ---

// ── POST /a2p/brand ──

const a2pBrandRoute = createRoute({
  method: 'post',
  path: '/a2p/brand',
  tags: ['Provider Setup'],
  summary: 'Submit A2P brand registration',
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
      description: 'Brand submission result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
    500: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(a2pBrandRoute, async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.get('services').crypto, c.env)
    const body = c.req.valid('json') as Record<string, string>
    const result = await setup.submitA2pBrand(body)
    return c.json(result, 200)
  } catch (err) {
    return c.json(formatProviderError(err), getProviderErrorStatus(err))
  }
})

// ── GET /a2p/status ──

const a2pStatusRoute = createRoute({
  method: 'get',
  path: '/a2p/status',
  tags: ['Provider Setup'],
  summary: 'Get A2P registration status',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'A2P status',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
    500: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(a2pStatusRoute, async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.get('services').crypto, c.env)
    const result = await setup.getA2pStatus()
    return c.json(result, 200)
  } catch (err) {
    return c.json(formatProviderError(err), getProviderErrorStatus(err))
  }
})

// ── POST /a2p/campaign ──

const a2pCampaignRoute = createRoute({
  method: 'post',
  path: '/a2p/campaign',
  tags: ['Provider Setup'],
  summary: 'Submit A2P campaign',
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
      description: 'Campaign submission result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
    500: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(a2pCampaignRoute, async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.get('services').crypto, c.env)
    const body = c.req.valid('json') as Record<string, unknown>
    const result = await setup.submitA2pCampaign(body)
    return c.json(result, 200)
  } catch (err) {
    return c.json(formatProviderError(err), getProviderErrorStatus(err))
  }
})

// ── POST /a2p/skip ──

const a2pSkipRoute = createRoute({
  method: 'post',
  path: '/a2p/skip',
  tags: ['Provider Setup'],
  summary: 'Skip A2P registration',
  middleware: [requirePermission('settings:manage')],
  responses: {
    200: {
      description: 'A2P skipped',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
    500: {
      description: 'Provider error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
  },
})

providerSetup.openapi(a2pSkipRoute, async (c) => {
  try {
    const setup = new ProviderSetup(c.get('services').settings, c.get('services').crypto, c.env)
    await setup.skipA2p()
    return c.json({ ok: true }, 200)
  } catch (err) {
    return c.json(formatProviderError(err), getProviderErrorStatus(err))
  }
})

export default providerSetup
