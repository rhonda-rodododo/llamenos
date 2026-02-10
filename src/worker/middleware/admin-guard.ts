import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

export const adminGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('isAdmin')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})
