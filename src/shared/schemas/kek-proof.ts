import { z } from '@hono/zod-openapi'

export const KekProofSchema = z.object({ proof: z.string().min(1) })
type KekProofInput = z.infer<typeof KekProofSchema>
