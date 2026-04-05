import type { LogExtra } from '@shared/logger-types'
import { getLogContext } from './log-context'
import { type LogLevel, type RateLimits, createRateLimiter } from './log-rate-limiter'
import { redact } from './log-redactor'

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

interface LoggerConfig {
  minLevel: LogLevel
  namespaces: string[] // globs; ['*'] = all
  rateLimits: Required<RateLimits>
  stripStacks: boolean
}

function parseRateLimits(env: string | undefined): Required<RateLimits> {
  const defaults: Required<RateLimits> = {
    debug: 50,
    info: 200,
    warn: 500,
    error: Number.POSITIVE_INFINITY,
  }
  if (!env) return defaults
  try {
    const parsed = JSON.parse(env) as Partial<RateLimits>
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

function loadConfig(): LoggerConfig {
  const minLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'
  const namespaces = (process.env.LOG_NAMESPACES || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    minLevel: LEVEL_PRIORITY[minLevel] !== undefined ? minLevel : 'info',
    namespaces: namespaces.length ? namespaces : ['*'],
    rateLimits: parseRateLimits(process.env.LOG_RATE_LIMITS),
    stripStacks: process.env.LOG_STACKS !== 'true',
  }
}

let config: LoggerConfig = loadConfig()
let rateLimiter = createRateLimiter(config.rateLimits)

// Exposed for tests only — do not use in app code.
export function _setLoggerConfigForTests(next: LoggerConfig): void {
  config = next
  rateLimiter = createRateLimiter(next.rateLimits)
}

function globMatches(namespace: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return namespace === prefix || namespace.startsWith(`${prefix}.`)
  }
  return namespace === pattern
}

function namespaceAllowed(ns: string): boolean {
  return config.namespaces.some((p) => globMatches(ns, p))
}

function levelAllowed(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[config.minLevel]
}

function circularReplacer() {
  const seen = new WeakSet<object>()
  return (_: string, value: unknown) => {
    if (value !== null && typeof value === 'object') {
      if (seen.has(value as object)) return '[circular]'
      seen.add(value as object)
    }
    return value
  }
}

function emit(entry: Record<string, unknown>, level: LogLevel): void {
  try {
    const line = `${JSON.stringify(entry, circularReplacer())}\n`
    if (level === 'error') process.stderr.write(line)
    else process.stdout.write(line)
  } catch {
    // Last-ditch: logger must never throw.
    process.stderr.write(`{"level":"error","component":"logger","msg":"emit failed"}\n`)
  }
}

function unwrapError(err: unknown, stripStacks: boolean): Record<string, unknown> {
  if (err instanceof Error) {
    const base: Record<string, unknown> = { errName: err.name, errMsg: err.message }
    if (!stripStacks) base.stack = err.stack
    return base
  }
  return { errMsg: String(err) }
}

export interface Logger {
  debug(msg: string, extra?: LogExtra): void
  info(msg: string, extra?: LogExtra): void
  warn(msg: string, extra?: LogExtra): void
  error(msg: string, err?: unknown, extra?: LogExtra): void
}

/** Create a namespaced structured logger. Namespaces are dot-separated (e.g. `telephony.twilio`). */
export function createLogger(namespace: string): Logger {
  function write(level: LogLevel, msg: string, extra?: LogExtra): void {
    if (!levelAllowed(level)) return
    if (!namespaceAllowed(namespace)) return
    if (!rateLimiter.check(namespace, level)) return

    const ctx = getLogContext()
    const redactedExtra = extra ? redact(extra) : {}
    const entry = {
      level,
      ts: new Date().toISOString(),
      component: namespace,
      msg,
      ...ctx,
      ...redactedExtra,
    }
    emit(entry, level)
  }

  return {
    debug: (msg, extra) => write('debug', msg, extra),
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, err, extra) => {
      const merged = {
        ...(extra ?? {}),
        ...(err !== undefined ? unwrapError(err, config.stripStacks) : {}),
      }
      write('error', msg, merged as LogExtra)
    },
  }
}

// Background task: drain overflow summaries every 10s.
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  const overflowInterval = setInterval(() => {
    const summaries = rateLimiter.drainOverflows()
    for (const s of summaries) {
      emit(
        {
          level: 'warn',
          ts: new Date().toISOString(),
          component: 'logger',
          msg: `Suppressed ${s.suppressed} ${s.level} logs for ${s.namespace} in last 10s`,
        },
        'warn'
      )
    }
  }, 10_000)
  overflowInterval.unref?.()
}
