import { z } from '@hono/zod-openapi'

const DigestCadenceSchema = z.enum(['off', 'daily', 'weekly'])
export const NotificationChannelSchema = z.enum(['web_push', 'signal'])

const SecurityPrefsSchema = z.object({
  autoLockMs: z.number().int().min(60_000).max(3_600_000),
  disappearingTimerDays: z.number().int().min(1).max(7),
  digestCadence: DigestCadenceSchema,
  alertOnNewDevice: z.boolean(),
  alertOnPasskeyChange: z.boolean(),
  alertOnPinChange: z.boolean(),
  notificationChannel: NotificationChannelSchema,
})

export const UpdateSecurityPrefsSchema = SecurityPrefsSchema.partial()

export type SecurityPrefs = z.infer<typeof SecurityPrefsSchema>
export type DigestCadence = z.infer<typeof DigestCadenceSchema>
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>
export type UpdateSecurityPrefsInput = z.infer<typeof UpdateSecurityPrefsSchema>
