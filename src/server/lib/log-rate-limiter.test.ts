import { beforeEach, describe, expect, test } from 'bun:test'
import { createRateLimiter } from './log-rate-limiter'

describe('log rate limiter', () => {
  let now = 0
  const clock = () => now
  beforeEach(() => {
    now = 1_000_000
  })

  test('allows logs under the limit', () => {
    const rl = createRateLimiter({ debug: 10, info: 10, warn: 10, error: 10 }, clock)
    for (let i = 0; i < 10; i++) expect(rl.check('telephony.twilio', 'info')).toBe(true)
  })

  test('drops logs over the limit within the same second', () => {
    const rl = createRateLimiter({ debug: 3, info: 3, warn: 3, error: 3 }, clock)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(false)
  })

  test('refills bucket after a second elapses', () => {
    const rl = createRateLimiter({ debug: 2, info: 2, warn: 2, error: 2 }, clock)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(true)
    expect(rl.check('ns', 'info')).toBe(false)
    now += 1000
    expect(rl.check('ns', 'info')).toBe(true)
  })

  test('separate buckets per namespace and level', () => {
    const rl = createRateLimiter({ debug: 1, info: 1, warn: 1, error: 1 }, clock)
    expect(rl.check('a', 'info')).toBe(true)
    expect(rl.check('a', 'info')).toBe(false)
    expect(rl.check('b', 'info')).toBe(true)
    expect(rl.check('a', 'warn')).toBe(true)
  })

  test('drainOverflows returns suppression summaries and resets', () => {
    const rl = createRateLimiter({ debug: 1, info: 1, warn: 1, error: 1 }, clock)
    rl.check('ns', 'info') // allowed
    rl.check('ns', 'info') // dropped
    rl.check('ns', 'info') // dropped
    const summaries = rl.drainOverflows()
    expect(summaries).toEqual([{ namespace: 'ns', level: 'info', suppressed: 2 }])
    expect(rl.drainOverflows()).toEqual([])
  })

  test('error level has no limit (bucket of Infinity)', () => {
    const rl = createRateLimiter(
      { debug: 1, info: 1, warn: 1, error: Number.POSITIVE_INFINITY },
      clock
    )
    for (let i = 0; i < 10_000; i++) expect(rl.check('ns', 'error')).toBe(true)
  })
})
