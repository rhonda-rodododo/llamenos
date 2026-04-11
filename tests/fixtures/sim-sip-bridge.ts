/**
 * SimSipBridge — in-memory test fixture that simulates the Asterisk ARI
 * WebSocket event bus and RTP media plane.
 *
 * Pure TypeScript, zero kernel sockets. Designed to drop into bun:test
 * unit tests and Playwright API/UI tests where the code under test needs
 * a fake PBX that:
 *
 *   - Accepts endpoint provisioning + deprovisioning (ARI `endpoints` API).
 *   - Accepts dialplan-event injection (`inject`) that fans out ARI
 *     channel lifecycle events (`channel_create` → `channel_answer`).
 *   - Bridges RTP bytes between the caller and volunteer legs with
 *     capture for assertions like "the bridge never saw plaintext" and
 *     "RTP flowed in both directions". The bridge is a pass-through by
 *     default; adversarial subclasses (e.g. `SimCompromisedBridge` in
 *     Tier 5 main) override `bridgePacket` to return `null` on drops
 *     or return mutated bytes for tampering tests — which is why the
 *     base return type is `Uint8Array | null` per spec §5.12.1.
 *
 * This fixture is framework-agnostic (no Playwright imports) and can be
 * reused across tiers. SFrame-specific helpers live elsewhere — see
 * `tests/helpers/sframe-test-utils.ts`.
 *
 * **Event-type reconciliation:** `SimBridgeEvent` is a subset of the
 * production `BridgeEvent` union from `sip-bridge/src/bridge-client.ts`
 * (the five channel-lifecycle variants — no recording variants, since
 * the SFrame dialplan forbids Asterisk-side recording). Importing the
 * production types rather than duplicating them means any widening of
 * the production shape surfaces here at compile time and cannot drift
 * silently.
 */

import type {
  ChannelAnswerEvent,
  ChannelCreateEvent,
  ChannelHangupEvent,
  DtmfReceivedEvent,
  PlaybackFinishedEvent,
} from '../../sip-bridge/src/bridge-client'

export type {
  ChannelAnswerEvent,
  ChannelCreateEvent,
  ChannelHangupEvent,
  DtmfReceivedEvent,
  PlaybackFinishedEvent,
}

export type SimBridgeEvent =
  | ChannelCreateEvent
  | ChannelAnswerEvent
  | ChannelHangupEvent
  | DtmfReceivedEvent
  | PlaybackFinishedEvent

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

/**
 * Deterministic clock start instant — 2026-04-11T00:00:00Z. Every
 * emitted event advances the per-instance counter by one second, so
 * event N on a fresh bridge has timestamp `2026-04-11T00:00:NZ` and
 * rolls into the next minute after 60 events.
 */
const CLOCK_START_YEAR = 2026
const CLOCK_START_MONTH = 3 // Date.UTC is 0-indexed — 3 = April
const CLOCK_START_DAY = 11

export class SimSipBridge {
  private endpoints = new Map<string, EndpointCreds>()
  private handlers: Set<EventHandler> = new Set()
  private channels = new Map<string, SimChannelState>()
  private captured: CapturedPacket[] = []
  private provisionCounter = 0
  private deterministicClock = 0

  private now(): string {
    return new Date(
      Date.UTC(
        CLOCK_START_YEAR,
        CLOCK_START_MONTH,
        CLOCK_START_DAY,
        0,
        0,
        this.deterministicClock++
      )
    ).toISOString()
  }

  // ---- Endpoint provisioning ----

  async provisionEndpoint(pubkey: string): Promise<EndpointCreds> {
    const existing = this.endpoints.get(pubkey)
    if (existing) return existing
    const username = `vol_${pubkey.slice(0, 12)}_${this.provisionCounter++}`
    // Deterministic placeholder — NOT a real credential; do not lift this
    // format into production.
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

  /**
   * Fan out an event to every subscribed handler. Handlers are snapshotted
   * before iteration so a mid-fanout subscription does not change the set
   * of recipients for the current event. Errors from individual handlers
   * are collected and surfaced as an `AggregateError` after the loop so
   * that one misbehaving subscriber cannot silently suppress delivery to
   * the others — a common source of order-dependent test flakiness.
   */
  emit(event: SimBridgeEvent): void {
    const snapshot = [...this.handlers]
    const errors: unknown[] = []
    for (const handler of snapshot) {
      try {
        handler(event)
      } catch (err) {
        errors.push(err)
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'SimSipBridge.emit: one or more subscribers threw')
    }
  }

  // ---- Dialplan simulation ----

  /**
   * Simulate an inbound call arriving at the PBX: channel_create fires,
   * followed immediately by channel_answer. Throws if the callId already
   * has an active channel — Asterisk would never double-create, so
   * silently overwriting would only mask test bugs. Tests that legitimately
   * need to re-use a callId must `hangup` first.
   */
  async inject(params: InjectParams): Promise<void> {
    if (this.channels.has(params.callId)) {
      throw new Error(
        `SimSipBridge.inject: callId ${params.callId} is already active — call hangup() first`
      )
    }
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
      timestamp: this.now(),
    })
    this.emit({
      type: 'channel_answer',
      channelId: params.callId,
      timestamp: this.now(),
    })
  }

  /**
   * Hang up an active channel. Throws if the channelId is unknown — real
   * Asterisk returns ARI 404 on unknown-channel hangup, and silently
   * returning here would mask tests that typo a callId or double-hangup.
   */
  async hangup(callId: string, cause: number, causeText: string): Promise<void> {
    if (!this.channels.has(callId)) {
      throw new Error(`SimSipBridge.hangup: unknown channelId ${callId}`)
    }
    this.channels.delete(callId)
    this.emit({
      type: 'channel_hangup',
      channelId: callId,
      cause,
      causeText,
      timestamp: this.now(),
    })
  }

  async sendDtmf(callId: string, digit: string, durationMs = 100): Promise<void> {
    if (!this.channels.has(callId)) {
      throw new Error(`SimSipBridge.sendDtmf: unknown channelId ${callId}`)
    }
    this.emit({
      type: 'dtmf_received',
      channelId: callId,
      digit,
      durationMs,
      timestamp: this.now(),
    })
  }

  // ---- Media plane (RTP bridging) ----

  /**
   * Back-to-back user agent (B2BUA) pass-through. The base class records
   * every byte in `captured` and returns the input unmodified — the real
   * Asterisk volunteers-sframe context is Opus-only passthrough and does
   * no transcoding.
   *
   * The `Uint8Array | null` return type exists so adversarial subclasses
   * (`SimCompromisedBridge` in Tier 5 main) can return `null` to model a
   * dropped packet without changing the base-class contract — see spec
   * §5.12.1. The base class never drops; tests that want to assert drop
   * semantics must use a subclass.
   */
  bridgePacket(from: 'caller' | 'volunteer', bytes: Uint8Array): Uint8Array | null {
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

  getChannels(): readonly Readonly<SimChannelState>[] {
    return [...this.channels.values()]
  }
}

export { CLOCK_START_DAY, CLOCK_START_MONTH, CLOCK_START_YEAR }
