import { describe, expect, test } from 'bun:test'
import { getLogContext, runWithLogContext } from './log-context'

describe('log-context', () => {
  test('returns empty object when no context is active', () => {
    expect(getLogContext()).toEqual({})
  })

  test('returns the current context inside runWithLogContext', () => {
    runWithLogContext({ reqId: 'r1', hubId: 'h1' }, () => {
      expect(getLogContext()).toEqual({ reqId: 'r1', hubId: 'h1' })
    })
  })

  test('nested runs inherit and override', () => {
    runWithLogContext({ reqId: 'r1' }, () => {
      runWithLogContext({ hubId: 'h2' }, () => {
        expect(getLogContext()).toEqual({ reqId: 'r1', hubId: 'h2' })
      })
    })
  })

  test('async boundaries preserve context', async () => {
    await runWithLogContext({ reqId: 'async-r' }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      expect(getLogContext()).toEqual({ reqId: 'async-r' })
    })
  })
})
