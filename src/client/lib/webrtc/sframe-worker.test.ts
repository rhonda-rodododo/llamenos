import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearWorkerState,
  DEGRADED_CONSECUTIVE_THRESHOLD,
  DEGRADED_WINDOW_MS,
  handleRequest,
  newDegradedTracker,
  recordOp,
} from './sframe-worker.js'

const buf = (fill: number, len = 16): ArrayBuffer => {
  const u = new Uint8Array(len)
  u.fill(fill)
  return u.buffer
}

describe('SFrame worker handleRequest', () => {
  beforeEach(() => clearWorkerState())

  test('registerCall creates empty call state', async () => {
    const resp = await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    expect(resp.type).toBe('success')
    expect(resp.id).toBe('1')
  })

  test('setSenderKey adds key for a sender', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    const resp = await handleRequest({
      type: 'setSenderKey',
      id: '2',
      callId: 'call-1',
      keyId: 0,
      baseKey: buf(0x42),
      senderId: 'sender-a',
    })
    expect(resp.type).toBe('success')
  })

  test('setSenderKey on unknown call returns error', async () => {
    const resp = await handleRequest({
      type: 'setSenderKey',
      id: '3',
      callId: 'unknown',
      keyId: 0,
      baseKey: buf(0),
      senderId: 'sender-a',
    })
    expect(resp.type).toBe('error')
    if (resp.type === 'error') expect(resp.code).toBe('unknown_call')
  })

  test('rejects zero-length key', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    const resp = await handleRequest({
      type: 'setSenderKey',
      id: '2',
      callId: 'call-1',
      keyId: 0,
      baseKey: new ArrayBuffer(0),
      senderId: 'sender-a',
    })
    expect(resp.type).toBe('error')
    if (resp.type === 'error') expect(resp.code).toBe('key_zero_length')
  })

  test('releaseCall clears state', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    await handleRequest({ type: 'releaseCall', id: '2', callId: 'call-1' })
    const next = await handleRequest({
      type: 'setSenderKey',
      id: '3',
      callId: 'call-1',
      keyId: 0,
      baseKey: buf(0x11),
      senderId: 'sender-a',
    })
    expect(next.type).toBe('error')
    if (next.type === 'error') expect(next.code).toBe('unknown_call')
  })

  test('getMetrics returns call metrics', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    const resp = await handleRequest({ type: 'getMetrics', id: '2', callId: 'call-1' })
    expect(resp.type).toBe('success')
    if (resp.type === 'success') {
      expect(resp.result).toMatchObject({ sealed: 0, opened: 0, errors: 0 })
    }
  })

  test('registerCall initialises a degraded tracker', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-deg' })
    // Indirectly verify by triggering a fresh metrics fetch — the tracker
    // is internal but registerCall must not throw and the call must exist.
    const resp = await handleRequest({ type: 'getMetrics', id: '2', callId: 'call-deg' })
    expect(resp.type).toBe('success')
  })

  test('rotateCallKey installs new key and demotes old', async () => {
    await handleRequest({ type: 'registerCall', id: '1', callId: 'call-1' })
    await handleRequest({
      type: 'setReceiverKey',
      id: '2',
      callId: 'call-1',
      keyId: 0,
      baseKey: buf(0x11),
      senderId: 'sender-a',
    })
    const rotated = await handleRequest({
      type: 'rotateCallKey',
      id: '3',
      callId: 'call-1',
      newKeyId: 1,
      newBaseKeys: { 'sender-a': buf(0x22) },
    })
    expect(rotated.type).toBe('success')
  })
})

describe('SFrame worker recordOp degraded detection', () => {
  test('does not signal under threshold', () => {
    const t = newDegradedTracker(0)
    let signal = recordOp(t, 'success', 0)
    expect(signal).toBeNull()
    signal = recordOp(t, 'error', 1)
    expect(signal).toBeNull()
    signal = recordOp(t, 'success', 2)
    expect(signal).toBeNull()
    expect(t.consecutiveErrors).toBe(0)
  })

  test('signals exactly once after consecutive-error threshold', () => {
    const t = newDegradedTracker(0)
    let signal = null
    for (let i = 0; i < DEGRADED_CONSECUTIVE_THRESHOLD; i += 1) {
      signal = recordOp(t, 'error', i + 1)
    }
    expect(signal).not.toBeNull()
    if (signal) {
      expect(signal.consecutiveErrors).toBeGreaterThanOrEqual(DEGRADED_CONSECUTIVE_THRESHOLD)
      expect(signal.errorRate).toBe(1)
    }
    // Subsequent error inside the same window does NOT re-signal.
    const next = recordOp(t, 'error', DEGRADED_CONSECUTIVE_THRESHOLD + 2)
    expect(next).toBeNull()
  })

  test('signals on rate threshold once min sample count is met', () => {
    const t = newDegradedTracker(0)
    // 9 successes + 2 errors = 11 samples, rate ~18% > 10%
    for (let i = 0; i < 9; i += 1) {
      expect(recordOp(t, 'success', i)).toBeNull()
    }
    expect(recordOp(t, 'error', 10)).toBeNull() // hits 10 samples, rate 10%
    const signal = recordOp(t, 'error', 11)
    expect(signal).not.toBeNull()
    if (signal) {
      expect(signal.errorRate).toBeGreaterThan(0.1)
    }
  })

  test('window roll resets degradedReported and clears counters', () => {
    const t = newDegradedTracker(0)
    for (let i = 0; i < DEGRADED_CONSECUTIVE_THRESHOLD; i += 1) {
      recordOp(t, 'error', i + 1)
    }
    expect(t.degradedReported).toBe(true)
    // Roll past the window — successful op should NOT re-signal but should
    // clear the flag so a future breach can re-signal in the new window.
    recordOp(t, 'success', DEGRADED_WINDOW_MS + 100)
    expect(t.degradedReported).toBe(false)
    expect(t.errorsInWindow).toBe(0)
    expect(t.successesInWindow).toBe(1)
    expect(t.consecutiveErrors).toBe(0)
    // Now drive a new burst — should re-signal in the new window.
    let signal = null
    for (let i = 0; i < DEGRADED_CONSECUTIVE_THRESHOLD; i += 1) {
      signal = recordOp(t, 'error', DEGRADED_WINDOW_MS + 200 + i)
    }
    expect(signal).not.toBeNull()
  })

  test('success resets consecutiveErrors but keeps window counters', () => {
    const t = newDegradedTracker(0)
    recordOp(t, 'error', 1)
    recordOp(t, 'error', 2)
    expect(t.consecutiveErrors).toBe(2)
    recordOp(t, 'success', 3)
    expect(t.consecutiveErrors).toBe(0)
    expect(t.errorsInWindow).toBe(2)
    expect(t.successesInWindow).toBe(1)
  })
})
