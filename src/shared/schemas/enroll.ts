import { z } from '@hono/zod-openapi'

export const EnrollRequestSchema = z.object({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/i),
})

export type EnrollRequestInput = z.infer<typeof EnrollRequestSchema>
