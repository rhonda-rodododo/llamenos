import { beforeEach, describe, expect, test } from 'bun:test'
import { SFrameWorkerClient, SFrameWorkerError } from './sframe-worker-client.js'

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  private lastMessage: unknown = null
  private responder: ((msg: unknown) => unknown) | null = (msg) => ({
    type: 'success',
    id: (msg as { id: string }).id,
  })
  postMessage(msg: unknown): void {
    this.lastMessage = msg
    const responder = this.responder
    if (!responder) return
    queueMicrotask(() => {
      const data = responder(msg)
      this.onmessage?.({ data } as MessageEvent)
    })
  }
  setResponder(fn: ((msg: unknown) => unknown) | null): void {
    this.responder = fn
  }
  getLastMessage(): unknown {
    return this.lastMessage
  }
  terminate(): void {}
}

// Internal shape used only by a couple of tests that need to assert the
// pending-map state. Kept loose to avoid leaking private types.
interface ClientInternals {
  pending: Map<string, unknown>
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

  test('rejects with worker_not_ready when worker hangs past rpcTimeoutMs', async () => {
    const hangingMock = new MockWorker()
    hangingMock.setResponder(null) // never respond
    const hangingClient = new SFrameWorkerClient(hangingMock as unknown as Worker, 50)
    let caught: unknown
    try {
      await hangingClient.registerCall('call-hang')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SFrameWorkerError)
    expect((caught as SFrameWorkerError).code).toBe('worker_not_ready')
    // Pending map must be empty after the timeout fires.
    const internals = hangingClient as unknown as ClientInternals
    expect(internals.pending.size).toBe(0)
  })

  test('successful response clears the pending timer', async () => {
    // Use a very small timeout so that any lingering timer would fire
    // before the test ends — we then verify nothing goes wrong.
    const fastMock = new MockWorker()
    fastMock.setResponder((msg) => ({
      type: 'success',
      id: (msg as { id: string }).id,
      result: { sealed: 1, opened: 2, errors: 0 },
    }))
    const fastClient = new SFrameWorkerClient(fastMock as unknown as Worker, 25)
    const metrics = await fastClient.getMetrics('call-1')
    expect(metrics).toEqual({ sealed: 1, opened: 2, errors: 0 })
    // Wait longer than the timeout. If the timer had not been cleared,
    // it would attempt to reject an already-resolved/deleted entry — not
    // observable from outside, but the pending map must still be empty.
    await new Promise((resolve) => setTimeout(resolve, 60))
    const internals = fastClient as unknown as ClientInternals
    expect(internals.pending.size).toBe(0)
  })

  test('handleError clears all pending timers and empties the map', async () => {
    const hangingMock = new MockWorker()
    hangingMock.setResponder(null)
    const hangingClient = new SFrameWorkerClient(hangingMock as unknown as Worker, 10_000)
    const p1 = hangingClient.registerCall('call-a')
    const p2 = hangingClient.releaseCall('call-b')
    // Attach catch handlers before firing the error so Bun does not
    // flag the rejections as unhandled at the microtask boundary.
    const r1 = p1.catch((e: unknown) => e)
    const r2 = p2.catch((e: unknown) => e)
    // Simulate a worker-level error — should reject every pending entry
    // and clear their timers so nothing leaks past this point.
    hangingMock.onerror?.({ message: 'boom' } as ErrorEvent)
    const e1 = (await r1) as Error
    const e2 = (await r2) as Error
    expect(e1).toBeInstanceOf(Error)
    expect(e1.message).toMatch(/SFrame worker error/)
    expect(e2).toBeInstanceOf(Error)
    expect(e2.message).toMatch(/SFrame worker error/)
    const internals = hangingClient as unknown as ClientInternals
    expect(internals.pending.size).toBe(0)
  })
})
