import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

function buildCsp(nonce: string, host: string, relayWsOrigin: string, isHttps: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' wss://${host}${relayWsOrigin}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "require-trusted-types-for 'script'",
    'trusted-types llamenos default',
    'report-uri /api/csp-report',
    'report-to csp-endpoint',
  ]
  if (isHttps) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()

  const host = new URL(c.req.url).host
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

  const isHttps = c.req.url.startsWith('https://')
  const nonce = c.get('cspNonce') ?? ''

  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header(
    'Permissions-Policy',
    'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), magnetometer=(), accelerometer=(), gyroscope=(), picture-in-picture=()'
  )
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Embedder-Policy', 'require-corp')
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
  c.header('X-Permitted-Cross-Domain-Policies', 'none')

  const cspMode =
    process.env.CSP_MODE === 'enforcing'
      ? 'Content-Security-Policy'
      : 'Content-Security-Policy-Report-Only'
  c.header(cspMode, buildCsp(nonce, host, relayWsOrigin, isHttps))

  c.header(
    'Report-To',
    JSON.stringify({
      group: 'csp-endpoint',
      max_age: 10886400,
      endpoints: [{ url: '/api/csp-report' }],
    })
  )
})
