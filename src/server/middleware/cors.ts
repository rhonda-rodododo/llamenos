import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

/**
 * Tier 4 PR-A: single-origin CORS.
 *
 * The API host (`api.<parent>`) only accepts cross-site requests from the
 * configured SPA origin (`app.<parent>`). Everything else gets no CORS headers
 * — the browser refuses the request.
 *
 * Allowed origins come from two sources:
 *   1. `APP_ORIGIN` env var (production) — the single canonical SPA origin.
 *   2. `CORS_ALLOWED_ORIGINS` env var (optional, comma-separated) — extra
 *      origins for staging/preview. Wildcard `*` is NEVER permitted because
 *      we always send cookies with `credentials: 'include'` and the CORS spec
 *      forbids `Access-Control-Allow-Origin: *` when credentials are enabled.
 *   3. Dev fallback — `http://localhost:5173` only when `ENVIRONMENT=development`.
 */
function buildAllowedOrigins(env: {
  ENVIRONMENT?: string
  CORS_ALLOWED_ORIGINS?: string
}): Set<string> {
  const allowed = new Set<string>()
  if (process.env.APP_ORIGIN) allowed.add(process.env.APP_ORIGIN)
  if (env.CORS_ALLOWED_ORIGINS) {
    for (const raw of env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim())) {
      if (!raw) continue
      if (raw === '*') {
        throw new Error(
          'CORS_ALLOWED_ORIGINS must not contain "*" — credentialed CORS forbids wildcards'
        )
      }
      allowed.add(raw)
    }
  }
  if (env.ENVIRONMENT === 'development') {
    allowed.add('http://localhost:5173')
    allowed.add('http://localhost:1420')
  }
  return allowed
}

export const cors = createMiddleware<AppEnv>(async (c, next) => {
  const requestOrigin = c.req.header('Origin') || ''
  const allowed = buildAllowedOrigins(c.env)
  const allowedOrigin = allowed.has(requestOrigin) ? requestOrigin : ''

  if (c.req.method === 'OPTIONS') {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    }
    if (allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = allowedOrigin
      headers['Access-Control-Allow-Credentials'] = 'true'
    }
    return new Response(null, { headers })
  }

  await next()

  if (allowedOrigin) {
    c.header('Access-Control-Allow-Origin', allowedOrigin)
    c.header('Access-Control-Allow-Credentials', 'true')
  }
  c.header('Vary', 'Origin')
})
