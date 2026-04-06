import { z } from '@hono/zod-openapi'
import { RecipientEnvelopeSchema } from './records'

export const PasskeyRenameSchema = z
  .object({
    label: z.string().max(100).optional(),
    encryptedLabel: z.string().optional(),
    labelEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  })
  .refine((d) => d.label !== undefined || d.encryptedLabel !== undefined, {
    message: 'Must provide either label or encryptedLabel',
  })

export type PasskeyRenameInput = z.infer<typeof PasskeyRenameSchema>
