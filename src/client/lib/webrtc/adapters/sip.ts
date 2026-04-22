/**
 * SipWebRTCAdapter — implements WebRTCAdapter using JsSIP for browser SIP/WebRTC calling.
 *
 * Loaded via dynamic import so the JsSIP bundle is only fetched when
 * SIP-based providers (Asterisk, FreeSWITCH) are actually used.
 * The token is a base64-encoded JSON payload containing SIP credentials.
 */

import type { SFrameCapableAdapterOptions, SFramePeerConnectionHook } from '../sframe-hook-types'
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

/** Decoded from the base64 token passed to initialize(). */
export interface SipTokenPayload {
  wsUri: string
  sipUri: string
  password: string
  iceServers: RTCIceServer[]
}

/** Constructor options for {@link SipWebRTCAdapter}. */
type SipWebRTCAdapterOptions = SFrameCapableAdapterOptions

// Minimal JsSIP interfaces — JsSIP ships .d.ts but we only need a subset.
interface JsSIPUA {
  start(): void
  stop(): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface JsSIPRTCSession {
  answer(opts?: unknown): void
  terminate(opts?: unknown): void
  mute(opts?: unknown): void
  unmute(opts?: unknown): void
  isMuted(): { audio: boolean; video: boolean }
  remote_identity?: { uri?: { user?: string } }
  on(event: string, handler: (...args: unknown[]) => void): void
}

export class SipWebRTCAdapter implements WebRTCAdapter {
  #ua: JsSIPUA | null = null
  #session: JsSIPRTCSession | null = null
  #handlers: Map<WebRtcEvent, Set<WebRtcEventHandler<WebRtcEvent>>> = new Map()
  #iceServers: RTCIceServer[] = []
  readonly #sframeHook: SFramePeerConnectionHook | undefined

  constructor(options: SipWebRTCAdapterOptions = {}) {
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
    const config: SipTokenPayload = JSON.parse(atob(token))
    this.#iceServers = config.iceServers

    // Dynamic import — only loads when SIP WebRTC is actually used.
    const sdkModule = 'jssip'
    const JsSIP = (await import(/* @vite-ignore */ sdkModule)) as {
      WebSocketInterface: new (url: string) => unknown
      UA: new (config: Record<string, unknown>) => JsSIPUA
    }

    const socket = new JsSIP.WebSocketInterface(config.wsUri)
    const ua = new JsSIP.UA({
      sockets: [socket],
      uri: config.sipUri,
      password: config.password,
      register: true,
      register_expires: 600,
      session_timers: false,
      user_agent: 'Hotline/1.0',
    })

    this.#ua = ua

    // Registration failed — emit error
    ua.on('registrationFailed', (...args: unknown[]) => {
      const data = args[0] as { cause?: string } | undefined
      this.#emit('error', new Error(`SIP registration failed: ${data?.cause ?? 'unknown'}`))
    })

    // WSS disconnect — network loss
    ua.on('disconnected', () => {
      this.#emit('error', new Error('SIP WebSocket disconnected'))
    })

    // Incoming call handling
    ua.on('newRTCSession', (...args: unknown[]) => {
      const data = args[0] as {
        originator: string
        session: JsSIPRTCSession
      }

      // Only handle incoming calls
      if (data.originator !== 'remote') return

      // If already in a session, reject with 486 Busy Here
      if (this.#session) {
        data.session.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
        return
      }

      const session = data.session
      this.#session = session

      // Derive a call ID from the remote identity or fallback
      const callSid = session.remote_identity?.uri?.user ?? 'unknown'

      session.on('accepted', () => {
        this.#emit('connected')
      })

      session.on('ended', () => {
        this.#session = null
        this.#emit('disconnected')
      })

      session.on('failed', () => {
        this.#session = null
        this.#emit('error', new Error('SIP session failed'))
      })

      // SFrame hook: when JsSIP exposes the underlying RTCPeerConnection
      // (pre-answer), invoke the caller-provided installer so SFrame transforms
      // can be attached to senders/receivers and the DTLS binding verified
      // before any media flows. Failures terminate the session.
      session.on('peerconnection', (...pcArgs: unknown[]) => {
        const data = pcArgs[0] as { peerconnection?: RTCPeerConnection } | undefined
        const pc = data?.peerconnection
        if (!pc) return
        const hook = this.#sframeHook
        if (!hook) return
        void Promise.resolve(hook(pc, { callId: callSid, direction: 'inbound' })).catch((err) => {
          this.#emit('error', err instanceof Error ? err : new Error(String(err)))
          try {
            pc.close()
          } catch {
            /* best-effort */
          }
          session.terminate({ status_code: 480, reason_phrase: 'SFrame setup failed' })
        })
      })

      this.#emit('incoming', callSid)
    })

    // Start the UA and wait for initial registration
    ua.start()

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const onRegistered = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      const onFailed = (...args: unknown[]) => {
        if (!settled) {
          settled = true
          const data = args[0] as { cause?: string } | undefined
          reject(new Error(`SIP initial registration failed: ${data?.cause ?? 'unknown'}`))
        }
      }
      ua.on('registered', onRegistered)
      ua.on('registrationFailed', onFailed)
    })
  }

  // ---------------------------------------------------------------------------
  // Call control
  // ---------------------------------------------------------------------------

  async accept(_callSid: string): Promise<void> {
    this.#session?.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers: this.#iceServers,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      },
      rtcOfferConstraints: {
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      },
    })
  }

  async reject(_callSid: string): Promise<void> {
    this.#session?.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
    this.#session = null
  }

  disconnect(): void {
    this.#session?.terminate()
    this.#session = null
  }

  setMuted(muted: boolean): void {
    if (muted) {
      this.#session?.mute({ audio: true })
    } else {
      this.#session?.unmute({ audio: true })
    }
  }

  isMuted(): boolean {
    return this.#session?.isMuted()?.audio ?? false
  }

  destroy(): void {
    if (this.#session) {
      this.#session.terminate()
      this.#session = null
    }
    if (this.#ua) {
      this.#ua.stop()
      this.#ua = null
    }
    this.#handlers.clear()
  }
}
