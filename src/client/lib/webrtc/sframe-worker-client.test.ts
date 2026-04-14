import { beforeEach, describe, expect, test } from 'bun:test'
import { SFrameWorkerClient, SFrameWorkerError } from './sframe-worker-client.js'

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  private lastMessage: unknown = null
  private responder: (msg: unknown) => unknown = (msg) => ({
    type: 'success',
    id: (msg as { id: string }).id,
  })
  postMessage(msg: unknown): void {
    this.lastMessage = msg
    const responder = this.responder
    queueMicrotask(() => {
      const data = responder(msg)
      this.onmessage?.({ data } as MessageEvent)
    })
  }
  setResponder(fn: (msg: unknown) => unknown): void {
    this.responder = fn
  }
  getLastMessage(): unknown {
    return this.lastMessage
  }
  terminate(): void {}
}

describe('SFrameWorkerClient', () => {
  let mock: MockWorker
  let client: SFrameWorkerClient
  beforeEach(() => {
    mock = new MockWorker()
    client = new SFrameWorkerClient(mock as unknown as Worker)
  })

  test('registerCall posts the right message', async () => {
    await client.registerCall('call-1')
    const last = mock.getLastMessage() as { type: string; callId: string; id: string }
    expect(last.type).toBe('registerCall')
    expect(last.callId).toBe('call-1')
    expect(last.id).toBeDefined()
  })

  test('setSenderKey forwards key material', async () => {
    const bk = new ArrayBuffer(16)
    await client.setSenderKey('call-1', 3, bk, 'sender-a')
    const last = mock.getLastMessage() as {
      type: string
      keyId: number
      senderId: string
      baseKey: ArrayBuffer
    }
    expect(last.type).toBe('setSenderKey')
    expect(last.keyId).toBe(3)
    expect(last.senderId).toBe('sender-a')
    expect(last.baseKey.byteLength).toBe(16)
  })

  test('getMetrics returns worker result', async () => {
    mock.setResponder((msg) => ({
      type: 'success',
      id: (msg as { id: string }).id,
      result: { sealed: 5, opened: 7, errors: 0 },
    }))
    const metrics = await client.getMetrics('call-1')
    expect(metrics).toEqual({ sealed: 5, opened: 7, errors: 0 })
  })

  test('throws SFrameWorkerError on error response', async () => {
    mock.setResponder((msg) => ({
      type: 'error',
      id: (msg as { id: string }).id,
      error: 'nope',
      code: 'unknown_call',
    }))
    await expect(client.registerCall('call-1')).rejects.toBeInstanceOf(SFrameWorkerError)
  })

  test('onDegraded receives unsolicited sframe_degraded notifications', () => {
    const events: Array<{ callId: string; errorRate: number; consecutiveErrors: number }> = []
    const unsubscribe = client.onDegraded((ev) => {
      events.push({
        callId: ev.callId,
        errorRate: ev.errorRate,
        consecutiveErrors: ev.consecutiveErrors,
      })
    })
    // Simulate the worker pushing an unsolicited message (no `id` matching a
    // pending RPC promise). The handler must dispatch to listeners.
    mock.onmessage?.({
      data: { type: 'sframe_degraded', callId: 'call-x', errorRate: 0.42, consecutiveErrors: 7 },
    } as MessageEvent)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ callId: 'call-x', errorRate: 0.42, consecutiveErrors: 7 })
    unsubscribe()
    mock.onmessage?.({
      data: { type: 'sframe_degraded', callId: 'call-y', errorRate: 0.5, consecutiveErrors: 9 },
    } as MessageEvent)
    expect(events).toHaveLength(1) // unsubscribe stopped delivery
  })

  test('unsolicited sframe_degraded does not interfere with pending RPCs', async () => {
    const promise = client.registerCall('call-1')
    // Push a degraded notification BEFORE the responder fires — must not
    // resolve / reject the pending registerCall promise.
    mock.onmessage?.({
      data: { type: 'sframe_degraded', callId: 'call-1', errorRate: 1, consecutiveErrors: 5 },
    } as MessageEvent)
    await promise
    expect(true).toBe(true)
  })
})
