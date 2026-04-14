import type {
  SFrameErrorCode,
  SFrameWorkerRequest,
  SFrameWorkerResponse,
} from '@shared/schemas/sframe-worker-messages.js'
import { isSFrameSupported } from './feature-detect.js'

/**
 * Tier 5 WS 5.4 — main-thread facade over the SFrame dedicated Web Worker.
 *
 * Callers register a call, hand over sender/receiver keys, request key
 * rotations, and ask the worker to build an `RTCRtpScriptTransform` they can
 * attach to an `RTCRtpSender`/`RTCRtpReceiver`. All SFrame CryptoKeys live
 * exclusively inside the worker — this class never materializes them.
 */

export class SFrameWorkerError extends Error {
  readonly code: SFrameErrorCode
  constructor(message: string, code: SFrameErrorCode) {
    super(message)
    this.name = 'SFrameWorkerError'
    this.code = code
  }
}

export interface SFrameCallMetrics {
  sealed: number
  opened: number
  errors: number
  lastError?: string
}

export interface SFrameTransformOptions {
  direction: 'inbound' | 'outbound'
  callId: string
  senderId?: string
  codecHeaderLength?: number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

// Distribute `Omit` across every branch of a discriminated union so that
// each narrowed variant keeps its full set of fields.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
type SFrameRequestBody = DistributiveOmit<SFrameWorkerRequest, 'id'>

export class SFrameWorkerClient {
  private worker: Worker
  private pending = new Map<string, Pending>()
  private idCounter = 0

  constructor(worker?: Worker) {
    if (worker) {
      this.worker = worker
    } else {
      this.worker = new Worker(new URL('./sframe-worker.ts', import.meta.url), {
        type: 'module',
        name: 'llamenos-sframe',
      })
    }
    this.worker.onmessage = this.handleMessage.bind(this)
    this.worker.onerror = this.handleError.bind(this)
  }

  private handleMessage(ev: MessageEvent<SFrameWorkerResponse>): void {
    const resp = ev.data
    const p = this.pending.get(resp.id)
    if (!p) return
    this.pending.delete(resp.id)
    if (resp.type === 'error') {
      p.reject(new SFrameWorkerError(resp.error, resp.code))
    } else {
      p.resolve(resp.result)
    }
  }

  private handleError(ev: ErrorEvent): void {
    const err = new Error(`SFrame worker error: ${ev.message}`)
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }

  private nextId(): string {
    this.idCounter += 1
    return String(this.idCounter)
  }

  private call(req: SFrameRequestBody): Promise<unknown> {
    const id = this.nextId()
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id } as SFrameWorkerRequest)
    })
  }

  async registerCall(callId: string): Promise<void> {
    await this.call({ type: 'registerCall', callId })
  }

  async setSenderKey(
    callId: string,
    keyId: number,
    baseKey: ArrayBuffer,
    senderId: string
  ): Promise<void> {
    await this.call({ type: 'setSenderKey', callId, keyId, baseKey, senderId })
  }

  async setReceiverKey(
    callId: string,
    keyId: number,
    baseKey: ArrayBuffer,
    senderId: string
  ): Promise<void> {
    await this.call({ type: 'setReceiverKey', callId, keyId, baseKey, senderId })
  }

  async rotateCallKey(
    callId: string,
    newKeyId: number,
    newBaseKeys: Record<string, ArrayBuffer>
  ): Promise<void> {
    await this.call({ type: 'rotateCallKey', callId, newKeyId, newBaseKeys })
  }

  async releaseCall(callId: string): Promise<void> {
    await this.call({ type: 'releaseCall', callId })
  }

  async getMetrics(callId: string): Promise<SFrameCallMetrics> {
    return (await this.call({ type: 'getMetrics', callId })) as SFrameCallMetrics
  }

  buildTransform(options: SFrameTransformOptions): unknown {
    // biome-ignore lint/suspicious/noExplicitAny: RTCRtpScriptTransform not in stable lib.dom
    const Ctor = (globalThis as any).RTCRtpScriptTransform
    if (typeof Ctor !== 'function') {
      throw new Error('RTCRtpScriptTransform unavailable — use feature detect before calling')
    }
    return new Ctor(this.worker, options)
  }

  terminate(): void {
    this.worker.terminate()
  }
}

let singleton: SFrameWorkerClient | null = null
export function getSFrameWorker(): SFrameWorkerClient | null {
  if (singleton) return singleton
  if (typeof Worker === 'undefined') return null
  if (!isSFrameSupported()) return null
  singleton = new SFrameWorkerClient()
  return singleton
}
