import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

/**
 * Tier 4 PR-A: API-host CSP.
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

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()

  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), magnetometer=(), accelerometer=(), gyroscope=(), picture-in-picture=()'
  )
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Embedder-Policy', 'require-corp')
  // Tier 4 PR-A: API host must be fetchable cross-origin from app.* — CORP
  // `same-origin` would block the SPA's credentialed XHR.
  c.header('Cross-Origin-Resource-Policy', 'cross-origin')
  c.header('X-Permitted-Cross-Domain-Policies', 'none')

  const cspMode =
    process.env.CSP_MODE === 'enforcing'
      ? 'Content-Security-Policy'
      : 'Content-Security-Policy-Report-Only'
  c.header(cspMode, buildApiCsp())

  c.header(
    'Report-To',
    JSON.stringify({
      group: 'csp-endpoint',
      max_age: 10886400,
      endpoints: [{ url: '/api/csp-report' }],
    })
  )
})
