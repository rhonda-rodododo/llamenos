/**
 * TwilioWebRTCAdapter — implements WebRTCAdapter using the @twilio/voice-sdk.
 *
 * Loaded via dynamic import so the SDK bundle is only fetched when
 * WebRTC is actually used. The adapter emits typed events that the
 * provider-agnostic WebRTC manager listens to.
 */

import { createDebugLog } from '../../debug-log'
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

const log = createDebugLog('llamenos:webrtc:twilio')

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

      conn.on('accept', () => {
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
