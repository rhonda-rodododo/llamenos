import { z } from '@hono/zod-openapi'
import { RecipientEnvelopeSchema } from './records'

export const RevokeReasonSchema = z.enum([
  'user',
  'lockdown_a',
  'lockdown_b',
  'lockdown_c',
  'admin',
  'replay',
  'expired',
])

export const SessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
  encryptedMeta: z.string(),
  metaEnvelope: z.array(RecipientEnvelopeSchema),
  credentialId: z.string().nullable(),
})

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionSchema),
})

export const RevokeSessionParamsSchema = z.object({
  id: z.string(),
})

export const RevokeOthersResponseSchema = z.object({
  revokedCount: z.number().int().min(0),
})

export type SessionResponse = z.infer<typeof SessionSchema>
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>
export type RevokeReason = z.infer<typeof RevokeReasonSchema>
