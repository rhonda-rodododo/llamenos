import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

/**
 * Tier 4 PR-A: API-host CSP (production).
 *
 * The server is API-only — it never serves HTML. The CSP is defense in depth
 * against MIME confusion: if an attacker tricks a browser into rendering a
 * JSON response as HTML, `script-src 'none'` ensures nothing can execute.
 * Every active-content directive is explicitly denied. The only CSP concession
 * is `report-uri /api/csp-report` so the existing reporter keeps working.
 */
export function buildApiCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    'report-uri /api/csp-report',
    'report-to csp-endpoint',
  ].join('; ')
}

/**
 * SPA-friendly CSP for dev/test mode. Uses nonce-based script-src when
 * available (from csp-nonce middleware), with inline styles allowed for
 * Tailwind's JIT engine.
 */
function buildDevCsp(host: string, nonce: string | undefined, relayWsOrigin: string): string {
  const nonceDirective = nonce ? ` 'nonce-${nonce}' 'strict-dynamic'` : ''
  const isHttps = host.startsWith('https')
  const upgrade = isHttps ? ' upgrade-insecure-requests;' : ''
  return [
    "default-src 'self'",
    `script-src 'self'${nonceDirective}`,
    `style-src 'self' 'nonce-${nonce ?? ''}' 'unsafe-inline'`,
    "style-src-attr 'unsafe-inline'",
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
    upgrade,
  ]
    .filter(Boolean)
    .join('; ')
}

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()

  const isDev = process.env.ENVIRONMENT === 'development'

  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header(
    'Permissions-Policy',
    isDev
      ? 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), magnetometer=(), accelerometer=(), gyroscope=(), picture-in-picture=()'
      : 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), magnetometer=(), accelerometer=(), gyroscope=(), picture-in-picture=()'
  )
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Embedder-Policy', 'require-corp')
  // Tier 4 PR-A: API host must be fetchable cross-origin from app.* — CORP
  // `cross-origin` is needed in production. In dev (same-origin), either works.
  c.header('Cross-Origin-Resource-Policy', isDev ? 'same-origin' : 'cross-origin')
  c.header('X-Permitted-Cross-Domain-Policies', 'none')

  // Fail-closed default: enforce the locked-down CSP unless explicitly
  // downgraded to report-only via CSP_MODE=report-only. An API host that
  // silently ships report-only in production is indistinguishable from no
  // CSP at all for browsers that honour the header — MIME-confused script
  // execution would be caught AFTER it runs, which defeats the purpose.
  // Fail-closed: enforce CSP by default, opt-in to report-only via env var
  const cspMode =
    process.env.CSP_MODE === 'report-only'
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy'

  if (isDev) {
    const host = new URL(c.req.url).host
    // biome-ignore lint/suspicious/noExplicitAny: CSP nonce set by csp-nonce middleware
    const nonce = (c as any).get?.('cspNonce') as string | undefined
    let relayWsOrigin = ''
    const relayPublicUrl = c.env.NOSTR_RELAY_PUBLIC_URL
    if (relayPublicUrl) {
      try {
        const parsed = new URL(relayPublicUrl)
        if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
          relayWsOrigin = ` ${parsed.protocol}//${parsed.host}`
        }
      } catch {
        // Malformed URL — skip
      }
    }
    c.header(cspMode, buildDevCsp(host, nonce, relayWsOrigin))
  } else {
    c.header(cspMode, buildApiCsp())
  }

  c.header(
    'Report-To',
    JSON.stringify({
      group: 'csp-endpoint',
      max_age: 10886400,
      endpoints: [{ url: '/api/csp-report' }],
    })
  )
})
