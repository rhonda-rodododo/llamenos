export type WebRtcState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'error'

export type WebRtcEvent = 'incoming' | 'connected' | 'disconnected' | 'error'

export type WebRtcEventHandler<E extends WebRtcEvent> = E extends 'incoming'
  ? (callSid: string) => void
  : E extends 'connected'
    ? () => void
    : E extends 'disconnected'
      ? () => void
      : E extends 'error'
        ? (error: Error) => void
        : never

export interface WebRTCAdapter {
  initialize(token: string): Promise<void>
  accept(callSid: string): Promise<void>
  reject(callSid: string): Promise<void>
  disconnect(): void
  setMuted(muted: boolean): void
  isMuted(): boolean
  on<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void
  off<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void
  destroy(): void
}

interface WebRTCManagerConfig {
  provider: string
  token: string
  ttl: number // seconds
  identity: string
}

export type StateChangeHandler = (state: WebRtcState, error?: string) => void
