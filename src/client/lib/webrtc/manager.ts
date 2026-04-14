/**
 * WebRTCManager — provider-agnostic singleton for WebRTC call handling.
 *
 * Replaces the old webrtc.ts with an adapter-factory model:
 * - Selects the correct adapter (Twilio, Vonage, Plivo) from the token response
 * - Runs a state machine with an 'ended' transient state
 * - Schedules token refresh at (ttl - 60s) before expiry
 *
 * Public API is identical to the old webrtc.ts so all call sites work unchanged
 * after updating imports to @/lib/webrtc/manager.
 */

import { getWebRtcToken } from '../api'
import { createDebugLog } from '../debug-log'

const log = createDebugLog('llamenos:webrtc')
import { PlivoWebRTCAdapter } from './adapters/plivo'
import { SipWebRTCAdapter } from './adapters/sip'
import { TwilioWebRTCAdapter } from './adapters/twilio'
import { VonageWebRTCAdapter } from './adapters/vonage'
import { SFrameWiringError, buildSFrameCallHook } from './sframe-call-hook'
import type { SFramePeerConnectionHook } from './sframe-hook-types'
import { type SFrameWorkerClient, getSFrameWorker } from './sframe-worker-client'
import type { StateChangeHandler, WebRTCAdapter, WebRtcState } from './types'

// Re-export types consumed by other modules
export type { StateChangeHandler, WebRtcState }

/**
 * End-to-end-encryption status reported by the manager to UI surfaces.
 *
 *  - `unknown`      — no call active, or not yet probed.
 *  - `active`       — SFrame transforms are installed; call is E2EE.
 *  - `unavailable`  — SFrame worker cannot run (browser unsupported or
 *                     worker crashed). Fail-closed: the active call has
 *                     been torn down and the next call is blocked until
 *                     the operator acknowledges the fallback banner.
 */
export type E2eeStatus = 'unknown' | 'active' | 'unavailable'

export type E2eeStatusHandler = (status: E2eeStatus, reason?: string) => void

/**
 * Injection seam for tests — lets them swap the worker-client factory and the
 * hook builder without going through the real Worker constructor.
 */
export interface SFrameInjection {
  getSFrameWorker?: () => SFrameWorkerClient | null
  buildHook?: (client: SFrameWorkerClient | null, senderId: string) => SFramePeerConnectionHook
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let currentState: WebRtcState = 'idle'
const stateHandlers = new Set<StateChangeHandler>()

let adapter: WebRTCAdapter | null = null
let currentProvider: string | null = null
let incomingCallSid: string | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

// SFrame wiring
let sframeInjection: SFrameInjection = {}
let sframeClient: SFrameWorkerClient | null = null
let e2eeStatus: E2eeStatus = 'unknown'
let e2eeReason: string | undefined
const e2eeHandlers = new Set<E2eeStatusHandler>()
let degradedUnsubscribe: (() => void) | null = null
let e2eeDegraded = false
const e2eeDegradedHandlers = new Set<E2eeDegradedHandler>()

/**
 * Tier 5 P0 — surfaced when the SFrame worker reports that frame error rate
 * has exceeded threshold for the active call. Carries the rolling error rate
 * so the UI can render a yellow/warning indicator without polling getMetrics.
 */
export interface E2eeDegradedEvent {
  callId: string
  errorRate: number
  consecutiveErrors: number
}

export type E2eeDegradedHandler = (ev: E2eeDegradedEvent | null) => void

/**
 * Override the SFrame worker-client factory and/or hook builder used by the
 * manager. Returns a disposer that restores the previous injection. Tests use
 * this to swap real Workers for stubs.
 */
export function __setSFrameInjection(injection: SFrameInjection): () => void {
  const prev = sframeInjection
  sframeInjection = injection
  return () => {
    sframeInjection = prev
  }
}

function resolveSFrameWorker(): SFrameWorkerClient | null {
  const factory = sframeInjection.getSFrameWorker ?? getSFrameWorker
  return factory()
}

function resolveHookBuilder(
  client: SFrameWorkerClient | null,
  senderId: string
): SFramePeerConnectionHook {
  if (sframeInjection.buildHook) return sframeInjection.buildHook(client, senderId)
  return buildSFrameCallHook({ sframeClient: client, senderId })
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

function createAdapter(provider: string, sframeHook: SFramePeerConnectionHook): WebRTCAdapter {
  switch (provider) {
    case 'twilio':
    case 'signalwire':
      return new TwilioWebRTCAdapter({ sframeHook })
    case 'vonage':
      return new VonageWebRTCAdapter({ sframeHook })
    case 'plivo':
      return new PlivoWebRTCAdapter({ sframeHook })
    case 'asterisk':
    case 'freeswitch':
    case 'kamailio':
    case 'sip':
      return new SipWebRTCAdapter({ sframeHook })
    default:
      throw new Error(`No WebRTC adapter for provider: ${provider}`)
  }
}

// ---------------------------------------------------------------------------
// State machine helpers
// ---------------------------------------------------------------------------

function setState(state: WebRtcState, error?: string): void {
  currentState = state
  for (const handler of stateHandlers) {
    handler(state, error)
  }

  // 'ended' is transient — after notifying listeners, return to 'ready'
  if (state === 'ended') {
    currentState = 'ready'
    for (const handler of stateHandlers) {
      handler('ready')
    }
  }
}

function setE2eeStatus(status: E2eeStatus, reason?: string): void {
  e2eeStatus = status
  e2eeReason = reason
  for (const handler of e2eeHandlers) {
    handler(status, reason)
  }
}

/**
 * Detect whether an adapter-emitted error came from the SFrame hook. Adapters
 * forward the hook rejection verbatim, so we can check `instanceof` or walk
 * the cause chain. This avoids false-positive `unavailable` flips from
 * unrelated adapter errors (registration failure, ICE disconnect, etc.).
 */
function isSFrameHookFailure(err: Error): boolean {
  if (err instanceof SFrameWiringError) return true
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause instanceof SFrameWiringError) return true
  return false
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

function clearRefreshTimer(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
}

function scheduleTokenRefresh(ttl: number, provider: string): void {
  clearRefreshTimer()
  const delayMs = Math.max((ttl - 60) * 1000, 0)

  refreshTimer = setTimeout(() => {
    refreshTimer = null
    handleTokenRefresh(provider).catch((err: unknown) => {
      log('Token refresh failed:', err instanceof Error ? err.message : 'unknown')
    })
  }, delayMs)
}

async function handleTokenRefresh(provider: string): Promise<void> {
  try {
    const { token, ttl } = await getWebRtcToken()

    if (provider === 'twilio' || provider === 'signalwire') {
      // Twilio adapter has updateToken() — hot-swap without re-registering
      const twilioAdapter = adapter as TwilioWebRTCAdapter
      twilioAdapter.updateToken(token)
    } else {
      // For other providers: force a full re-init
      await initWebRtc(true)
      return // initWebRtc schedules its own refresh
    }

    scheduleTokenRefresh(ttl, provider)
  } catch (err) {
    log('Token refresh error:', err instanceof Error ? err.message : 'unknown')
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getState(): WebRtcState {
  return currentState
}

export function onStateChange(handler: StateChangeHandler): () => void {
  stateHandlers.add(handler)
  return () => stateHandlers.delete(handler)
}

/**
 * Current end-to-end-encryption status for the active (or most recent) call.
 */
export function getE2eeStatus(): E2eeStatus {
  return e2eeStatus
}

/**
 * Machine-readable reason for the last non-`active` status transition, if
 * any. Used by the UI to pick the right fallback-banner copy.
 */
export function getE2eeReason(): string | undefined {
  return e2eeReason
}

/**
 * Subscribe to E2EE status transitions. Returns an unsubscribe function.
 * Fires synchronously on every transition (including duplicates) so the UI
 * can drive the fallback banner + active-call badge from a single source.
 */
export function onE2eeStatusChange(handler: E2eeStatusHandler): () => void {
  e2eeHandlers.add(handler)
  return () => e2eeHandlers.delete(handler)
}

/**
 * Subscribe to degraded-call notifications posted by the SFrame worker.
 * Fires with an {@link E2eeDegradedEvent} when the worker reports threshold
 * breach, and with `null` when the call is released and degraded state is
 * cleared. Returns an unsubscribe function.
 */
export function onE2eeDegraded(handler: E2eeDegradedHandler): () => void {
  e2eeDegradedHandlers.add(handler)
  return () => e2eeDegradedHandlers.delete(handler)
}

/**
 * Whether the most recent call is currently flagged as degraded by the
 * SFrame worker (consecutive errors or rolling error rate exceeded).
 */
export function isE2eeDegraded(): boolean {
  return e2eeDegraded
}

function setE2eeDegraded(ev: E2eeDegradedEvent | null): void {
  e2eeDegraded = ev !== null
  for (const handler of e2eeDegradedHandlers) {
    handler(ev)
  }
}

/**
 * Initialize WebRTC for the current provider.
 * @param forceRefresh - When true, bypasses the ready/initializing guard and
 *   tears down the existing adapter before re-initializing. Used by token refresh.
 */
export async function initWebRtc(forceRefresh = false): Promise<void> {
  if (!forceRefresh && (currentState === 'ready' || currentState === 'initializing')) return

  if (forceRefresh && adapter) {
    // Tear down existing adapter before re-init
    clearRefreshTimer()
    adapter.destroy()
    adapter = null
    currentProvider = null
    incomingCallSid = null
  }

  setState('initializing')

  try {
    const { token, provider, ttl } = await getWebRtcToken()
    currentProvider = provider

    // Resolve SFrame worker once per init. If the worker cannot be loaded
    // (no RTCRtpScriptTransform, no Worker, or the singleton threw) the call
    // must fail closed — the hook will reject with SFrameWiringError and the
    // adapter terminates the session. The manager exposes `unavailable` so
    // the overlay can mount <E2eeFallbackBanner>.
    sframeClient = resolveSFrameWorker()
    if (sframeClient === null) {
      log('SFrame worker unavailable — E2EE fallback banner will show on call attempts')
      setE2eeStatus('unavailable', 'browser_unsupported')
    } else {
      setE2eeStatus('unknown')
      // Subscribe to unsolicited degraded notifications from the worker.
      // The previous subscription (if any) is disposed first so re-init
      // does not leak listeners across the singleton's lifetime.
      degradedUnsubscribe?.()
      degradedUnsubscribe = sframeClient.onDegraded((ev) => {
        log('SFrame worker reported degraded call', ev.callId, ev.errorRate)
        setE2eeDegraded({
          callId: ev.callId,
          errorRate: ev.errorRate,
          consecutiveErrors: ev.consecutiveErrors,
        })
      })
    }

    // Identity for the local SFrame sender. The token identity is opaque
    // but stable for the lifetime of this registration — good enough for
    // per-call sender-key tagging.
    const senderId = `local-${provider}`
    const sframeHook = resolveHookBuilder(sframeClient, senderId)

    const newAdapter = createAdapter(provider, sframeHook)

    // Wire adapter events → state machine
    newAdapter.on('incoming', (callSid) => {
      log('Incoming call', callSid)
      incomingCallSid = callSid
      setState('ringing')
    })

    newAdapter.on('connected', () => {
      log('Call connected')
      // The SFrame hook runs synchronously on the `peerconnection` event
      // before 'connected', so if we reach here without the adapter having
      // emitted an error, SFrame install succeeded and we are E2EE.
      if (sframeClient !== null) setE2eeStatus('active')
      setState('connected')
    })

    newAdapter.on('disconnected', () => {
      log('Call disconnected')
      incomingCallSid = null
      // Per-call SFrame state is released by the adapter (pc.close()). The
      // worker singleton is retained for the next call; the e2ee status
      // returns to `unknown` until the next call connects.
      if (e2eeStatus === 'active') setE2eeStatus('unknown')
      // Clear any degraded flag from the previous call so a fresh call
      // starts with a clean badge state.
      if (e2eeDegraded) setE2eeDegraded(null)
      setState('ended')
    })

    newAdapter.on('error', (err) => {
      log('Adapter error:', err.message)
      // The adapter already terminates the PC when the SFrame hook throws.
      // A hook failure propagates as an Error with SFrameWiringError as its
      // message or cause. Surface unavailable so the overlay can show the
      // fallback banner even if the worker client itself is still alive.
      if (isSFrameHookFailure(err)) {
        setE2eeStatus('unavailable', 'sframe_hook_failed')
      }
      setState('error', err.message)
    })

    adapter = newAdapter
    await newAdapter.initialize(token)
    setState('ready')

    scheduleTokenRefresh(ttl, provider)
  } catch (err) {
    log('Init failed:', err instanceof Error ? err.message : 'unknown')
    if (err instanceof Error && isSFrameHookFailure(err)) {
      setE2eeStatus('unavailable', 'sframe_init_failed')
    }
    setState('error', err instanceof Error ? err.message : 'WebRTC initialization failed')
  }
}

/**
 * Accept an incoming WebRTC call.
 */
export function acceptCall(): void {
  if (!adapter || !incomingCallSid) return
  const sid = incomingCallSid
  adapter.accept(sid).catch((err: unknown) => {
    log('acceptCall error:', err instanceof Error ? err.message : 'unknown')
  })
}

/**
 * Reject/decline an incoming WebRTC call.
 */
export function rejectCall(): void {
  if (!adapter || !incomingCallSid) return
  const sid = incomingCallSid
  incomingCallSid = null
  adapter.reject(sid).catch((err: unknown) => {
    log('rejectCall error:', err instanceof Error ? err.message : 'unknown')
  })
  setState('ready')
}

/**
 * Hang up the current WebRTC call.
 */
export function hangupCall(): void {
  if (!adapter) return
  incomingCallSid = null
  adapter.disconnect()
  // State transition to 'ended' (→ 'ready') will come from the 'disconnected' event.
  // If no event fires (e.g. already idle), force it.
  if (currentState === 'connected' || currentState === 'ringing') {
    setState('ended')
  }
}

/**
 * Toggle mute on the current WebRTC call. Returns the new muted state.
 */
export function toggleMute(): boolean {
  if (!adapter) return false
  const newMuted = !adapter.isMuted()
  adapter.setMuted(newMuted)
  return newMuted
}

/**
 * Check whether the current call is muted.
 */
export function isMuted(): boolean {
  return adapter?.isMuted() ?? false
}

/**
 * Clean up all WebRTC resources and return to idle.
 */
export function destroyWebRtc(): void {
  clearRefreshTimer()
  if (adapter) {
    adapter.destroy()
    adapter = null
  }
  currentProvider = null
  incomingCallSid = null
  // Release per-manager SFrame bindings. The worker singleton itself is NOT
  // terminated here — other tabs / future inits can reuse it.
  degradedUnsubscribe?.()
  degradedUnsubscribe = null
  sframeClient = null
  if (e2eeDegraded) setE2eeDegraded(null)
  setE2eeStatus('unknown')
  setState('idle')
}

/**
 * Whether WebRTC is currently in an active call.
 */
export function isConnected(): boolean {
  return currentState === 'connected'
}

/**
 * Whether there is an incoming call waiting to be answered/rejected.
 */
export function hasIncomingCall(): boolean {
  return currentState === 'ringing' && incomingCallSid !== null
}
