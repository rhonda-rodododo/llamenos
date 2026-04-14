/**
 * SimCaller — in-memory simulated inbound caller for IVR and call-path
 * tests.
 *
 * Holds a canned "Opus" payload (a deterministic byte pattern representing
 * a 440 Hz tone — real Opus encoding via ONNX or native bindings is too
 * heavy for CI, and the SFrame layer under test cares about per-frame byte
 * length, ordering, and "was this encrypted?" assertions, not codec
 * correctness). Drives the clip through a simple jitter buffer with
 * configurable inter-packet delay, and emits DTMF digits on demand.
 *
 * Additionally carries an optional SFrame-aware surface (Task 19b in the
 * Tier 5 main PR): `bindCall` stores a per-call secret + callId, `loadKey`
 * derives a per-(keyId) AES-GCM key for this device, `produceFrame` seals
 * a plaintext RTP payload into the wire-format ciphertext, and
 * `consumeFrame` opens a received wire frame and asserts the recovered
 * plaintext matches the expected bytes. The SFrame methods throw if the
 * caller has not yet been bound to a call or if the requested key has not
 * been loaded.
 */

import { deriveBaseKey, importAesKey } from '../../src/shared/sframe/cipher-suite.js'
import { openFrame, sealFrame } from '../../src/shared/sframe/frame-codec.js'
import type { CiphertextBytes } from '../../src/shared/sframe/sframe-types.js'

export const DTMF_DIGITS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '*',
  '#',
  'A',
  'B',
  'C',
  'D',
] as const

export type DtmfDigit = (typeof DTMF_DIGITS)[number]

const DTMF_DIGIT_SET = new Set<string>(DTMF_DIGITS)

function isDtmfDigit(value: string): value is DtmfDigit {
  return DTMF_DIGIT_SET.has(value)
}

export interface SimCallerOptions {
  /** Total clip duration in ms. Default: 2000. */
  clipDurationMs?: number
  /** Inter-packet delay in ms. Default: 20 (Opus default frame interval). */
  frameIntervalMs?: number
  /** Pure tone frequency in Hz — embedded in the stub payload for visibility. Default: 440. */
  toneHz?: number
}

type Rng = () => number

const FRAME_STUB_HEADER = 0xfc
const FRAME_STUB_PAYLOAD_LEN = 16

/**
 * Build a deterministic per-frame byte payload. Not real Opus — obviously
 * fake with a `0xfc` header sentinel so dumps are unambiguous. The payload
 * encodes the frame index and the configured tone frequency so tests can
 * still make meaningful assertions (e.g. "this caller carried 440 Hz").
 */
function buildStubFrame(index: number, toneHz: number): Uint8Array {
  const frame = new Uint8Array(FRAME_STUB_PAYLOAD_LEN)
  frame[0] = FRAME_STUB_HEADER
  // Big-endian tone frequency in bytes 1..2
  frame[1] = (toneHz >> 8) & 0xff
  frame[2] = toneHz & 0xff
  // Big-endian frame index in bytes 3..6
  frame[3] = (index >>> 24) & 0xff
  frame[4] = (index >>> 16) & 0xff
  frame[5] = (index >>> 8) & 0xff
  frame[6] = index & 0xff
  // Remaining bytes: deterministic fill derived from index
  for (let i = 7; i < FRAME_STUB_PAYLOAD_LEN; i++) {
    frame[i] = (index * 37 + i) & 0xff
  }
  return frame
}

export class SimCaller {
  readonly deviceId: string
  private readonly clipDurationMs: number
  private readonly frameIntervalMs: number
  private readonly toneHz: number

  private clipCursor = 0
  private framesSentCount = 0

  private jitterMs = 0
  private rng: Rng = Math.random

  private dtmfQueue: DtmfDigit[] = []
  private dtmfLifetimeCount = 0

  // ---- SFrame state (Task 19b) ----
  private callSecret?: Uint8Array
  private callId?: string
  private keys = new Map<number, CryptoKey>()

  constructor(deviceId: string, options: SimCallerOptions = {}) {
    this.deviceId = deviceId
    this.clipDurationMs = options.clipDurationMs ?? 2000
    this.frameIntervalMs = options.frameIntervalMs ?? 20
    this.toneHz = options.toneHz ?? 440
  }

  // ---- Clip playback ----

  totalFrames(): number {
    return Math.floor(this.clipDurationMs / this.frameIntervalMs)
  }

  nextFrame(): Uint8Array | null {
    if (this.clipCursor >= this.totalFrames()) return null
    const frame = buildStubFrame(this.clipCursor, this.toneHz)
    this.clipCursor++
    this.framesSentCount++
    return frame
  }

  getFramesSent(): number {
    return this.framesSentCount
  }

  // ---- Jitter buffer ----

  getFrameDelayMs(): number {
    return this.frameIntervalMs
  }

  setJitter(jitterMs: number): void {
    if (!Number.isFinite(jitterMs)) {
      throw new Error('jitter must be a finite number')
    }
    if (jitterMs < 0) throw new Error('jitter must be >= 0')
    if (jitterMs >= this.frameIntervalMs) {
      throw new Error('jitter must be strictly less than frameIntervalMs')
    }
    this.jitterMs = jitterMs
  }

  useRng(rng: Rng): void {
    this.rng = rng
  }

  nextFrameDelayMs(): number {
    if (this.jitterMs === 0) return this.frameIntervalMs
    const r = this.rng()
    if (!Number.isFinite(r) || r < 0 || r >= 1) {
      throw new Error(`SimCaller.rng must return a number in [0, 1), got ${r}`)
    }
    // Symmetric jitter: uniform in [-jitterMs, +jitterMs].
    const offset = (r * 2 - 1) * this.jitterMs
    return Math.round(this.frameIntervalMs + offset)
  }

  // ---- DTMF ----

  pressDigit(digit: DtmfDigit): void {
    if (!isDtmfDigit(digit)) {
      throw new Error(`invalid DTMF digit: ${String(digit)}`)
    }
    this.dtmfQueue.push(digit)
    this.dtmfLifetimeCount++
  }

  pressSequence(seq: string): void {
    for (const ch of seq) {
      if (/\s/.test(ch)) continue
      if (!isDtmfDigit(ch)) {
        throw new Error(`invalid DTMF digit in sequence: ${ch}`)
      }
      this.dtmfQueue.push(ch)
      this.dtmfLifetimeCount++
    }
  }

  drainDigits(): DtmfDigit[] {
    const drained = this.dtmfQueue
    this.dtmfQueue = []
    return drained
  }

  getDigitsEmitted(): number {
    return this.dtmfLifetimeCount
  }

  // ---- SFrame produce/consume (Task 19b) ----

  /**
   * Bind this caller to a specific call. Subsequent `loadKey` calls derive
   * their per-sender AES base key from `(callSecret, callId, deviceId)`.
   *
   * Throws if called twice with a different callId — callers should create
   * a new `SimCaller` per simulated call rather than rebinding in place.
   * Re-binding with the same callId (e.g. from test setup helpers) is a
   * no-op to keep test ergonomics simple.
   */
  bindCall(callSecret: Uint8Array, callId: string): void {
    if (this.callId !== undefined && this.callId !== callId) {
      throw new Error(
        `SimCaller.bindCall: already bound to callId ${this.callId}; cannot rebind to ${callId}`
      )
    }
    this.callSecret = callSecret
    this.callId = callId
  }

  /**
   * Derive the AES-GCM base key for `keyId` from the bound call secret and
   * cache it for subsequent `produceFrame` / `consumeFrame` calls. Throws
   * if `bindCall` has not been called.
   */
  async loadKey(keyId: number): Promise<void> {
    if (!this.callSecret || !this.callId) {
      throw new Error('SimCaller.loadKey: call bindCall(callSecret, callId) first')
    }
    const raw = deriveBaseKey(this.callSecret, this.callId, this.deviceId)
    const cryptoKey = await importAesKey(raw)
    this.keys.set(keyId, cryptoKey)
  }

  /**
   * Seal a plaintext RTP payload into wire-format ciphertext under the
   * previously-loaded `keyId`. The resulting `CiphertextBytes` can be
   * handed directly to `SimSipBridge.bridgePacket` or to another
   * `SimCaller.consumeFrame`.
   */
  async produceFrame(
    plaintext: Uint8Array,
    keyId: number,
    counter: number,
    ssrc = 1,
    rtpTimestamp = 0
  ): Promise<CiphertextBytes> {
    if (!this.callId) {
      throw new Error('SimCaller.produceFrame: call bindCall(callSecret, callId) first')
    }
    const key = this.keys.get(keyId)
    if (!key) {
      throw new Error(`SimCaller.produceFrame: key ${keyId} not loaded — call loadKey() first`)
    }
    return sealFrame(plaintext, key, {
      callId: this.callId,
      senderId: this.deviceId,
      keyId,
      counter,
      ssrc,
      rtpTimestamp,
    })
  }

  /**
   * Open a wire frame produced by `senderId` and assert its plaintext
   * matches `expected`. Returns `true` on success; throws on AES-GCM
   * authentication failure or plaintext mismatch so that adversarial
   * tests can rely on `.rejects.toThrow()` semantics.
   *
   * The `_counter` parameter is currently unused — counter tracking is
   * the receiver pipeline's responsibility, not this fixture's — but is
   * kept in the signature so call sites can document their intent and
   * future-proof against Workstream 5.9 tightening.
   */
  async consumeFrame(
    wire: CiphertextBytes,
    expected: Uint8Array,
    keyId: number,
    _counter: number,
    senderId: string,
    ssrc = 1,
    rtpTimestamp = 0
  ): Promise<boolean> {
    if (!this.callSecret || !this.callId) {
      throw new Error('SimCaller.consumeFrame: call bindCall(callSecret, callId) first')
    }
    // Receivers derive the sender's base key, not their own.
    const raw = deriveBaseKey(this.callSecret, this.callId, senderId)
    const key = await importAesKey(raw)
    const opened = await openFrame(wire, key, {
      callId: this.callId,
      senderId,
      ssrc,
      rtpTimestamp,
    })
    if (opened.keyId !== keyId) {
      throw new Error(
        `SimCaller.consumeFrame: keyId mismatch — expected ${keyId}, got ${opened.keyId}`
      )
    }
    if (opened.plaintext.byteLength !== expected.byteLength) {
      throw new Error(
        `SimCaller.consumeFrame: plaintext length mismatch — expected ${expected.byteLength}, got ${opened.plaintext.byteLength}`
      )
    }
    let diff = 0
    for (let i = 0; i < expected.byteLength; i++) {
      diff |= (opened.plaintext[i] ?? 0) ^ (expected[i] ?? 0)
    }
    if (diff !== 0) {
      throw new Error('SimCaller.consumeFrame: plaintext mismatch')
    }
    return true
  }

  // ---- Lifecycle ----

  reset(): void {
    this.clipCursor = 0
    this.framesSentCount = 0
    this.dtmfQueue = []
    this.dtmfLifetimeCount = 0
  }
}
