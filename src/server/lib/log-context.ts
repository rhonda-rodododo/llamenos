import { AsyncLocalStorage } from 'node:async_hooks'

export interface LogContext {
  reqId?: string
  hubId?: string
  userId?: string // hashed (first 8 hex of SHA-256(pubkey))
  traceId?: string
}

const storage = new AsyncLocalStorage<LogContext>()

/** Run `fn` with the given log context visible to all `getLogContext()` calls inside it. */
export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = storage.getStore() ?? {}
  return storage.run({ ...parent, ...ctx }, fn)
}

/** Returns the current log context, or `{}` if none is active. */
export function getLogContext(): LogContext {
  return storage.getStore() ?? {}
}
