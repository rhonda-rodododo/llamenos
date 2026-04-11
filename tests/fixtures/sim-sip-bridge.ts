/**
 * SimSipBridge — in-memory test fixture that simulates the Asterisk ARI
 * WebSocket event bus and RTP media plane.
 *
 * Pure TypeScript, zero kernel sockets, no production imports. Designed to
 * drop into bun:test unit tests and Playwright API/UI tests where the code
 * under test needs a fake PBX that:
 *
 *   - Accepts endpoint provisioning + deprovisioning (ARI `endpoints` API).
 *   - Accepts dialplan-event injection (`inject`) that fans out ARI
 *     channel lifecycle events (`channel_create` → `channel_answer`).
 *   - Bridges RTP bytes between the caller and volunteer legs with
 *     capture for assertions like "bridge never saw plaintext" (Tier 5
 *     adversarial tests) and "RTP flowed in both directions" (Tier 3/4
 *     call-path tests).
 *
 * This fixture is framework-agnostic (no Playwright imports) and can be
 * reused across tiers. SFrame-specific helpers intentionally live
 * elsewhere — see `tests/helpers/sframe-test-utils.ts`.
 *
 * Related: Tier 5 spec §5.12.1, Tier 5 plan Workstream 5.8 Task 18.
 */

export type SimBridgeEvent =
  | ChannelCreateEvent
  | ChannelAnswerEvent
  | ChannelHangupEvent
  | DtmfReceivedEvent
  | PlaybackFinishedEvent

export interface ChannelCreateEvent {
  type: 'channel_create'
  channelId: string
  callerNumber: string
  calledNumber: string
  /** Stasis args — e.g. ['sframe'] or ['pstn']. Matches production ARI shape. */
  args?: string[]
  timestamp: string
}

export interface ChannelAnswerEvent {
  type: 'channel_answer'
  channelId: string
  timestamp: string
}

export interface ChannelHangupEvent {
  type: 'channel_hangup'
  channelId: string
  /** SIP cause code (16 = normal, 17 = busy, 19 = no answer, 21 = rejected). */
  cause: number
  causeText: string
  timestamp: string
}

export interface DtmfReceivedEvent {
  type: 'dtmf_received'
  channelId: string
  digit: string
  durationMs: number
  timestamp: string
}

export interface PlaybackFinishedEvent {
  type: 'playback_finished'
  channelId: string
  playbackId: string
  timestamp: string
}

export type CallMode = 'sframe' | 'pstn'

export interface InjectParams {
  callId: string
  callerNumber: string
  calledNumber: string
  mode: CallMode
}

export interface EndpointCreds {
  username: string
  password: string
}

export interface CapturedPacket {
  direction: 'a-to-b' | 'b-to-a'
  bytes: Uint8Array
  time: number
}

export interface SimChannelState {
  id: string
  callerNumber: string
  calledNumber: string
  mode: CallMode
  state: 'ringing' | 'up' | 'down'
}

type EventHandler = (event: SimBridgeEvent) => void

let deterministicClock = 0
const now = (): string => new Date(Date.UTC(2026, 3, 11, 0, 0, deterministicClock++)).toISOString()

export class SimSipBridge {
  private endpoints = new Map<string, EndpointCreds>()
  private handlers: Set<EventHandler> = new Set()
  private channels = new Map<string, SimChannelState>()
  private captured: CapturedPacket[] = []
  private provisionCounter = 0

  // ---- Endpoint provisioning ----

  async provisionEndpoint(pubkey: string): Promise<EndpointCreds> {
    const existing = this.endpoints.get(pubkey)
    if (existing) return existing
    const username = `vol_${pubkey.slice(0, 12)}_${this.provisionCounter++}`
    // Deterministic hex password for test reproducibility — NOT a real credential.
    const password = `simpw_${username}_deadbeefcafef00d1234567890abcdef`
    const creds: EndpointCreds = { username, password }
    this.endpoints.set(pubkey, creds)
    return creds
  }

  async deprovisionEndpoint(pubkey: string): Promise<void> {
    this.endpoints.delete(pubkey)
  }

  getEndpoint(pubkey: string): EndpointCreds | undefined {
    return this.endpoints.get(pubkey)
  }

  // ---- Event bus (mocks the ARI WebSocket subscriber pattern) ----

  onEvent(handler: EventHandler): void {
    this.handlers.add(handler)
  }

  off(handler: EventHandler): void {
    this.handlers.delete(handler)
  }

  emit(event: SimBridgeEvent): void {
    for (const handler of this.handlers) {
      handler(event)
    }
  }

  // ---- Dialplan simulation ----

  /**
   * Simulate an inbound call arriving at the PBX: channel_create fires,
   * followed immediately by channel_answer. Real Asterisk would have a
   * ringing gap; tests that need one should emit their own intermediate
   * events after a setTimeout.
   */
  async inject(params: InjectParams): Promise<void> {
    this.channels.set(params.callId, {
      id: params.callId,
      callerNumber: params.callerNumber,
      calledNumber: params.calledNumber,
      mode: params.mode,
      state: 'up',
    })
    this.emit({
      type: 'channel_create',
      channelId: params.callId,
      callerNumber: params.callerNumber,
      calledNumber: params.calledNumber,
      args: [params.mode],
      timestamp: now(),
    })
    this.emit({
      type: 'channel_answer',
      channelId: params.callId,
      timestamp: now(),
    })
  }

  async hangup(callId: string, cause: number, causeText: string): Promise<void> {
    const channel = this.channels.get(callId)
    if (!channel) return
    channel.state = 'down'
    this.channels.delete(callId)
    this.emit({
      type: 'channel_hangup',
      channelId: callId,
      cause,
      causeText,
      timestamp: now(),
    })
  }

  async sendDtmf(callId: string, digit: string, durationMs = 100): Promise<void> {
    this.emit({
      type: 'dtmf_received',
      channelId: callId,
      digit,
      durationMs,
      timestamp: now(),
    })
  }

  // ---- Media plane (RTP bridging) ----

  /**
   * B2BUA pass-through. Records every byte in `captured` so tests can
   * assert "the bridge only ever saw ciphertext" (Tier 5) or "RTP flowed
   * bidirectionally" (Tier 3/4 call-path tests). Returns the same bytes
   * unmodified — the real Asterisk volunteers-sframe context is Opus-only
   * passthrough and does no transcoding.
   */
  bridgePacket(from: 'caller' | 'volunteer', bytes: Uint8Array): Uint8Array {
    this.captured.push({
      direction: from === 'caller' ? 'a-to-b' : 'b-to-a',
      bytes: new Uint8Array(bytes),
      time: Date.now(),
    })
    return bytes
  }

  getCapturedPackets(): CapturedPacket[] {
    return this.captured.map((p) => ({ ...p, bytes: new Uint8Array(p.bytes) }))
  }

  clear(): void {
    this.captured = []
  }

  // ---- State introspection ----

  getChannels(): SimChannelState[] {
    return [...this.channels.values()]
  }
}
