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

describe('createLogger', () => {
  beforeEach(() => {
    _setLoggerConfigForTests({
      minLevel: 'debug',
      namespaces: ['*'],
      rateLimits: {
        debug: 1000,
        info: 1000,
        warn: 1000,
        error: Number.POSITIVE_INFINITY,
      },
      stripStacks: false,
    })
  })

  test('emits JSON with component + level + ts + msg', () => {
    const cap = captureStdout()
    const log = createLogger('telephony.twilio')
    log.info('call answered', { callSid: 'CA123' })
    cap.restore()
    const entry = JSON.parse(cap.lines[0].trim())
    expect(entry.component).toBe('telephony.twilio')
    expect(entry.level).toBe('info')
    expect(entry.msg).toBe('call answered')
    expect(entry.callSid).toBe('CA123')
    expect(typeof entry.ts).toBe('string')
  })

  test('merges ALS request context', () => {
    const cap = captureStdout()
    const log = createLogger('auth')
    runWithLogContext({ reqId: 'r1', hubId: 'h1' }, () => {
      log.info('token verified')
    })
    cap.restore()
    const entry = JSON.parse(cap.lines[0].trim())
    expect(entry.reqId).toBe('r1')
    expect(entry.hubId).toBe('h1')
  })

  test('filters by namespace glob', () => {
    _setLoggerConfigForTests({
      minLevel: 'debug',
      namespaces: ['telephony.*'],
      rateLimits: {
        debug: 1000,
        info: 1000,
        warn: 1000,
        error: Number.POSITIVE_INFINITY,
      },
      stripStacks: false,
    })
    const cap = captureStdout()
    createLogger('telephony.twilio').info('hit')
    createLogger('auth').info('miss')
    cap.restore()
    expect(cap.lines).toHaveLength(1)
    expect(cap.lines[0]).toContain('telephony.twilio')
  })

  test('filters by level', () => {
    _setLoggerConfigForTests({
      minLevel: 'warn',
      namespaces: ['*'],
      rateLimits: {
        debug: 1000,
        info: 1000,
        warn: 1000,
        error: Number.POSITIVE_INFINITY,
      },
      stripStacks: false,
    })
    const cap = captureStdout()
    const log = createLogger('ns')
    log.debug('no')
    log.info('no')
    log.warn('yes')
    cap.restore()
    expect(cap.lines).toHaveLength(1)
  })

  test('redacts sensitive keys in extras', () => {
    const cap = captureStdout()
    createLogger('x').info('m', { hubId: 'h', phone: '+123' })
    cap.restore()
    const entry = JSON.parse(cap.lines[0].trim())
    expect(entry.phone).toBe('[redacted]')
    expect(entry.hubId).toBe('h')
  })

  test('rate limit drops surplus and emits summary', () => {
    _setLoggerConfigForTests({
      minLevel: 'debug',
      namespaces: ['*'],
      rateLimits: { debug: 2, info: 2, warn: 2, error: Number.POSITIVE_INFINITY },
      stripStacks: false,
    })
    const cap = captureStdout()
    const log = createLogger('ns')
    for (let i = 0; i < 5; i++) log.info('m')
    cap.restore()
    expect(cap.lines.length).toBe(2)
  })

  test('never throws on circular extras', () => {
    const cap = captureStdout()
    const circ: Record<string, unknown> = { a: 1 }
    circ.self = circ
    expect(() => createLogger('x').info('m', circ)).not.toThrow()
    cap.restore()
  })

  test('writes error level to stderr', () => {
    const stderr: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
      stderr.push(typeof c === 'string' ? c : String(c))
      return true
    })
    createLogger('x').error('bad')
    spy.mockRestore()
    expect(stderr).toHaveLength(1)
  })

  test('error helper unwraps Error (stderr)', () => {
    const stderr: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
      stderr.push(typeof c === 'string' ? c : String(c))
      return true
    })
    createLogger('x').error('failed', new Error('boom'))
    spy.mockRestore()
    const entry = JSON.parse(stderr[0].trim())
    expect(entry.errName).toBe('Error')
    expect(entry.errMsg).toBe('boom')
    expect(entry.msg).toBe('failed')
  })

  test('error treats plain object as extras, not as error (C3 fix)', () => {
    const stderr: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
      stderr.push(typeof c === 'string' ? c : String(c))
      return true
    })
    createLogger('x').error('request failed', { status: 500, path: '/api/test' })
    spy.mockRestore()
    const entry = JSON.parse(stderr[0].trim())
    expect(entry.status).toBe(500)
    expect(entry.path).toBe('/api/test')
    // Must NOT produce errMsg: "[object Object]"
    expect(entry.errMsg).toBeUndefined()
    expect(entry.errName).toBeUndefined()
  })

  test('error with Error + extras merges both', () => {
    const stderr: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
      stderr.push(typeof c === 'string' ? c : String(c))
      return true
    })
    createLogger('x').error('failed', new Error('boom'), { requestId: 'r1' })
    spy.mockRestore()
    const entry = JSON.parse(stderr[0].trim())
    expect(entry.errName).toBe('Error')
    expect(entry.errMsg).toBe('boom')
    expect(entry.requestId).toBe('r1')
  })

  test('error with undefined + extras still emits extras (legacy pattern)', () => {
    const stderr: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
      stderr.push(typeof c === 'string' ? c : String(c))
      return true
    })
    createLogger('x').error('provider down', undefined, { provider: 'twilio' })
    spy.mockRestore()
    const entry = JSON.parse(stderr[0].trim())
    expect(entry.provider).toBe('twilio')
    expect(entry.errMsg).toBeUndefined()
  })

  test('error with string primitive wraps as error value', () => {
    const stderr: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
      stderr.push(typeof c === 'string' ? c : String(c))
      return true
    })
    createLogger('x').error('failed', 'some string error')
    spy.mockRestore()
    const entry = JSON.parse(stderr[0].trim())
    expect(entry.errName).toBe('Unknown')
    expect(entry.errMsg).toBe('some string error')
  })

  // Compile-time check: Loggable<T> type gate rejects Unloggable fields.
  // The following would fail to compile if uncommented:
  //   import type { Ciphertext } from '@shared/types'
  //   const ct = 'encrypted' as Ciphertext
  //   createLogger('x').info('msg', { ct })  // TS error: Ciphertext extends Unloggable → never
})
