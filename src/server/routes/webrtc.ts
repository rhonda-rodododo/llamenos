import { createRoute, z } from '@hono/zod-openapi'
import { createLogger } from '../lib/logger'
import { createRouter } from '../lib/openapi'
import { generateWebRtcToken, isWebRtcConfigured } from '../telephony/webrtc-tokens'

const log = createLogger('routes.webrtc')

const webrtc = createRouter()

// ── GET /webrtc-token — Generate a provider-specific WebRTC access token ──

const webrtcTokenRoute = createRoute({
  method: 'get',
  path: '/webrtc-token',
  tags: ['WebRTC'],
  summary: 'Generate WebRTC access token',
  responses: {
    200: {
      description: 'WebRTC token generated',
      content: {
        'application/json': {
          schema: z.object({
            token: z.string(),
            provider: z.string(),
            identity: z.string(),
            ttl: z.number(),
          }),
        },
      },
    },
    400: {
      description: 'WebRTC not available or not configured',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    500: {
      description: 'Token generation failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

webrtc.openapi(webrtcTokenRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const user = c.get('user')

  // Check user's call preference allows browser calls
  const callPref = user.callPreference ?? 'phone'
  if (callPref === 'phone') {
    return c.json(
      { error: 'Call preference is set to phone only. Enable browser calling in settings.' },
      400
    )
  }

  // Get provider config
  const config = await services.settings.getTelephonyProvider()
  if (!config || !isWebRtcConfigured(config)) {
    return c.json(
      {
        error:
          'WebRTC is not configured for the current provider. Admin must enable it in settings.',
      },
      400
    )
  }

  try {
    // Use a sanitized identity (pubkey prefix — unique per user)
    const identity = `vol_${pubkey.slice(0, 16)}`
    const result = await generateWebRtcToken(config, identity)
    return c.json(
      { token: result.token, provider: result.provider, identity, ttl: result.ttl },
      200
    )
  } catch (err) {
    log.error('Token generation failed', err)
    return c.json({ error: 'Failed to generate WebRTC token' }, 500)
  }
})

// ── GET /webrtc-status — Check whether WebRTC is available ──

const webrtcStatusRoute = createRoute({
  method: 'get',
  path: '/webrtc-status',
  tags: ['WebRTC'],
  summary: 'Check WebRTC availability',
  responses: {
    200: {
      description: 'WebRTC status',
      content: {
        'application/json': {
          schema: z.object({
            available: z.boolean(),
            provider: z.string().nullable(),
          }),
        },
      },
    },
  },
})

webrtc.openapi(webrtcStatusRoute, async (c) => {
  const services = c.get('services')
  const config = await services.settings.getTelephonyProvider()
  return c.json(
    {
      available: isWebRtcConfigured(config),
      provider: config?.type ?? null,
    },
    200
  )
})

export default webrtc
