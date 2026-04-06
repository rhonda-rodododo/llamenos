import { z } from '@hono/zod-openapi'
import { RecipientEnvelopeSchema } from './records'

export const SignalIdentifierTypeSchema = z.enum(['phone', 'username'])

export const SignalContactResponseSchema = z.object({
  identifierHash: z.string(),
  identifierCiphertext: z.string(),
  identifierEnvelope: z.array(RecipientEnvelopeSchema),
  identifierType: SignalIdentifierTypeSchema,
  verifiedAt: z.string().nullable(),
  updatedAt: z.string(),
})

export const SignalContactRegisterSchema = z.object({
  identifierHash: z.string().min(32).max(128),
  identifierCiphertext: z.string(),
  identifierEnvelope: z.array(RecipientEnvelopeSchema),
  identifierType: SignalIdentifierTypeSchema,
  plaintextIdentifier: z.string().min(3).max(64),
})

export type SignalContactResponse = z.infer<typeof SignalContactResponseSchema>
export type SignalContactRegisterInput = z.infer<typeof SignalContactRegisterSchema>
export type SignalIdentifierType = z.infer<typeof SignalIdentifierTypeSchema>
