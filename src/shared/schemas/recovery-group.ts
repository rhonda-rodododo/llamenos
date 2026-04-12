import { z } from '@hono/zod-openapi'

// ---------------------------------------------------------------------------
// Enroll a Recovery Group for a hub (admin only)
// ---------------------------------------------------------------------------

export const RecoveryGroupShareEnvelopeSchema = z.object({
  adminPubkey: z.string().min(1).max(256),
  envelope: z.string().min(1).max(65536),
})

export const RecoveryGroupEnrollSchema = z.object({
  hubId: z.string().uuid(),
  threshold: z.number().int().min(2).max(5),
  totalShares: z.number().int().min(3).max(5),
  groupPublicKey: z.string().min(1).max(512),
  shareEnvelopes: z.array(RecoveryGroupShareEnvelopeSchema).min(3).max(5),
  shareCommitments: z.array(z.string().length(64)).min(3).max(5),
})
export type RecoveryGroupEnrollInput = z.infer<typeof RecoveryGroupEnrollSchema>

export const RecoveryGroupEnrollResponseSchema = z.object({ ok: z.literal(true) })

// ---------------------------------------------------------------------------
// Get the Recovery Group config for a hub
// ---------------------------------------------------------------------------

export const RecoveryGroupInfoSchema = z.object({
  hubId: z.string().uuid(),
  groupPublicKey: z.string(),
  threshold: z.number().int(),
  totalShares: z.number().int(),
  shareCommitments: z.array(z.string()),
  createdAt: z.string().datetime(),
  rotatedAt: z.string().datetime().nullable(),
})
export type RecoveryGroupInfo = z.infer<typeof RecoveryGroupInfoSchema>

// ---------------------------------------------------------------------------
// Initiate a recovery session (unauthenticated — recovering user has no creds)
// ---------------------------------------------------------------------------

export const RecoveryInitiateSchema = z.object({
  hubId: z.string().uuid(),
  userIdentifier: z.string().min(1).max(512),
  newDevicePubkey: z.string().min(1).max(512),
})
export type RecoveryInitiateInput = z.infer<typeof RecoveryInitiateSchema>

export const RecoveryInitiateResponseSchema = z.object({
  sessionId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  coordinatorPubkey: z.string(),
})

// ---------------------------------------------------------------------------
// Contribute a Shamir share to a recovery session (admin only)
// ---------------------------------------------------------------------------

export const RecoveryContributeShareSchema = z.object({
  sessionId: z.string().uuid(),
  encryptedShare: z.string().min(1).max(65536),
})
export type RecoveryContributeShareInput = z.infer<typeof RecoveryContributeShareSchema>

export const RecoveryContributeShareResponseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['pending', 'ready']),
  contributionCount: z.number().int(),
})

// ---------------------------------------------------------------------------
// Complete recovery (recovering user — after 24h or emergency override)
// ---------------------------------------------------------------------------

export const EmergencyOverrideSchema = z.object({
  justification: z.string().min(16).max(1024),
  coApproverPubkey: z.string().min(1).max(256),
  coApproverSignature: z.string().min(1).max(1024),
})

export const RecoveryCompleteSchema = z.object({
  sessionId: z.string().uuid(),
  newBundle: z.unknown(),
  emergencyOverride: EmergencyOverrideSchema.optional(),
})
export type RecoveryCompleteInput = z.infer<typeof RecoveryCompleteSchema>

export const RecoveryCompleteResponseSchema = z.object({ ok: z.literal(true) })

// ---------------------------------------------------------------------------
// Get recovery session status
// ---------------------------------------------------------------------------

export const RecoverySessionStatusSchema = z.object({
  sessionId: z.string().uuid(),
  hubId: z.string().uuid(),
  status: z.enum(['pending', 'ready', 'completed', 'expired', 'cancelled']),
  contributionCount: z.number().int(),
  threshold: z.number().int(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  delayRemainingMs: z.number().int(),
})

// ---------------------------------------------------------------------------
// User recovery envelope (per hub)
// ---------------------------------------------------------------------------

export const UserRecoveryEnvelopeSchema = z.object({
  hubId: z.string().uuid(),
  envelope: z.string().min(1).max(65536),
})
export type UserRecoveryEnvelopeInput = z.infer<typeof UserRecoveryEnvelopeSchema>

export const UserRecoveryEnvelopeResponseSchema = z.object({ ok: z.literal(true) })
