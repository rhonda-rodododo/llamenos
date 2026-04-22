import { z } from '@hono/zod-openapi'
import { RecipientEnvelopeSchema } from './records'

const AuthEventTypeSchema = z.enum([
  'login',
  'login_failed',
  'logout',
  'session_revoked',
  'sessions_revoked_others',
  'passkey_added',
  'passkey_removed',
  'passkey_renamed',
  'pin_changed',
  'recovery_rotated',
  'lockdown_triggered',
  'alert_sent',
  'signal_contact_changed',
])

const AuthEventSchema = z.object({
  id: z.string(),
  eventType: AuthEventTypeSchema,
  encryptedPayload: z.string(),
  payloadEnvelope: z.array(RecipientEnvelopeSchema),
  createdAt: z.string(),
  reportedSuspiciousAt: z.string().nullable(),
})

export const AuthEventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  since: z.string().datetime().optional(),
})

const AuthEventListResponseSchema = z.object({
  events: z.array(AuthEventSchema),
})

const _ReportEventParamsSchema = z.object({
  id: z.string().uuid(),
})

const _ReportEventResponseSchema = z.object({
  ok: z.boolean(),
})

const AuthEventExportResponseSchema = z.object({
  userPubkey: z.string(),
  exportedAt: z.string(),
  events: z.array(AuthEventSchema),
})

export type AuthEventType = z.infer<typeof AuthEventTypeSchema>
type AuthEventResponse = z.infer<typeof AuthEventSchema>
export type AuthEventListResponse = z.infer<typeof AuthEventListResponseSchema>
export type AuthEventExportResponse = z.infer<typeof AuthEventExportResponseSchema>
