import { createRoute, z } from '@hono/zod-openapi'
import type { Hub } from '../../shared/types'
import { BUILD_COMMIT, BUILD_TIME, BUILD_VERSION } from '../lib/build-constants'
import { deriveServerKeypair } from '../lib/nostr-publisher'
import { createRouter } from '../lib/openapi'

const config = createRouter()

// ── GET / — Public config for the client app ──

const getConfigRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Config'],
  summary: 'Get public app configuration',
  responses: {
    200: {
      description: 'App configuration',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

config.openapi(getConfigRoute, async (c) => {
  // Prevent browser from caching config — setup state must always be fresh
  c.header('Cache-Control', 'no-store')
  const services = c.get('services')

  // Fetch enabled channels to include in config
  const channels = await services.settings.getEnabledChannels()

  // Get phone number from telephony provider config or env
  let hotlineNumber = c.env.TWILIO_PHONE_NUMBER || ''
  try {
    const prov = await services.settings.getTelephonyProvider()
    if (prov?.phoneNumber) hotlineNumber = prov.phoneNumber
  } catch {
    /* ignore */
  }

  // Fetch setup state
  let setupCompleted = true
  let demoMode = false
  const envDemoMode = c.env.DEMO_MODE === 'true'
  try {
    const setupState = await services.settings.getSetupState()
    setupCompleted = setupState.setupCompleted
    demoMode =
      envDemoMode || ((setupState as typeof setupState & { demoMode?: boolean }).demoMode ?? false)
  } catch {
    // If env var forces demo mode, still set it even on fetch failure
    demoMode = envDemoMode
  }

  // Check if bootstrap is needed (no admin exists)
  let needsBootstrap = false
  try {
    needsBootstrap = !(await services.identity.hasAdmin())
  } catch {
    /* default to false */
  }

  // Fetch active hubs
  let hubs: Hub[] = []
  let defaultHubId: string | undefined
  try {
    const allHubs = await services.settings.getHubs()
    hubs = allHubs.filter((h) => h.status === 'active')
    if (hubs.length === 1) {
      defaultHubId = hubs[0].id
    }
  } catch {
    /* default to empty */
  }

  // Derive server Nostr pubkey for client event verification (Epic 76.1)
  // NOTE: serverEventKeyHex moved to authenticated /api/auth/me endpoint (Epic 258 C2)
  const serverNostrPubkey = c.env.SERVER_NOSTR_SECRET
    ? deriveServerKeypair(c.env.SERVER_NOSTR_SECRET).pubkey
    : undefined

  // Client-facing relay URL:
  // - Explicit env var takes priority (any deployment)
  // - /nostr fallback only for self-hosted (NOSTR_RELAY_URL set = strfry behind Caddy)
  // - CF deployments use NOSFLARE service binding (server-side only, no client WebSocket)
  const nostrRelayUrl =
    c.env.NOSTR_RELAY_PUBLIC_URL || (c.env.NOSTR_RELAY_URL ? '/nostr' : undefined)

  return c.json(
    {
      hotlineName: c.env.HOTLINE_NAME || 'Hotline',
      hotlineNumber,
      channels,
      setupCompleted,
      demoMode,
      demoResetSchedule: envDemoMode ? c.env.DEMO_RESET_CRON || null : null,
      needsBootstrap,
      hubs,
      defaultHubId: defaultHubId ?? null,
      serverNostrPubkey: serverNostrPubkey ?? null,
      nostrRelayUrl: nostrRelayUrl ?? null,
    },
    200
  )
})

// ── GET /verify — Build verification endpoint (Epic 79: Reproducible Builds) ──

const verifyRoute = createRoute({
  method: 'get',
  path: '/verify',
  tags: ['Config'],
  summary: 'Get build verification info',
  responses: {
    200: {
      description: 'Build verification details',
      content: {
        'application/json': {
          schema: z.object({
            version: z.string(),
            commit: z.string(),
            buildTime: z.string(),
            verificationUrl: z.string(),
            trustAnchor: z.string(),
          }),
        },
      },
    },
  },
})

config.openapi(verifyRoute, (c) => {
  return c.json(
    {
      version: BUILD_VERSION,
      commit: BUILD_COMMIT,
      buildTime: BUILD_TIME,
      verificationUrl: 'https://github.com/rhonda-rodododo/llamenos/releases',
      trustAnchor: 'GitHub Release checksums + SLSA provenance',
    },
    200
  )
})

export default config
