import { z } from 'zod/v4'

// ── Consent ──
const GdprConsentSchema = z.object({
  version: z.string().optional(),
})
type GdprConsentInput = z.infer<typeof GdprConsentSchema>

// ── Retention Settings ──
export const RetentionSettingsSchema = z.object({
  callRecordsDays: z.number().int().min(30).max(3650),
  notesDays: z.number().int().min(30).max(3650),
  messagesDays: z.number().int().min(30).max(3650),
  auditLogDays: z.number().int().min(365).max(3650),
})
export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>
