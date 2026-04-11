import type { Context } from 'hono'
import { AppError } from '../lib/errors'
import { createLogger } from '../lib/logger'

const log = createLogger('middleware.error')

export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.status)
  }
  log.error('Unhandled error', err)
  return c.json({ error: 'Internal server error' }, 500)
}
