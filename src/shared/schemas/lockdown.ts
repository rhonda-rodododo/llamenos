import { z } from '@hono/zod-openapi'

export const LockdownTierSchema = z.enum(['A', 'B', 'C'])

export const LockdownRequestSchema = z.object({
  tier: LockdownTierSchema,
  confirmation: z.literal('LOCKDOWN'),
  pinProof: z.string().min(1),
})

export const LockdownResponseSchema = z.object({
  tier: LockdownTierSchema,
  revokedSessions: z.number().int().min(0),
  deletedPasskeys: z.number().int().min(0),
  accountDeactivated: z.boolean(),
  notificationDelivered: z.boolean(),
})

export type LockdownTier = z.infer<typeof LockdownTierSchema>
export type LockdownRequest = z.infer<typeof LockdownRequestSchema>
