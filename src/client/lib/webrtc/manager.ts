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
import type { StateChangeHandler, WebRTCAdapter, WebRtcState } from './types'

// Re-export types consumed by other modules
export type { StateChangeHandler, WebRtcState }

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let currentState: WebRtcState = 'idle'
const stateHandlers = new Set<StateChangeHandler>()

let adapter: WebRTCAdapter | null = null
let currentProvider: string | null = null
let incomingCallSid: string | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

function createAdapter(provider: string): WebRTCAdapter {
  switch (provider) {
    case 'twilio':
    case 'signalwire':
      return new TwilioWebRTCAdapter()
    case 'vonage':
      return new VonageWebRTCAdapter()
    case 'plivo':
      return new PlivoWebRTCAdapter()
    case 'asterisk':
    case 'freeswitch':
    case 'kamailio':
    case 'sip':
      return new SipWebRTCAdapter()
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

    const newAdapter = createAdapter(provider)

    // Wire adapter events → state machine
    newAdapter.on('incoming', (callSid) => {
      log('Incoming call', callSid)
      incomingCallSid = callSid
      setState('ringing')
    })

    newAdapter.on('connected', () => {
      log('Call connected')
      setState('connected')
    })

    newAdapter.on('disconnected', () => {
      log('Call disconnected')
      incomingCallSid = null
      setState('ended')
    })

    newAdapter.on('error', (err) => {
      log('Adapter error:', err.message)
      setState('error', err.message)
    })

    adapter = newAdapter
    await newAdapter.initialize(token)
    setState('ready')

    scheduleTokenRefresh(ttl, provider)
  } catch (err) {
    log('Init failed:', err instanceof Error ? err.message : 'unknown')
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
