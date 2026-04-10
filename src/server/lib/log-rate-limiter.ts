export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RateLimits {
  debug?: number
  info?: number
  warn?: number
  error?: number
}

interface Bucket {
  tokens: number
  windowStart: number
  suppressed: number
}

export interface OverflowSummary {
  namespace: string
  level: LogLevel
  suppressed: number
}

export interface RateLimiter {
  check(namespace: string, level: LogLevel): boolean
  drainOverflows(): OverflowSummary[]
}

/**
 * Per-`{namespace, level}` token bucket with 1-second windows.
 * Returns `false` when the bucket is empty; overflow is counted and
 * reported via `drainOverflows()` as a single summary per bucket.
 */
export function createRateLimiter(
  limits: Required<RateLimits>,
  clock: () => number = Date.now
): RateLimiter {
  const buckets = new Map<string, Bucket>()

  function key(ns: string, level: LogLevel) {
    return `${ns}|${level}`
  }

  function getBucket(ns: string, level: LogLevel): Bucket {
    const k = key(ns, level)
    let b = buckets.get(k)
    const now = clock()
    if (!b) {
      b = { tokens: limits[level], windowStart: now, suppressed: 0 }
      buckets.set(k, b)
    } else if (now - b.windowStart >= 1000) {
      b.tokens = limits[level]
      b.windowStart = now
    }
    return b
  }

  return {
    check(namespace, level) {
      const b = getBucket(namespace, level)
      if (b.tokens === Number.POSITIVE_INFINITY) return true
      if (b.tokens > 0) {
        b.tokens -= 1
        return true
      }
      b.suppressed += 1
      return false
    },
    drainOverflows() {
      const out: OverflowSummary[] = []
      for (const [k, b] of buckets) {
        if (b.suppressed > 0) {
          const [namespace, level] = k.split('|') as [string, LogLevel]
          out.push({ namespace, level, suppressed: b.suppressed })
          b.suppressed = 0
        }
      }
      return out
    },
  }
}
