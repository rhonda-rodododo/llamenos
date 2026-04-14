import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

export const cspNonce = createMiddleware<AppEnv>(async (c, next) => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  c.set('cspNonce', btoa(String.fromCharCode(...bytes)))
  await next()
})
