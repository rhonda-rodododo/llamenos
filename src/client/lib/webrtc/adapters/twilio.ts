/**
 * TwilioWebRTCAdapter — implements WebRTCAdapter using the @twilio/voice-sdk.
 *
 * Loaded via dynamic import so the SDK bundle is only fetched when
 * WebRTC is actually used. The adapter emits typed events that the
 * provider-agnostic WebRTC manager listens to.
 */

import { createDebugLog } from '../../debug-log'
import type { SFrameCapableAdapterOptions, SFramePeerConnectionHook } from '../sframe-hook-types'
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

const log = createDebugLog('llamenos:webrtc:twilio')

/** Constructor options for {@link TwilioWebRTCAdapter}. */
type TwilioWebRTCAdapterOptions = SFrameCapableAdapterOptions

// Minimal types we need from @twilio/voice-sdk
interface TwilioDevice {
  register: () => Promise<void>
  unregister: () => Promise<void>
  on: (event: string, handler: (...args: unknown[]) => void) => void
  destroy: () => void
  updateToken: (token: string) => void
  state: string
}

interface TwilioConnection {
  accept: () => void
  reject: () => void
  disconnect: () => void
  mute: (muted?: boolean) => void
  isMuted: () => boolean
  on: (event: string, handler: (...args: unknown[]) => void) => void
  parameters: Record<string, string>
  status: () => string
}

export class TwilioWebRTCAdapter implements WebRTCAdapter {
  #device: TwilioDevice | null = null
  #activeConnection: TwilioConnection | null = null
  #handlers: Map<WebRtcEvent, Set<WebRtcEventHandler<WebRtcEvent>>> = new Map()
  readonly #sframeHook: SFramePeerConnectionHook | undefined

  constructor(options: TwilioWebRTCAdapterOptions = {}) {
    this.#sframeHook = options.sframeHook
  }

  /**
   * Best-effort extraction of the underlying `RTCPeerConnection` from a Twilio
   * Voice SDK Call. The SDK exposes it at `call.mediaHandler.version.pc` in
   * current releases, but the field is internal/undocumented — guarded against
   * shape changes.
   */
  #pcFromConnection(conn: TwilioConnection): RTCPeerConnection | null {
    const holder = conn as unknown as {
      mediaHandler?: { version?: { pc?: RTCPeerConnection } }
    }
    return holder.mediaHandler?.version?.pc ?? null
  }

  /**
   * Invoke the SFrame hook against a pc for the given Twilio call. Failures
   * surface as 'error' events and disconnect the call.
   */
  #installHook(pc: RTCPeerConnection, callSid: string): void {
    const hook = this.#sframeHook
    if (!hook) return
    void Promise.resolve(hook(pc, { callId: callSid, direction: 'inbound' })).catch((err) => {
      this.#emit('error', err instanceof Error ? err : new Error(String(err)))
      try {
        pc.close()
      } catch {
        /* best-effort */
      }
      this.#activeConnection?.disconnect()
      this.#activeConnection = null
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
    // Variable prevents TypeScript/Vite from resolving at compile time.
    const sdkModule = '@twilio/voice-sdk'
    const { Device } = (await import(/* @vite-ignore */ sdkModule)) as {
      Device: new (token: string, opts: Record<string, unknown>) => TwilioDevice
    }

    const device = new Device(token, {
      closeProtection: true,
      codecPreferences: ['opus', 'pcmu'],
    })

    device.on('registered', () => {
      log('Device registered')
    })

    device.on('unregistered', () => {
      log('Device unregistered')
    })

    device.on('error', (...args: unknown[]) => {
      const err = args[0] as { message?: string } | undefined
      log('Device error:', err?.message)
      this.#emit('error', new Error(err?.message ?? 'Twilio Device error'))
    })

    device.on('incoming', (...args: unknown[]) => {
      const conn = args[0] as TwilioConnection
      const callSid = conn.parameters.CallSid ?? ''
      log('Incoming call', callSid)
      this.#activeConnection = conn

      // SFrame hook installation point. The underlying pc usually does not
      // exist until accept() runs and the media handler is created. The
      // 'incoming' event is the *early* probe: we do NOT fail-closed here
      // because Twilio's media handler is intentionally null until accept()
      // runs. The fail-closed gate runs on 'accept' below — if pc is still
      // null at that point, the SDK shape has changed and we cannot install
      // SFrame, so the call is refused per Tier 5 P1 requirements.
      const earlyPc = this.#pcFromConnection(conn)
      if (earlyPc) this.#installHook(earlyPc, callSid)

      conn.on('accept', () => {
        const pc = this.#pcFromConnection(conn)
        if (this.#sframeHook && !pc) {
          // Tier 5 P1 fail-closed: a hook was provided but the SDK no longer
          // exposes the pc at the documented path. Refuse to proceed because
          // we cannot install SFrame — silently continuing would land an
          // unencrypted call while the UI claims E2EE.
          const err = new Error('twilio adapter cannot install SFrame hook on accept: pc is null')
          this.#emit('error', err)
          try {
            conn.disconnect()
          } catch {
            /* best-effort */
          }
          this.#activeConnection = null
          return
        }
        if (pc) this.#installHook(pc, callSid)
        this.#emit('connected')
      })

      conn.on('disconnect', () => {
        this.#activeConnection = null
        this.#emit('disconnected')
      })

      conn.on('reject', () => {
        this.#activeConnection = null
        this.#emit('disconnected')
      })

      this.#emit('incoming', callSid)
    })

    this.#device = device
    await device.register()
  }

  // ---------------------------------------------------------------------------
  // Call control
  // ---------------------------------------------------------------------------

  async accept(_callSid: string): Promise<void> {
    this.#activeConnection?.accept()
  }

  async reject(_callSid: string): Promise<void> {
    this.#activeConnection?.reject()
    this.#activeConnection = null
  }

  disconnect(): void {
    this.#activeConnection?.disconnect()
    this.#activeConnection = null
  }

  setMuted(muted: boolean): void {
    this.#activeConnection?.mute(muted)
  }

  isMuted(): boolean {
    return this.#activeConnection?.isMuted() ?? false
  }

  destroy(): void {
    if (this.#activeConnection) {
      this.#activeConnection.disconnect()
      this.#activeConnection = null
    }
    if (this.#device) {
      this.#device.destroy()
      this.#device = null
    }
    this.#handlers.clear()
  }

  // ---------------------------------------------------------------------------
  // Twilio-specific
  // ---------------------------------------------------------------------------

  /** Refresh the Twilio access token before it expires. */
  updateToken(token: string): void {
    this.#device?.updateToken(token)
  }
}
