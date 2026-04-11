import { randomUUID } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { runWithLogContext } from '../lib/log-context'

/**
 * Populates AsyncLocalStorage with per-request log context so every
 * `createLogger(...).info(...)` call inside the request chain auto-attaches
 * { reqId, traceId }. Auth middleware layers userId; hub middleware layers hubId.
 *
 * Must be mounted first, before any routes or other middleware that log.
 */
export const logContextMiddleware = createMiddleware(async (c, next) => {
  const reqId = randomUUID()
  const traceParent = c.req.header('traceparent')
  const traceId = traceParent?.split('-')[1] ?? reqId
  await runWithLogContext({ reqId, traceId }, async () => {
    await next()
  })
})
