import { beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { runWithLogContext } from './log-context'
import { _setLoggerConfigForTests, createLogger } from './logger'

function captureStdout() {
  const lines: string[] = []
  const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(typeof chunk === 'string' ? chunk : String(chunk))
    return true
  })
  return { lines, restore: () => spy.mockRestore() }
}

function parseLines(lines: string[]): Record<string, unknown>[] {
  return lines.filter((l) => l.trim().length > 0).map((l) => JSON.parse(l.trim()))
}

describe('logger integration: middleware → context → logger', () => {
  beforeEach(() => {
    _setLoggerConfigForTests({
      minLevel: 'debug',
      namespaces: ['*'],
      rateLimits: { debug: 1000, info: 1000, warn: 1000, error: Number.POSITIVE_INFINITY },
      stripStacks: true,
    })
  })

  test('request-level context (reqId, traceId) propagates to nested log calls', () => {
    const cap = captureStdout()
    const log = createLogger('routes.example')

    // Simulate logContextMiddleware
    runWithLogContext({ reqId: 'req-abc-123', traceId: 'trc-xyz' }, () => {
      // Simulate a route handler making a log call
      log.info('request handled', { path: '/api/thing' })
    })

    cap.restore()
    const entries = parseLines(cap.lines)
    expect(entries).toHaveLength(1)
    expect(entries[0].reqId).toBe('req-abc-123')
    expect(entries[0].traceId).toBe('trc-xyz')
    expect(entries[0].component).toBe('routes.example')
    expect(entries[0].msg).toBe('request handled')
    expect(entries[0].path).toBe('/api/thing')
  })

  test('nested contexts (auth layers userId, hub layers hubId) compose correctly', () => {
    const cap = captureStdout()
    const log = createLogger('services.example')

    // Outer: logContextMiddleware
    runWithLogContext({ reqId: 'r1', traceId: 't1' }, () => {
      // Middle: auth middleware layers userId
      runWithLogContext({ userId: 'abc12345' }, () => {
        // Inner: hub middleware layers hubId
        runWithLogContext({ hubId: 'hub-99' }, () => {
          log.info('doing work')
        })
      })
    })

    cap.restore()
    const entries = parseLines(cap.lines)
    expect(entries[0].reqId).toBe('r1')
    expect(entries[0].traceId).toBe('t1')
    expect(entries[0].userId).toBe('abc12345')
    expect(entries[0].hubId).toBe('hub-99')
  })

  test('PII passed via extras is redacted by the runtime redactor', () => {
    const cap = captureStdout()
    const log = createLogger('routes.contacts')

    runWithLogContext({ reqId: 'r1', hubId: 'h1' }, () => {
      // biome-ignore lint/suspicious/noExplicitAny: deliberately bypassing the type gate to test runtime defense
      log.info('contact created', {
        contactId: 'ctc-1',
        phone: '+12025550100',
        firstName: 'Alice',
        email: 'alice@example.com',
      } as any)
    })

    cap.restore()
    const entries = parseLines(cap.lines)
    expect(entries[0].contactId).toBe('ctc-1')
    expect(entries[0].hubId).toBe('h1')
    expect(entries[0].phone).toBe('[redacted]')
    expect(entries[0].firstName).toBe('[redacted]')
    expect(entries[0].email).toBe('[redacted]')
  })

  test('log outside request context has empty ALS fields', () => {
    const cap = captureStdout()
    createLogger('jobs.background').info('scheduled tick')
    cap.restore()
    const entries = parseLines(cap.lines)
    expect(entries[0].reqId).toBeUndefined()
    expect(entries[0].hubId).toBeUndefined()
    expect(entries[0].userId).toBeUndefined()
    expect(entries[0].component).toBe('jobs.background')
  })
})
