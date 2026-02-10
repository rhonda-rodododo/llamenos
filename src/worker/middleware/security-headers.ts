import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()

  const host = new URL(c.req.url).host
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  c.header('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://${host}; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`)
})
