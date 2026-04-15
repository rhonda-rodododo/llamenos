import { z } from 'zod/v4'
import { RecipientEnvelopeSchema } from './records'

// ── Create Intake ──
const CreateIntakeSchema = z.object({
  contactId: z.string().optional(),
  callId: z.string().optional(),
  encryptedPayload: z.string().min(1),
  payloadEnvelopes: z.array(RecipientEnvelopeSchema),
})
type CreateIntakeInput = z.infer<typeof CreateIntakeSchema>

// ── Update Intake Status ──
const UpdateIntakeStatusSchema = z.object({
  status: z.enum(['reviewed', 'merged', 'dismissed']),
})
type UpdateIntakeStatusInput = z.infer<typeof UpdateIntakeStatusSchema>
