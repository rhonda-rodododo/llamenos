import { describe, expect, test } from 'bun:test'
import { SFrameWorkerRequestSchema, SFrameWorkerResponseSchema } from './sframe-worker-messages.js'

describe('SFrameWorkerRequestSchema', () => {
  test('accepts registerCall', () => {
    const parsed = SFrameWorkerRequestSchema.safeParse({
      type: 'registerCall',
      id: '1',
      callId: 'call-abc',
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts releaseCall', () => {
    const parsed = SFrameWorkerRequestSchema.safeParse({
      type: 'releaseCall',
      id: '1',
      callId: 'call-abc',
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts getMetrics', () => {
    const parsed = SFrameWorkerRequestSchema.safeParse({
      type: 'getMetrics',
      id: '1',
      callId: 'call-abc',
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts setSenderKey with ArrayBuffer baseKey', () => {
    const parsed = SFrameWorkerRequestSchema.safeParse({
      type: 'setSenderKey',
      id: '1',
      callId: 'call-abc',
      keyId: 0,
      baseKey: new ArrayBuffer(16),
      senderId: 'sender-a',
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects setSenderKey with keyId out of range (128)', () => {
    const parsed = SFrameWorkerRequestSchema.safeParse({
      type: 'setSenderKey',
      id: '1',
      callId: 'call-abc',
      keyId: 128,
      baseKey: new ArrayBuffer(16),
      senderId: 'sender-a',
    })
    expect(parsed.success).toBe(false)
  })

  test('rejects setSenderKey with non-ArrayBuffer baseKey', () => {
    const parsed = SFrameWorkerRequestSchema.safeParse({
      type: 'setSenderKey',
      id: '1',
      callId: 'call-abc',
      keyId: 0,
      baseKey: new Uint8Array(16),
      senderId: 'sender-a',
    })
    expect(parsed.success).toBe(false)
  })

  test('accepts rotateCallKey with newBaseKeys record', () => {
    const parsed = SFrameWorkerRequestSchema.safeParse({
      type: 'rotateCallKey',
      id: '1',
      callId: 'call-abc',
      newKeyId: 2,
      newBaseKeys: {
        'sender-a': new ArrayBuffer(16),
        'sender-b': new ArrayBuffer(16),
      },
    })
    expect(parsed.success).toBe(true)
  })
})

describe('SFrameWorkerResponseSchema', () => {
  test('accepts success response', () => {
    const parsed = SFrameWorkerResponseSchema.safeParse({ type: 'success', id: '1' })
    expect(parsed.success).toBe(true)
  })

  test('accepts success response with result', () => {
    const parsed = SFrameWorkerResponseSchema.safeParse({
      type: 'success',
      id: '1',
      result: { sealed: 5, opened: 0, errors: 0 },
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts error response with enum code', () => {
    const parsed = SFrameWorkerResponseSchema.safeParse({
      type: 'error',
      id: '1',
      error: 'nope',
      code: 'unknown_call',
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects error response with non-enum code', () => {
    const parsed = SFrameWorkerResponseSchema.safeParse({
      type: 'error',
      id: '1',
      error: 'nope',
      code: 'totally_made_up',
    })
    expect(parsed.success).toBe(false)
  })
})
