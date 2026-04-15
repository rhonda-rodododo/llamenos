import { z } from 'zod/v4'
import { ContactTypeSchema, RiskLevelSchema } from './common'
import { RecipientEnvelopeSchema } from './records'

// ── Create Contact ──
export const CreateContactSchema = z.object({
  contactType: ContactTypeSchema,
  riskLevel: RiskLevelSchema,
  tags: z.array(z.string()).optional(),
  identifierHash: z.string().optional(),
  assignedTo: z.string().optional(),
  encryptedDisplayName: z.string().min(1),
  displayNameEnvelopes: z.array(RecipientEnvelopeSchema).min(1),
  encryptedNotes: z.string().optional(),
  notesEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  encryptedFullName: z.string().optional(),
  fullNameEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  encryptedPhone: z.string().optional(),
  phoneEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  encryptedPII: z.string().optional(),
  piiEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
})
export type CreateContactInput = z.infer<typeof CreateContactSchema>

// ── Update Contact ──
const UpdateContactSchema = z.object({
  contactType: ContactTypeSchema.optional(),
  riskLevel: RiskLevelSchema.optional(),
  tags: z.array(z.string()).optional(),
  identifierHash: z.string().optional(),
  assignedTo: z.string().nullable().optional(),
  encryptedDisplayName: z.string().optional(),
  displayNameEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  encryptedNotes: z.string().optional(),
  notesEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  encryptedFullName: z.string().optional(),
  fullNameEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  encryptedPhone: z.string().optional(),
  phoneEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
  encryptedPII: z.string().optional(),
  piiEnvelopes: z.array(RecipientEnvelopeSchema).optional(),
})
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>

// ── Link Contact ──
const LinkContactSchema = z.object({
  type: z.enum(['call', 'conversation']),
  targetId: z.string().min(1),
})
type LinkContactInput = z.infer<typeof LinkContactSchema>

// ── Bulk Update Contacts ──
const BulkUpdateContactsSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  riskLevel: RiskLevelSchema.optional(),
})
type BulkUpdateContactsInput = z.infer<typeof BulkUpdateContactsSchema>

// ── Bulk Delete Contacts ──
const BulkDeleteContactsSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1),
})
type BulkDeleteContactsInput = z.infer<typeof BulkDeleteContactsSchema>

// ── Hash Phone ──
const HashPhoneSchema = z.object({
  phone: z.string().min(1),
})
type HashPhoneInput = z.infer<typeof HashPhoneSchema>
