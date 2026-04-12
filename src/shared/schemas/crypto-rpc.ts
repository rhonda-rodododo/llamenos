// Tier 4 PR-B — postMessage RPC protocol between the main app frame and the
// sandboxed crypto iframe. Every message crossing the boundary is parsed
// against these schemas before any handler runs. A schema violation aborts
// the dispatch and (on the iframe side) increments the anomaly counter.
//
// See docs/superpowers/specs/2026-04-10-security-tier-4-delivery-hardening-design.md §4.2.3.

import { z } from '@hono/zod-openapi'

const Uuid = z.string().uuid()
const Hex = (lenSpec?: { exactHex?: number }) =>
  lenSpec?.exactHex !== undefined
    ? z.string().regex(new RegExp(`^[0-9a-f]{${lenSpec.exactHex}}$`))
    : z.string().regex(/^[0-9a-f]+$/)

export const CryptoRpcEnvelopeSchema = z.object({
  v: z.literal(2),
  labelId: z.number().int().min(0).max(255),
  wrappedKey: Hex(),
  ephemeralPubkey: Hex({ exactHex: 66 }),
  payload: Hex().optional(),
})
export type CryptoRpcEnvelope = z.infer<typeof CryptoRpcEnvelopeSchema>

export const CryptoRpcRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('unlock'),
    id: Uuid,
    kekHex: Hex({ exactHex: 64 }),
    nonceHex: Hex({ exactHex: 48 }),
    ciphertextHex: Hex(),
  }),
  z.object({
    op: z.literal('lock'),
    id: Uuid,
  }),
  z.object({
    op: z.literal('decryptEnvelope'),
    id: Uuid,
    envelope: CryptoRpcEnvelopeSchema,
    expectedLabel: z.string(),
    recordId: z.string().optional(),
  }),
  z.object({
    op: z.literal('decryptHubField'),
    id: Uuid,
    hubId: Uuid,
    ciphertextHex: Hex(),
    recordId: z.string(),
    fieldName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  }),
  z.object({
    op: z.literal('encryptHubField'),
    id: Uuid,
    hubId: Uuid,
    // 64 KiB cap prevents a runaway decrypt-loop from DoSing the iframe.
    plaintext: z.string().max(64 * 1024),
    recordId: z.string(),
    fieldName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  }),
  z.object({
    op: z.literal('signAuditEntry'),
    id: Uuid,
    entryHashHex: Hex({ exactHex: 64 }),
  }),
  z.object({
    op: z.literal('rotateHubKey'),
    id: Uuid,
    hubId: Uuid,
    expectedTriggerEntryHash: Hex({ exactHex: 64 }),
  }),
  z.object({
    op: z.literal('getPublicKey'),
    id: Uuid,
  }),
  z.object({
    op: z.literal('isUnlocked'),
    id: Uuid,
  }),
  z.object({
    op: z.literal('reportBundleHash'),
    id: Uuid,
    hashHex: Hex({ exactHex: 64 }),
    timestamp: z.number().int(),
  }),
])
export type CryptoRpcRequest = z.infer<typeof CryptoRpcRequestSchema>

export const CryptoRpcErrorCodeSchema = z.enum([
  'schema_invalid',
  'locked',
  'label_mismatch',
  'aad_mismatch',
  'rate_limited',
  'chain_unverified',
  'unknown_hub',
  'internal',
])
export type CryptoRpcErrorCode = z.infer<typeof CryptoRpcErrorCodeSchema>

export const CryptoRpcSuccessSchema = z.object({
  kind: z.literal('success'),
  id: Uuid,
  result: z.unknown(),
})

export const CryptoRpcErrorSchema = z.object({
  kind: z.literal('error'),
  id: Uuid,
  code: CryptoRpcErrorCodeSchema,
  message: z.string(),
})

export const CryptoRpcResponseSchema = z.union([CryptoRpcSuccessSchema, CryptoRpcErrorSchema])
export type CryptoRpcResponse = z.infer<typeof CryptoRpcResponseSchema>

export const CryptoRpcReadySchema = z.object({
  kind: z.literal('ready'),
  protocol: z.literal(1),
})
export type CryptoRpcReady = z.infer<typeof CryptoRpcReadySchema>
