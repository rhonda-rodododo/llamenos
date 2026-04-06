import { z } from '@hono/zod-openapi'

export const RecoveryRotateSchema = z.object({
  currentPinProof: z.string().min(1),
  newEncryptedSecretKey: z.string().min(1),
})

export const RecoveryRotateResponseSchema = z.object({
  recoveryKey: z.string(),
})

export type RecoveryRotateInput = z.infer<typeof RecoveryRotateSchema>
