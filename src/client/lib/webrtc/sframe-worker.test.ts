import { beforeEach, describe, expect, test } from 'bun:test'
import { clearWorkerState, handleRequest } from './sframe-worker.js'

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
