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
 * key, and installs RTCRtpScriptTransforms on every sender/receiver.
 *
 * Failure semantics are **fail-closed**:
 *   - If the worker client is `null` (feature-detect said no), the hook
 *     rejects with a typed `SFrameWiringError('worker_unavailable')`.
 *   - If worker RPC fails or `installSFrameTransforms` throws, the hook
 *     rejects with `SFrameWiringError('hook_failed', cause)`.
 *
 * Adapters already catch these rejections, close the PC, and emit an `error`
 * event. The manager consumes that error and surfaces the
 * `E2eeFallbackBanner`. There is no silent DTLS-SRTP fallback — until a
 * future tier wires Nostr-based key distribution, a per-call 32-byte secret
 * is generated locally via `crypto.getRandomValues()` and used as the sender
 * base key. Outbound frames get SFrame-sealed; inbound frames from a peer
 * that has not yet received our key event WILL fail to decrypt, which is the
 * correct fail-closed behavior for an unfinished key distribution path.
 */

import type { SFramePeerConnectionHook } from './sframe-hook-types.js'
import { installSFrameTransforms } from './sframe-install.js'
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
   * Optional override for the per-call random secret source. Production code
   * should leave this unset — tests pass a deterministic function.
   */
  generateCallSecret?: () => Uint8Array
}

/** Deterministic 32-byte secret generator backed by WebCrypto's CSPRNG. */
function defaultCallSecret(): Uint8Array {
  const out = new Uint8Array(32)
  crypto.getRandomValues(out)
  return out
}

/**
 * Build a `SFramePeerConnectionHook` closure bound to the provided worker
 * client. Each invocation registers the call with the worker, uploads a
 * freshly-generated sender key, and installs SFrame transforms on the PC.
 */
export function buildSFrameCallHook(inputs: BuildSFrameCallHookInputs): SFramePeerConnectionHook {
  const { sframeClient, senderId } = inputs
  const genSecret = inputs.generateCallSecret ?? defaultCallSecret

  return async (pc, ctx) => {
    if (!sframeClient) {
      throw new SFrameWiringError(
        'worker_unavailable',
        'SFrame worker unavailable — refusing to complete call without E2EE'
      )
    }

    try {
      await sframeClient.registerCall(ctx.callId)

      // Per-call base key. Until Nostr SFrame key distribution is wired
      // (Tier 5 WS 5.6), this is a local random seed — outbound frames are
      // sealed, and any peer that hasn't received this key via a future
      // SFrameKeyEvent will fail decryption (fail-closed).
      const callSecret = genSecret()
      if (callSecret.byteLength !== 32) {
        throw new Error(`call secret must be 32 bytes, got ${callSecret.byteLength}`)
      }
      // ArrayBuffer is what the worker RPC schema expects.
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
    } catch (err) {
      // Release worker state for this call so a retry doesn't leak stale keys.
      try {
        await sframeClient.releaseCall(ctx.callId)
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
