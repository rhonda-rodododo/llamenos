/**
 * Unit tests for `buildSFrameCallHook`. These exercise the failure-propagation
 * contract the manager + adapters depend on:
 *   - Consent not granted → fail-closed with `consent_required`.
 *   - Worker unavailable → fail-closed with `worker_unavailable`.
 *   - Worker RPC failure → wrapped `hook_failed` + cleanup `releaseCall`.
 *   - Happy path → orchestrator.startCall + registerCall + setSenderKey +
 *     installSFrameTransforms all run in order.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { __resetConsentState, __setConsentGrantedForTest } from '../consent'
import { buildSFrameCallHook, SFrameWiringError } from './sframe-call-hook'
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
  // The module-level consent cache is shared across suites — grant it before
  // every pre-existing test so they exercise the post-consent code path, and
  // reset afterwards to avoid bleeding state into the dedicated
  // consent-gate describe block below.
  beforeEach(() => {
    __setConsentGrantedForTest(true)
  })
  afterEach(() => {
    __resetConsentState()
  })

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

describe('buildSFrameCallHook — consent gate', () => {
  // Reset state between every test so the default (no consent) is authoritative.
  beforeEach(() => {
    __resetConsentState()
  })
  afterEach(() => {
    __resetConsentState()
  })

  test('rejects with consent_required when module consent cache is false', async () => {
    const worker = createFakeWorker()
    const pc = createStubPc() as unknown as RTCPeerConnection
    const orchestrator = createStubOrchestrator()

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local',
      orchestrator,
    })

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-consent', direction: 'inbound' })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('consent_required')
    // The hook MUST NOT touch the worker or orchestrator before the consent
    // check — otherwise a misbehaving orchestrator could publish a key event
    // for a call the user never consented to.
    expect(worker.registerCall).not.toHaveBeenCalled()
    // biome-ignore lint/suspicious/noExplicitAny: mock fn type
    expect((orchestrator.startCall as any).mock.calls.length).toBe(0)
  })

  test('rejects with consent_required even when client is null (consent gate precedes worker gate)', async () => {
    // Adversarial: if the worker is also unavailable, the error surfaced
    // must be consent_required, not worker_unavailable. This keeps the UI
    // error message honest — the user needs to consent first regardless.
    const hook = buildSFrameCallHook({ sframeClient: null, senderId: 'local' })
    const pc = createStubPc() as unknown as RTCPeerConnection

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-nc', direction: 'inbound' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('consent_required')
  })

  test('proceeds to happy path once consent is granted', async () => {
    __setConsentGrantedForTest(true)
    const worker = createFakeWorker()
    const pc = createStubPc() as unknown as RTCPeerConnection
    const orchestrator = createStubOrchestrator()

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local',
      orchestrator,
    })

    await hook(pc, { callId: 'call-ok', direction: 'inbound' })
    expect(worker.registerCall).toHaveBeenCalledWith('call-ok')
  })

  test('honors injected consentCheck closure over the module singleton', async () => {
    // Even though the module cache is granted, the injected closure returns
    // false — the closure MUST win. This lets the WebRTC manager scope the
    // consent decision to a specific React tree / call context in the future
    // without touching the singleton.
    __setConsentGrantedForTest(true)
    const worker = createFakeWorker()
    const pc = createStubPc() as unknown as RTCPeerConnection
    const orchestrator = createStubOrchestrator()

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local',
      orchestrator,
      consentCheck: () => false,
    })

    let caught: unknown = null
    try {
      await hook(pc, { callId: 'call-inj', direction: 'inbound' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SFrameWiringError)
    expect((caught as SFrameWiringError).code).toBe('consent_required')
    expect(worker.registerCall).not.toHaveBeenCalled()
  })

  test('injected consentCheck=true overrides a false module cache', async () => {
    // Symmetric to the above — the injection is authoritative both ways.
    __resetConsentState()
    const worker = createFakeWorker()
    const pc = createStubPc() as unknown as RTCPeerConnection
    const orchestrator = createStubOrchestrator()

    const hook = buildSFrameCallHook({
      sframeClient: worker as unknown as SFrameWorkerClient,
      senderId: 'local',
      orchestrator,
      consentCheck: () => true,
    })

    await hook(pc, { callId: 'call-inj2', direction: 'inbound' })
    expect(worker.registerCall).toHaveBeenCalledWith('call-inj2')
  })
})
