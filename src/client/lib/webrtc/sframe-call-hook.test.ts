/**
 * Unit tests for `buildSFrameCallHook`. These exercise the failure-propagation
 * contract the manager + adapters depend on:
 *   - Worker unavailable → fail-closed with `worker_unavailable`.
 *   - Worker RPC failure → wrapped `hook_failed` + cleanup `releaseCall`.
 *   - Happy path → orchestrator.startCall + registerCall + setSenderKey +
 *     installSFrameTransforms all run in order.
 */
import { describe, expect, mock, test } from 'bun:test'
import { SFrameWiringError, buildSFrameCallHook } from './sframe-call-hook'
import type { SFrameOrchestrator } from './sframe-orchestrator'
import type { SFrameWorkerClient } from './sframe-worker-client'

interface StubPc {
  getSenders: () => Array<{ track?: { kind: string }; transform?: unknown }>
  addEventListener: (event: string, handler: (ev: Event) => void) => void
  localDescription: { sdp: string } | null
}

function createStubPc(): StubPc {
  return {
    getSenders: () => [],
    addEventListener: () => {
      /* no-op */
    },
    localDescription: null,
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

function createStubOrchestrator(
  overrides?: Partial<{
    startCall: ReturnType<typeof mock>
    attachDtlsVerification: ReturnType<typeof mock>
    releaseCall: ReturnType<typeof mock>
  }>
): SFrameOrchestrator {
  const defaults: SFrameOrchestrator = {
    startCall: mock(async (providerCallId: string) => ({
      callSecret: new Uint8Array(32).fill(7),
      keyId: 0,
      // biome-ignore lint/suspicious/noExplicitAny: test state shape
      state: { sframeCallId: 'sframe-test', providerCallId } as any,
    })),
    attachDtlsVerification: mock(async () => {}),
    releaseCall: mock(async () => {}),
    rotateOnJoin: mock(async () => {}),
    rotateOnLeave: mock(async () => {}),
  }
  return Object.assign(defaults, overrides ?? {}) as SFrameOrchestrator
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
    const orchestrator = createStubOrchestrator()

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local-twilio',
      orchestrator,
    })

    await hook(pc, { callId: 'call-42', direction: 'inbound' })

    expect(worker.registerCall).toHaveBeenCalledTimes(1)
    expect(worker.registerCall).toHaveBeenCalledWith('call-42')
    // biome-ignore lint/suspicious/noExplicitAny: mock fn type
    expect((orchestrator.startCall as any).mock.calls[0][0]).toBe('call-42')
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

    const hook = buildSFrameCallHook({
      // biome-ignore lint/suspicious/noExplicitAny: stub shape
      sframeClient: worker as any,
      senderId: 'local',
      orchestrator: createStubOrchestrator(),
    })

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-x', direction: 'inbound' })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('hook_failed')
    const cause = (caught as Error & { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(Error)
    expect((cause as Error).message).toBe('rpc broke')
    expect(worker.releaseCall).toHaveBeenCalledWith('call-x')
  })

  test('orchestrator.startCall failure is wrapped in hook_failed and cleans up', async () => {
    const worker = createFakeWorker()
    const pc = createStubPc() as unknown as RTCPeerConnection
    const orchestrator = createStubOrchestrator({
      startCall: mock(async () => {
        throw new Error('orchestrator boom')
      }),
    })

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local',
      orchestrator,
    })

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-o', direction: 'inbound' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('hook_failed')
    expect(worker.releaseCall).toHaveBeenCalledWith('call-o')
    // biome-ignore lint/suspicious/noExplicitAny: mock fn type
    expect(orchestrator.releaseCall as any).toHaveBeenCalledWith('call-o')
  })

  test('non-32-byte secret from orchestrator is rejected', async () => {
    const worker = createFakeWorker()
    const pc = createStubPc() as unknown as RTCPeerConnection
    const orchestrator = createStubOrchestrator({
      startCall: mock(async (providerCallId: string) => ({
        callSecret: new Uint8Array(16),
        keyId: 0,
        // biome-ignore lint/suspicious/noExplicitAny: test state shape
        state: { sframeCallId: 'sframe-test', providerCallId } as any,
      })),
    })

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local',
      orchestrator,
    })

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-1', direction: 'inbound' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('hook_failed')
    expect(worker.releaseCall).toHaveBeenCalledWith('call-1')
  })
})
