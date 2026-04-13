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
})
