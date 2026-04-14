/**
 * Tier 5 — SFrame call-flow wiring.
 *
 * Bridges the `SFrameWorkerClient` (main-thread facade over the dedicated
 * SFrame Web Worker) with the per-call `SFramePeerConnectionHook` that WebRTC
 * adapters invoke against the underlying `RTCPeerConnection`.
 *
 * This module exists so the manager can stay adapter-agnostic: it obtains a
 * worker client via `getSFrameWorker()` once, then calls `buildSFrameCallHook`
 * to get a closure that registers the call, sets an initial per-call sender
 * key (generated and HPKE-distributed via the orchestrator), and installs
 * RTCRtpScriptTransforms on every sender/receiver.
 *
 * Failure semantics are **fail-closed**:
 *   - If the worker client is `null` (feature-detect said no), the hook
 *     rejects with a typed `SFrameWiringError('worker_unavailable')`.
 *   - If worker RPC, orchestrator, or `installSFrameTransforms` throws, the
 *     hook rejects with `SFrameWiringError('hook_failed', cause)`.
 *
 * Adapters already catch these rejections, close the PC, and emit an `error`
 * event. The manager consumes that error and surfaces the
 * `E2eeFallbackBanner`. There is no silent DTLS-SRTP fallback — the
 * orchestrator generates the per-call secret, publishes a KIND_SFRAME_KEY
 * event to the Nostr relay, and the SFrame hook installs it as the worker's
 * sender key. A peer that hasn't received this key event will fail decryption
 * (fail-closed).
 */

import type { SFramePeerConnectionHook } from './sframe-hook-types.js'
import { installSFrameTransforms } from './sframe-install.js'
import { type SFrameOrchestrator, createSFrameOrchestrator } from './sframe-orchestrator.js'
import type { SFrameWorkerClient } from './sframe-worker-client.js'

/** Typed error so the manager can distinguish worker-unavailable from other
 *  wiring failures without string matching. */
export class SFrameWiringError extends Error {
  readonly code: 'worker_unavailable' | 'hook_failed'
  constructor(code: 'worker_unavailable' | 'hook_failed', message?: string, cause?: unknown) {
    super(message ?? code)
    this.name = 'SFrameWiringError'
    this.code = code
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

/** Inputs for {@link buildSFrameCallHook}. */
export interface BuildSFrameCallHookInputs {
  /**
   * SFrame worker client. `null` signals feature-detect found the environment
   * cannot support SFrame (no `RTCRtpScriptTransform`, no Worker, etc.) — the
   * returned hook will always reject with `worker_unavailable`.
   */
  sframeClient: SFrameWorkerClient | null

  /** Local device/sender identifier. Must be stable for the lifetime of the call. */
  senderId: string

  /**
   * Optional orchestrator injection. Production code leaves this unset — the
   * hook builds a default orchestrator bound to the provided worker client.
   * Tests inject stubs that return deterministic secrets.
   */
  orchestrator?: SFrameOrchestrator
}

/**
 * Build a `SFramePeerConnectionHook` closure bound to the provided worker
 * client. Each invocation asks the orchestrator to generate + distribute a
 * per-call SFrame secret, installs it as the worker's sender key, wires the
 * DTLS fingerprint verification path, and installs SFrame transforms on the
 * pc.
 */
export function buildSFrameCallHook(inputs: BuildSFrameCallHookInputs): SFramePeerConnectionHook {
  const { sframeClient, senderId } = inputs
  const orchestrator =
    inputs.orchestrator ?? (sframeClient ? createSFrameOrchestrator({ sframeClient }) : null)

  return async (pc, ctx) => {
    if (!sframeClient || !orchestrator) {
      throw new SFrameWiringError(
        'worker_unavailable',
        'SFrame worker unavailable — refusing to complete call without E2EE'
      )
    }

    try {
      await sframeClient.registerCall(ctx.callId)

      // Generate + distribute the per-call secret via the orchestrator. This
      // publishes a KIND_SFRAME_KEY event and round-trips through parseKeyEvent
      // as a loopback check. Fails the call closed on any HPKE/KEM error.
      const { callSecret, state } = await orchestrator.startCall(ctx.callId)

      if (callSecret.byteLength !== 32) {
        throw new Error(`call secret must be 32 bytes, got ${callSecret.byteLength}`)
      }
      const baseKey = (
        callSecret.byteOffset === 0 && callSecret.byteLength === callSecret.buffer.byteLength
          ? callSecret.buffer
          : callSecret.slice().buffer
      ) as ArrayBuffer
      await sframeClient.setSenderKey(ctx.callId, 1, baseKey, senderId)

      installSFrameTransforms(pc, {
        callId: ctx.callId,
        senderId,
        sframeClient,
      })

      // Fire-and-forget DTLS binding: publishes our fingerprint under
      // KIND_DTLS_BINDING once the local SDP is available. Errors log-and-drop
      // because an SDP-extract failure in the single-volunteer case is not
      // a security-relevant fail-closed trigger. A future workstream that
      // consumes peer KIND_DTLS_BINDING events will fail-closed there.
      void orchestrator.attachDtlsVerification(state, pc).catch(() => {
        /* best-effort publish */
      })
    } catch (err) {
      // Release worker + orchestrator state for this call so a retry doesn't
      // leak stale keys.
      try {
        await sframeClient.releaseCall(ctx.callId)
      } catch {
        /* best-effort cleanup */
      }
      try {
        await orchestrator?.releaseCall(ctx.callId)
      } catch {
        /* best-effort cleanup */
      }
      throw new SFrameWiringError(
        'hook_failed',
        err instanceof Error ? err.message : 'SFrame hook failed',
        err
      )
    }
  }
}
