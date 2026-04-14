/**
 * Unit tests for `buildSFrameCallHook`. These exercise the failure-propagation
 * contract the manager + adapters depend on:
 *   - Worker unavailable → fail-closed with `worker_unavailable`.
 *   - Worker RPC failure → wrapped `hook_failed` + cleanup `releaseCall`.
 *   - Happy path → registerCall + setSenderKey + installSFrameTransforms
 *     all run in order.
 */
import { describe, expect, mock, test } from 'bun:test'
import { SFrameWiringError, buildSFrameCallHook } from './sframe-call-hook'
import type { SFrameWorkerClient } from './sframe-worker-client'

interface StubPc {
  getSenders: () => Array<{ track?: { kind: string }; transform?: unknown }>
  addEventListener: (event: string, handler: (ev: Event) => void) => void
}

function createStubPc(): StubPc {
  return {
    getSenders: () => [],
    addEventListener: () => {
      /* no-op */
    },
  }
}

function createFakeWorker(
  overrides?: Partial<{
    registerCall: ReturnType<typeof mock>
    setSenderKey: ReturnType<typeof mock>
    releaseCall: ReturnType<typeof mock>
    buildTransform: ReturnType<typeof mock>
  }>
) {
  const w = {
    registerCall: mock(async () => {}),
    setSenderKey: mock(async () => {}),
    setReceiverKey: mock(async () => {}),
    rotateCallKey: mock(async () => {}),
    releaseCall: mock(async () => {}),
    getMetrics: mock(async () => ({ sealed: 0, opened: 0, errors: 0 })),
    buildTransform: mock(() => ({})),
    terminate: () => {},
  }
  return Object.assign(w, overrides ?? {})
}

describe('buildSFrameCallHook', () => {
  test('rejects with SFrameWiringError(worker_unavailable) when client is null', async () => {
    const hook = buildSFrameCallHook({ sframeClient: null, senderId: 'local' })
    const pc = createStubPc() as unknown as RTCPeerConnection

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-1', direction: 'inbound' })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('worker_unavailable')
  })

  test('happy path registers call, sets sender key, and installs transforms', async () => {
    const worker = createFakeWorker()
    const pc = createStubPc() as unknown as RTCPeerConnection
    const seed = new Uint8Array(32).fill(7)

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local-twilio',
      generateCallSecret: () => seed,
    })

    await hook(pc, { callId: 'call-42', direction: 'inbound' })

    expect(worker.registerCall).toHaveBeenCalledTimes(1)
    expect(worker.registerCall).toHaveBeenCalledWith('call-42')
    expect(worker.setSenderKey).toHaveBeenCalledTimes(1)
    const args = worker.setSenderKey.mock.calls[0] as unknown as [
      string,
      number,
      ArrayBuffer,
      string,
    ]
    expect(args[0]).toBe('call-42')
    expect(args[1]).toBe(1)
    expect(args[2].byteLength).toBe(32)
    expect(new Uint8Array(args[2])[0]).toBe(7)
    expect(args[3]).toBe('local-twilio')
  })

  test('worker registerCall failure wraps in hook_failed and calls releaseCall', async () => {
    const worker = createFakeWorker({
      registerCall: mock(async () => {
        throw new Error('rpc broke')
      }),
    })
    const pc = createStubPc() as unknown as RTCPeerConnection

    // biome-ignore lint/suspicious/noExplicitAny: stub shape
    const hook = buildSFrameCallHook({ sframeClient: worker as any, senderId: 'local' })

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-x', direction: 'inbound' })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('hook_failed')
    // The original error should be attached as cause for debuggability.
    const cause = (caught as Error & { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(Error)
    expect((cause as Error).message).toBe('rpc broke')
    expect(worker.releaseCall).toHaveBeenCalledWith('call-x')
  })

  test('non-32-byte secret source is rejected', async () => {
    const worker = createFakeWorker()
    const pc = createStubPc() as unknown as RTCPeerConnection

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local',
      generateCallSecret: () => new Uint8Array(16),
    })

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-1', direction: 'inbound' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('hook_failed')
    // Because the failure happens AFTER registerCall, cleanup should still run.
    expect(worker.releaseCall).toHaveBeenCalledWith('call-1')
  })
})
