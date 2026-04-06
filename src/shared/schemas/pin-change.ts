import { z } from '@hono/zod-openapi'

export const PinChangeSchema = z.object({
  currentPinProof: z.string().min(1),
  newKekProof: z.string().min(1),
  newEncryptedSecretKey: z.string().min(1),
})

export type PinChangeInput = z.infer<typeof PinChangeSchema>
