import { z } from 'zod/v4'

export const ActiveCallSchema = z.object({
  callSid: z.string(),
  hubId: z.string(),
  callerNumber: z.string(),
  status: z.enum(['ringing', 'in-progress', 'completed']),
  assignedPubkey: z.string().optional(),
  startedAt: z.iso.datetime(),
  metadata: z.record(z.string(), z.unknown()),
})
export type ActiveCall = z.infer<typeof ActiveCallSchema>

export const CallLegSchema = z.object({
  legSid: z.string(),
  callSid: z.string(),
  hubId: z.string(),
  userPubkey: z.string(),
  phone: z.string().optional(),
  type: z.enum(['phone', 'browser']).optional(),
  status: z.enum(['initiated', 'ringing', 'answered', 'completed', 'failed', 'cancelled']),
  createdAt: z.iso.datetime(),
})
export type CallLeg = z.infer<typeof CallLegSchema>

export const CallTokenSchema = z.object({
  token: z.string(),
  callSid: z.string(),
  hubId: z.string(),
  pubkey: z.string(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})
type CallToken = z.infer<typeof CallTokenSchema>
