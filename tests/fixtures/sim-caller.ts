/**
 * SimCaller — in-memory simulated inbound caller for IVR and call-path
 * tests.
 *
 * Holds a canned "Opus" payload (stubbed as a deterministic byte pattern
 * representing a 440 Hz tone — real Opus encoding is too heavy for CI),
 * drives it through a simple jitter buffer with configurable inter-packet
 * delay, and emits DTMF digits on demand. Zero external dependencies.
 *
 * **Intentionally NO imports from `@shared/sframe/`.** The SFrame
 * produce/consume methods live in Tier 5 main as Task 19b; this prereq
 * file only establishes the fixture's shape, audio clip, jitter buffer,
 * and DTMF behavior.
 *
 * Related: Tier 5 spec §5.12.2, Tier 5 plan Workstream 5.8 Task 19.
 */

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
    // Symmetric jitter: uniform in [-jitterMs, +jitterMs].
    const offset = (this.rng() * 2 - 1) * this.jitterMs
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

  // ---- Lifecycle ----

  reset(): void {
    this.clipCursor = 0
    this.framesSentCount = 0
    this.dtmfQueue = []
    this.dtmfLifetimeCount = 0
  }
}
