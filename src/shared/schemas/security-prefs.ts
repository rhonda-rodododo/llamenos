import { z } from '@hono/zod-openapi'

export const DigestCadenceSchema = z.enum(['off', 'daily', 'weekly'])

export const SecurityPrefsSchema = z.object({
  autoLockMs: z.number().int().min(60_000).max(3_600_000),
  disappearingTimerDays: z.number().int().min(1).max(7),
  digestCadence: DigestCadenceSchema,
  alertOnNewDevice: z.boolean(),
  alertOnPasskeyChange: z.boolean(),
  alertOnPinChange: z.boolean(),
})

export const UpdateSecurityPrefsSchema = SecurityPrefsSchema.partial()

export type SecurityPrefs = z.infer<typeof SecurityPrefsSchema>
export type DigestCadence = z.infer<typeof DigestCadenceSchema>
export type UpdateSecurityPrefsInput = z.infer<typeof UpdateSecurityPrefsSchema>
