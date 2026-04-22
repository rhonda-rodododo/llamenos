import { z } from '@hono/zod-openapi'

export const RecoveryRotateSchema = z.object({
  currentPinProof: z.string().min(1),
  newEncryptedSecretKey: z.string().min(1),
})

const _RecoveryRotateResponseSchema = z.object({
  recoveryKey: z.string(),
})

type RecoveryRotateInput = z.infer<typeof RecoveryRotateSchema>
