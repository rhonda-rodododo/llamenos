/**
 * VonageWebRTCAdapter — implements WebRTCAdapter using the @vonage/client-sdk.
 *
 * Loaded via dynamic import so the SDK bundle is only fetched when
 * WebRTC is actually used. The adapter emits typed events that the
 * provider-agnostic WebRTC manager listens to.
 */

import { createDebugLog } from '../../debug-log'
import type { SFrameCapableAdapterOptions, SFramePeerConnectionHook } from '../sframe-hook-types'
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

const log = createDebugLog('llamenos:webrtc:vonage')

/** Constructor options for {@link VonageWebRTCAdapter}. */
type VonageWebRTCAdapterOptions = SFrameCapableAdapterOptions

// Minimal types from @vonage/client-sdk
interface VonageClientInstance {
  createSession: (token: string) => Promise<string>
  on: (event: string, handler: (...args: unknown[]) => void) => void
  answer: (callId: string) => Promise<void>
  reject: (callId: string) => Promise<void>
  hangup: (callId: string) => Promise<void>
  mute: (callId: string) => Promise<void>
  unmute: (callId: string) => Promise<void>
}

export class VonageWebRTCAdapter implements WebRTCAdapter {
  #client: VonageClientInstance | null = null
  #activeCallId: string | null = null
  #muted = false
  #handlers: Map<WebRtcEvent, Set<WebRtcEventHandler<WebRtcEvent>>> = new Map()
  readonly #sframeHook: SFramePeerConnectionHook | undefined

  constructor(options: VonageWebRTCAdapterOptions = {}) {
    this.#sframeHook = options.sframeHook
  }

  // ---------------------------------------------------------------------------
  // Event bus
  // ---------------------------------------------------------------------------

  on<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set())
    }
    this.#handlers.get(event)?.add(handler as WebRtcEventHandler<WebRtcEvent>)
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
    const sdkModule = '@vonage/client-sdk'
    const { VonageClient } = (await import(/* @vite-ignore */ sdkModule)) as {
      VonageClient: new () => VonageClientInstance
    }

    const client = new VonageClient()

    client.on('callInvite', (...args: unknown[]) => {
      const callId = args[0] as string
      const from = args[1] as string
      log('Incoming call', callId, 'from-present:', !!from)
      this.#activeCallId = callId
      this.#muted = false
      this.#emit('incoming', callId)
    })

    client.on('callHangup', (...args: unknown[]) => {
      const callId = args[0] as string
      log('Call hangup', callId)
      if (this.#activeCallId === callId) {
        this.#activeCallId = null
        this.#muted = false
      }
      this.#emit('disconnected')
    })

    client.on('callInviteCancel', (...args: unknown[]) => {
      const callId = args[0] as string
      const reason = args[1]
      log('Call invite cancelled', callId, reason)
      if (this.#activeCallId === callId) {
        this.#activeCallId = null
        this.#muted = false
      }
      this.#emit('disconnected')
    })

    this.#client = client
    await client.createSession(token)
    log('Session created')

    // callHangup/callInviteCancel don't signal 'connected' — we emit that on accept
  }

  // ---------------------------------------------------------------------------
  // Call control
  // ---------------------------------------------------------------------------

  async accept(callId: string): Promise<void> {
    if (!this.#client) return
    await this.#client.answer(callId)
    this.#activeCallId = callId
    this.#emit('connected')
  }

  async reject(callId: string): Promise<void> {
    if (!this.#client) return
    await this.#client.reject(callId)
    if (this.#activeCallId === callId) {
      this.#activeCallId = null
    }
  }

  disconnect(): void {
    if (!this.#client || !this.#activeCallId) return
    const callId = this.#activeCallId
    this.#activeCallId = null
    this.#muted = false
    // Fire-and-forget; errors logged but not surfaced (disconnect is best-effort)
    this.#client.hangup(callId).catch((err: unknown) => {
      log('hangup error', err instanceof Error ? err.message : 'unknown')
    })
  }

  setMuted(muted: boolean): void {
    if (!this.#client || !this.#activeCallId) return
    const callId = this.#activeCallId
    this.#muted = muted
    const op = muted ? this.#client.mute(callId) : this.#client.unmute(callId)
    op.catch((err: unknown) => {
      log('setMuted error', err instanceof Error ? err.message : 'unknown')
    })
  }

  isMuted(): boolean {
    return this.#muted
  }

  destroy(): void {
    if (this.#client && this.#activeCallId) {
      this.#client.hangup(this.#activeCallId).catch(() => {})
      this.#activeCallId = null
    }
    this.#client = null
    this.#muted = false
    this.#handlers.clear()
  }
}
