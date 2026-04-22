import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../types'

/**
 * Create an OpenAPIHono instance with the standard validation error hook.
 * All route files should use this instead of `new OpenAPIHono<AppEnv>()` directly
 * so that zod validation failures return 400 with structured error messages
 * instead of throwing unhandled errors.
 */
import type { Env } from 'hono'

export function createRouter<T extends Env = AppEnv>() {
  return new OpenAPIHono<T>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        return c.json({ error: `Validation failed: ${issues.join('; ')}` }, 400)
      }
    },
  })
}
