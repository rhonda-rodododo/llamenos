import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()

  const host = new URL(c.req.url).host
  // The client may connect to a cross-origin Nostr relay in dev (strfry on a
  // separate port) or to a same-origin path in prod (Caddy-proxied /nostr).
  // Extend connect-src to include the relay's origin when it's set and
  // cross-origin, so the browser's CSP doesn't block the WebSocket.
  let relayWsOrigin = ''
  const relayPublicUrl = c.env.NOSTR_RELAY_PUBLIC_URL
  if (relayPublicUrl) {
    try {
      const parsed = new URL(relayPublicUrl)
      if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
        relayWsOrigin = ` ${parsed.protocol}//${parsed.host}`
      }
    } catch {
      // Malformed URL — skip, client will fail to connect visibly
    }
  }
  // upgrade-insecure-requests rewrites ws:// to wss:// automatically. Only
  // emit it when we're actually on https, so localhost dev with ws:// relays
  // keeps working.
  const isHttps = c.req.url.startsWith('https://')
  const upgrade = isHttps ? ' upgrade-insecure-requests;' : ''

  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header(
    'Permissions-Policy',
    'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), magnetometer=(), accelerometer=(), gyroscope=(), picture-in-picture=()'
  )
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  // COEP require-corp enables full cross-origin isolation (SharedArrayBuffer, Spectre mitigation).
  // NOTE: This will block Google Fonts (fonts.googleapis.com / fonts.gstatic.com) which lack
  // CORP headers. Self-host fonts before enabling this in production, or remove the Google Fonts
  // <link> tags from index.html and serve fonts locally.
  c.header('Cross-Origin-Embedder-Policy', 'require-corp')
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
  c.header('X-Permitted-Cross-Domain-Policies', 'none')
  // style-src 'unsafe-inline' is required by Tailwind CSS which injects runtime styles.
  // Nonce-based CSP for styles is not feasible with Tailwind's JIT engine.
  // This weakens XSS defense-in-depth for style injection only; script-src remains strict.
  c.header(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://${host}${relayWsOrigin}; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';${upgrade}`
  )
})
