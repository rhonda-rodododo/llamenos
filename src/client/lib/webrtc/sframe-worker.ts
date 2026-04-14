import type {
  SFrameDegradedNotification,
  SFrameErrorResponse,
  SFrameSuccessResponse,
  SFrameWorkerRequest,
} from '@shared/schemas/sframe-worker-messages.js'

/**
 * Reply type returned by {@link handleRequest}. Excludes the unsolicited
 * `sframe_degraded` notification because RPC handlers only ever produce
 * success or error responses keyed to a request id.
 */
export type SFrameWorkerRpcReply = SFrameSuccessResponse | SFrameErrorResponse
import { importAesKey } from '@shared/sframe/cipher-suite.js'
import { openFrame, sealFrame } from '@shared/sframe/frame-codec.js'
import { asCiphertextBytes } from '@shared/sframe/sframe-types.js'
import { parseTrailer } from '@shared/sframe/trailer.js'

/**
 * Tier 5 WS 5.4 — dedicated Web Worker that owns every SFrame CryptoKey for
 * every active voice call.
 *
 * The worker exports `handleRequest` and `clearWorkerState` as pure functions
 * so they can be driven directly from unit tests. Actual Worker plumbing
 * (`self.onmessage`, `self.onrtctransform`) is only installed when the module
 * is executed inside a real DedicatedWorkerGlobalScope — detected by the
 * presence of `WorkerGlobalScope` on the global object. That keeps the module
 * importable from bun:test without spawning anything.
 */

interface SenderKeyState {
  keyId: number
  key: CryptoKey
  counter: number
}

interface GraceEntry {
  key: CryptoKey
  expiresAt: number
}

interface ReceiverKeyMap {
  current: Map<number, CryptoKey>
  grace: Map<number, GraceEntry>
}

/**
 * Error-rate tracking state for a call. Updated by {@link recordOp} on every
 * frame transform — pure data, no IO, so unit-testable in isolation.
 */
export interface DegradedTracker {
  /** Count of consecutive failed transforms (resets to 0 on success). */
  consecutiveErrors: number
  /** Number of errors observed inside the current rolling window. */
  errorsInWindow: number
  /** Number of successful transforms inside the current rolling window. */
  successesInWindow: number
  /** Wall-clock ms when the current window began. */
  windowStartMs: number
  /**
   * Whether a degraded notification has already been emitted for the current
   * window. Cleared when the window rolls — prevents notification spam on
   * every dropped frame.
   */
  degradedReported: boolean
}

interface CallState {
  callId: string
  senderKeys: Map<string, SenderKeyState>
  receiverKeys: Map<string, ReceiverKeyMap>
  metrics: { sealed: number; opened: number; errors: number; lastError?: string }
  degraded: DegradedTracker
}

const GRACE_WINDOW_MS = 2_000
const MAX_GRACE_KEYS = 3

/** Rolling window length for the error-rate calculation. */
export const DEGRADED_WINDOW_MS = 5_000
/** Threshold of consecutive errors at which the worker emits a degraded event. */
export const DEGRADED_CONSECUTIVE_THRESHOLD = 5
/** Error-rate threshold (10%) over the rolling window. */
export const DEGRADED_RATE_THRESHOLD = 0.1
/** Minimum sample size before the rate threshold is consulted. */
export const DEGRADED_MIN_SAMPLES = 10

export function newDegradedTracker(now: number = Date.now()): DegradedTracker {
  return {
    consecutiveErrors: 0,
    errorsInWindow: 0,
    successesInWindow: 0,
    windowStartMs: now,
    degradedReported: false,
  }
}

export interface DegradedSignal {
  errorRate: number
  consecutiveErrors: number
}

/**
 * Update the tracker with the outcome of a single frame transform and return
 * a {@link DegradedSignal} if the worker should emit a degraded notification
 * for this op (and has not already emitted one in the current window).
 *
 * Pure function — no IO, no module state. Drives both the live worker and the
 * unit tests so the threshold logic is verifiable without spawning a real
 * Worker / TransformStream.
 */
export function recordOp(
  tracker: DegradedTracker,
  outcome: 'success' | 'error',
  now: number = Date.now()
): DegradedSignal | null {
  // Roll the window forward if the previous one expired. A new window resets
  // both counters AND the degradedReported flag so a still-failing call can
  // re-notify on the next threshold breach.
  if (now - tracker.windowStartMs >= DEGRADED_WINDOW_MS) {
    tracker.errorsInWindow = 0
    tracker.successesInWindow = 0
    tracker.windowStartMs = now
    tracker.degradedReported = false
  }

  if (outcome === 'error') {
    tracker.consecutiveErrors += 1
    tracker.errorsInWindow += 1
  } else {
    tracker.consecutiveErrors = 0
    tracker.successesInWindow += 1
  }

  if (tracker.degradedReported) return null

  const total = tracker.errorsInWindow + tracker.successesInWindow
  const errorRate = total === 0 ? 0 : tracker.errorsInWindow / total
  const breachedConsecutive = tracker.consecutiveErrors >= DEGRADED_CONSECUTIVE_THRESHOLD
  const breachedRate = total >= DEGRADED_MIN_SAMPLES && errorRate > DEGRADED_RATE_THRESHOLD

  if (breachedConsecutive || breachedRate) {
    tracker.degradedReported = true
    return { errorRate, consecutiveErrors: tracker.consecutiveErrors }
  }
  return null
}

const calls = new Map<string, CallState>()

export function clearWorkerState(): void {
  calls.clear()
}

function pruneGrace(map: Map<number, GraceEntry>): void {
  const cutoff = Date.now()
  for (const [keyId, entry] of map) {
    if (entry.expiresAt < cutoff) map.delete(keyId)
  }
  if (map.size > MAX_GRACE_KEYS) {
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    while (sorted.length > MAX_GRACE_KEYS) {
      const entry = sorted.shift()
      if (entry) map.delete(entry[0])
    }
  }
}

export async function handleRequest(req: SFrameWorkerRequest): Promise<SFrameWorkerRpcReply> {
  try {
    switch (req.type) {
      case 'registerCall': {
        if (!calls.has(req.callId)) {
          calls.set(req.callId, {
            callId: req.callId,
            senderKeys: new Map(),
            receiverKeys: new Map(),
            metrics: { sealed: 0, opened: 0, errors: 0 },
            degraded: newDegradedTracker(),
          })
        }
        return { type: 'success', id: req.id }
      }

      case 'setSenderKey': {
        const state = calls.get(req.callId)
        if (!state) {
          return { type: 'error', id: req.id, error: 'unknown call', code: 'unknown_call' }
        }
        if (req.baseKey.byteLength === 0) {
          return {
            type: 'error',
            id: req.id,
            error: 'zero-length key',
            code: 'key_zero_length',
          }
        }
        const cryptoKey = await importAesKey(new Uint8Array(req.baseKey))
        state.senderKeys.set(req.senderId, { keyId: req.keyId, key: cryptoKey, counter: 0 })
        return { type: 'success', id: req.id }
      }

      case 'setReceiverKey': {
        const state = calls.get(req.callId)
        if (!state) {
          return { type: 'error', id: req.id, error: 'unknown call', code: 'unknown_call' }
        }
        if (req.baseKey.byteLength === 0) {
          return {
            type: 'error',
            id: req.id,
            error: 'zero-length key',
            code: 'key_zero_length',
          }
        }
        const cryptoKey = await importAesKey(new Uint8Array(req.baseKey))
        let recv = state.receiverKeys.get(req.senderId)
        if (!recv) {
          recv = { current: new Map(), grace: new Map() }
          state.receiverKeys.set(req.senderId, recv)
        }
        recv.current.set(req.keyId, cryptoKey)
        return { type: 'success', id: req.id }
      }

      case 'rotateCallKey': {
        const state = calls.get(req.callId)
        if (!state) {
          return { type: 'error', id: req.id, error: 'unknown call', code: 'unknown_call' }
        }
        for (const [senderId, newRaw] of Object.entries(req.newBaseKeys)) {
          if (newRaw.byteLength === 0) {
            return {
              type: 'error',
              id: req.id,
              error: 'zero-length key',
              code: 'key_zero_length',
            }
          }
          const newKey = await importAesKey(new Uint8Array(newRaw))
          state.senderKeys.set(senderId, { keyId: req.newKeyId, key: newKey, counter: 0 })
          const recv = state.receiverKeys.get(senderId)
          if (recv) {
            for (const [kid, key] of recv.current) {
              recv.grace.set(kid, { key, expiresAt: Date.now() + GRACE_WINDOW_MS })
            }
            recv.current.clear()
            recv.current.set(req.newKeyId, newKey)
            pruneGrace(recv.grace)
          }
        }
        return { type: 'success', id: req.id }
      }

      case 'releaseCall': {
        calls.delete(req.callId)
        return { type: 'success', id: req.id }
      }

      case 'getMetrics': {
        const state = calls.get(req.callId)
        if (!state) {
          return { type: 'error', id: req.id, error: 'unknown call', code: 'unknown_call' }
        }
        return { type: 'success', id: req.id, result: { ...state.metrics } }
      }
    }
  } catch (err) {
    return {
      type: 'error',
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
      code: 'internal_error',
    }
  }
}

/* ---------------------------------------------------------------- */
/* Worker plumbing — only installs inside a real DedicatedWorkerGlobalScope. */

interface WorkerGlobal {
  onmessage?: ((ev: MessageEvent) => void) | null
  onrtctransform?: ((ev: Event) => void) | null
  postMessage?: (msg: unknown) => void
}

interface RtcTransformer {
  readable: ReadableStream<unknown>
  writable: WritableStream<unknown>
  options: {
    direction: 'inbound' | 'outbound'
    callId: string
    senderId?: string
    codecHeaderLength?: number
  }
}

interface EncodedRtpFrame {
  data: ArrayBuffer
  getMetadata?: () => { rtpTimestamp?: number; synchronizationSource?: number }
}

function installWorkerGlobals(): void {
  const workerSelf = (globalThis as unknown as { self?: WorkerGlobal }).self
  if (!workerSelf) return

  workerSelf.onmessage = async (ev: MessageEvent) => {
    const resp = await handleRequest(ev.data as SFrameWorkerRequest)
    workerSelf.postMessage?.(resp)
  }

  const emitDegraded = (callId: string, signal: DegradedSignal): void => {
    workerSelf.postMessage?.({
      type: 'sframe_degraded',
      callId,
      errorRate: signal.errorRate,
      consecutiveErrors: signal.consecutiveErrors,
    } satisfies SFrameDegradedNotification)
  }

  workerSelf.onrtctransform = (ev: Event) => {
    const transformer = (ev as unknown as { transformer: RtcTransformer }).transformer
    const opts = transformer.options
    const state = calls.get(opts.callId)
    if (!state) {
      void transformer.writable.abort(new Error('unknown_call'))
      return
    }
    const codecHeaderLength = opts.codecHeaderLength ?? 0

    const frameStream = new TransformStream<EncodedRtpFrame, EncodedRtpFrame>({
      async transform(rawFrame, controller) {
        try {
          const meta = rawFrame.getMetadata?.() ?? {}
          const ssrc = meta.synchronizationSource ?? 0
          const rtpTimestamp = meta.rtpTimestamp ?? 0
          if (opts.direction === 'outbound') {
            const senderId = opts.senderId
            if (!senderId) throw new Error('missing_sender_id')
            const senderState = state.senderKeys.get(senderId)
            if (!senderState) throw new Error('unknown_sender_key')
            const counter = ++senderState.counter
            const sealed = await sealFrame(new Uint8Array(rawFrame.data), senderState.key, {
              callId: opts.callId,
              senderId,
              keyId: senderState.keyId,
              counter,
              ssrc,
              rtpTimestamp,
              codecHeaderLength,
            })
            const copy = sealed.slice()
            rawFrame.data = copy.buffer
            state.metrics.sealed += 1
          } else {
            // Wire bytes arriving from the remote peer are ciphertext by
            // construction — brand them before handing to openFrame so the
            // brand check at the API surface succeeds without a loose cast.
            const bytes = asCiphertextBytes(new Uint8Array(rawFrame.data))
            const { keyId } = parseTrailer(bytes)
            let key: CryptoKey | undefined
            let matchedSenderId: string | undefined
            for (const [senderId, recv] of state.receiverKeys) {
              const k = recv.current.get(keyId) ?? recv.grace.get(keyId)?.key
              if (k) {
                key = k
                matchedSenderId = senderId
                break
              }
            }
            if (!key || !matchedSenderId) throw new Error('unknown_key_id')
            const result = await openFrame(bytes, key, {
              callId: opts.callId,
              senderId: matchedSenderId,
              ssrc,
              rtpTimestamp,
              codecHeaderLength,
            })
            const copy = result.plaintext.slice()
            rawFrame.data = copy.buffer
            state.metrics.opened += 1
          }
          controller.enqueue(rawFrame)
          // Successful transform: feed the degraded tracker so the rolling
          // error rate is computed against real traffic.
          recordOp(state.degraded, 'success')
        } catch (err) {
          state.metrics.errors += 1
          state.metrics.lastError = err instanceof Error ? err.message : String(err)
          // Frame is dropped (controller.enqueue NOT called). Notify the main
          // thread once per window when the consecutive-error or rate
          // threshold is breached.
          const signal = recordOp(state.degraded, 'error')
          if (signal) emitDegraded(opts.callId, signal)
        }
      },
    })
    transformer.readable
      .pipeThrough(frameStream)
      .pipeTo(transformer.writable)
      .catch(() => {})
  }
}

// Only install plumbing when executed inside a real DedicatedWorkerGlobalScope.
// bun:test doesn't define WorkerGlobalScope, so this stays dormant during unit tests.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  installWorkerGlobals()
}
