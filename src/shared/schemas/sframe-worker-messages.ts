import { z } from '@hono/zod-openapi'

/**
 * Tier 5 WS 5.4 — postMessage protocol between the main thread
 * `SFrameWorkerClient` and the dedicated `sframe-worker` module.
 *
 * The worker owns all SFrame CryptoKeys for every active call; the main
 * thread talks to it via a request/response RPC where every envelope is
 * validated against the schemas below.
 */
export const SFrameErrorCodeSchema = z.enum([
  'unknown_call',
  'unknown_key_id',
  'unknown_sender_key',
  'key_zero_length',
  'decrypt_failed',
  'encrypt_failed',
  'aad_mismatch',
  'header_parse_failed',
  'worker_not_ready',
  'internal_error',
])
export type SFrameErrorCode = z.infer<typeof SFrameErrorCodeSchema>

const baseKeyShape = z.custom<ArrayBuffer>((v) => v instanceof ArrayBuffer, 'expected ArrayBuffer')

export const SFrameWorkerRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('registerCall'), id: z.string(), callId: z.string() }),
  z.object({
    type: z.literal('setSenderKey'),
    id: z.string(),
    callId: z.string(),
    keyId: z.number().int().min(0).max(127),
    baseKey: baseKeyShape,
    senderId: z.string(),
  }),
  z.object({
    type: z.literal('setReceiverKey'),
    id: z.string(),
    callId: z.string(),
    keyId: z.number().int().min(0).max(127),
    baseKey: baseKeyShape,
    senderId: z.string(),
  }),
  z.object({
    type: z.literal('rotateCallKey'),
    id: z.string(),
    callId: z.string(),
    newKeyId: z.number().int().min(0).max(127),
    newBaseKeys: z.record(z.string(), baseKeyShape),
  }),
  z.object({ type: z.literal('releaseCall'), id: z.string(), callId: z.string() }),
  z.object({ type: z.literal('getMetrics'), id: z.string(), callId: z.string() }),
])
export type SFrameWorkerRequest = z.infer<typeof SFrameWorkerRequestSchema>

export const SFrameWorkerResponseSchema = z.union([
  z.object({ type: z.literal('success'), id: z.string(), result: z.unknown().optional() }),
  z.object({
    type: z.literal('error'),
    id: z.string(),
    error: z.string(),
    code: SFrameErrorCodeSchema,
  }),
])
export type SFrameWorkerResponse = z.infer<typeof SFrameWorkerResponseSchema>
