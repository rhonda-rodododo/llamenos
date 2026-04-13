/**
 * PlivoWebRTCAdapter — implements WebRTCAdapter using the plivo-browser-sdk.
 *
 * Auth flow: The server generates a Plivo Access Token JWT (HS256, signed with
 * the Plivo auth token). The adapter passes this directly to
 * `client.loginWithAccessToken(token)` — the SDK parses the JWT to derive the
 * SIP username (`${sub}_${iss}`) and per.voice grants, then authenticates via
 * SIP registration.
 *
 * Loaded via dynamic import so the SDK bundle is only fetched when
 * WebRTC is actually used.
 */

import { createDebugLog } from '../../debug-log'
import type { SFrameCapableAdapterOptions, SFramePeerConnectionHook } from '../sframe-hook-types'
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

const log = createDebugLog('llamenos:webrtc:plivo')

/** Constructor options for {@link PlivoWebRTCAdapter}. */
export type PlivoWebRTCAdapterOptions = SFrameCapableAdapterOptions

// Minimal types from plivo-browser-sdk
interface PlivoClient {
  loginWithAccessToken: (token: string) => boolean
  logout: () => boolean
  answer: (callUUID: string, actionOnOtherIncomingCalls: string) => boolean
  reject: (callUUID: string) => boolean
  hangup: () => boolean
  mute: () => boolean
  unmute: () => boolean
  on: (event: string, handler: (...args: unknown[]) => void) => void
}

interface PlivoConstructor {
  new (options: Record<string, unknown>): { client: PlivoClient }
}

export class PlivoWebRTCAdapter implements WebRTCAdapter {
  #client: PlivoClient | null = null
  #activeCallUUID: string | null = null
  #muted = false
  #handlers: Map<WebRtcEvent, Set<WebRtcEventHandler<WebRtcEvent>>> = new Map()
  readonly #sframeHook: SFramePeerConnectionHook | undefined

  constructor(options: PlivoWebRTCAdapterOptions = {}) {
    this.#sframeHook = options.sframeHook
  }

  /**
   * Install SFrame transforms on a Plivo RTCPeerConnection. The
   * plivo-browser-sdk does not expose the underlying pc through a stable
   * public surface — this helper is the insertion point where a future
   * wiring pass will pipe the real pc reference into the caller-provided
   * hook. Until then, calling this with a valid pc runs the hook and
   * surfaces failures through the adapter's event bus.
   *
   * TODO(tier-5): locate the Plivo SDK accessor for the underlying
   * RTCPeerConnection (likely on the internal session object) and call
   * `installHook` from the same callback that creates it.
   */
  #installHook(pc: RTCPeerConnection, callUUID: string): void {
    const hook = this.#sframeHook
    if (!hook) return
    void Promise.resolve(hook(pc, { callId: callUUID, direction: 'inbound' })).catch((err) => {
      this.#emit('error', err instanceof Error ? err : new Error(String(err)))
      try {
        pc.close()
      } catch {
        /* best-effort */
      }
      this.disconnect()
    })
  }

  // ---------------------------------------------------------------------------
  // Event bus
  // ---------------------------------------------------------------------------

  on<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set())
    }
    this.#handlers.get(event)!.add(handler as WebRtcEventHandler<WebRtcEvent>)
  }

  off<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    this.#handlers.get(event)?.delete(handler as WebRtcEventHandler<WebRtcEvent>)
  }

  #emit<E extends WebRtcEvent>(event: E, ...args: Parameters<WebRtcEventHandler<E>>): void {
    const set = this.#handlers.get(event)
    if (!set) return
    for (const handler of set) {
      // biome-ignore lint/suspicious/noExplicitAny: variadic event args
      ;(handler as (...a: any[]) => void)(...args)
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(token: string): Promise<void> {
    // Dynamic import — only loads when WebRTC is actually used.
    const sdkModule = 'plivo-browser-sdk'
    const PlivoSdk = (await import(/* @vite-ignore */ sdkModule)) as {
      default: PlivoConstructor
    }

    const instance = new PlivoSdk.default({
      debug: 'ERROR',
      closeProtection: false,
    })
    const client = instance.client

    client.on('onLogin', () => {
      log('Logged in / registered')
    })

    client.on('onLoginFailed', (...args: unknown[]) => {
      const reason = args[0] as string | undefined
      log('Login failed', reason)
      this.#emit('error', new Error(`Plivo login failed: ${reason ?? 'unknown'}`))
    })

    client.on('onIncomingCall', (...args: unknown[]) => {
      // Plivo passes (callerName, extraHeaders, callInfo)
      // callInfo.callUUID holds the call identifier
      const callInfo = args[2] as { callUUID?: string } | undefined
      const callUUID = callInfo?.callUUID ?? (args[0] as string)
      log('Incoming call', callUUID)
      this.#activeCallUUID = callUUID
      this.#muted = false
      this.#emit('incoming', callUUID)
    })

    client.on('onCallAnswered', () => {
      log('Call answered / connected')
      this.#emit('connected')
    })

    client.on('onCallTerminated', () => {
      log('Call terminated')
      this.#activeCallUUID = null
      this.#muted = false
      this.#emit('disconnected')
    })

    client.on('onIncomingCallCanceled', () => {
      log('Incoming call cancelled')
      this.#activeCallUUID = null
      this.#muted = false
      this.#emit('disconnected')
    })

    this.#client = client

    // Auth: use the Plivo Access Token JWT generated server-side.
    // The SDK parses the JWT claims (iss, sub, per.voice) to set up SIP registration.
    client.loginWithAccessToken(token)
  }

  // ---------------------------------------------------------------------------
  // Call control
  // ---------------------------------------------------------------------------

  async accept(callUUID: string): Promise<void> {
    this.#client?.answer(callUUID, 'ignore')
  }

  async reject(callUUID: string): Promise<void> {
    this.#client?.reject(callUUID)
    if (this.#activeCallUUID === callUUID) {
      this.#activeCallUUID = null
    }
  }

  disconnect(): void {
    this.#client?.hangup()
    this.#activeCallUUID = null
    this.#muted = false
  }

  setMuted(muted: boolean): void {
    if (!this.#client) return
    this.#muted = muted
    if (muted) {
      this.#client.mute()
    } else {
      this.#client.unmute()
    }
  }

  isMuted(): boolean {
    return this.#muted
  }

  destroy(): void {
    if (this.#client) {
      if (this.#activeCallUUID) {
        this.#client.hangup()
        this.#activeCallUUID = null
      }
      this.#client.logout()
      this.#client = null
    }
    this.#muted = false
    this.#handlers.clear()
  }
}
