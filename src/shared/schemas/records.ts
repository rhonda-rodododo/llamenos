import { z } from 'zod/v4'

const BanEntrySchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  phone: z.string(),
  reason: z.string(),
  bannedBy: z.string(),
  createdAt: z.iso.datetime(),
})
export type BanEntry = z.infer<typeof BanEntrySchema>

const CreateBanSchema = z.object({
  phone: z.string(),
  reason: z.string(),
  bannedBy: z.string(),
})
type CreateBanInput = z.infer<typeof CreateBanSchema>

export const AuditLogEntrySchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  event: z.string(),
  actorPubkey: z.string(),
  details: z.record(z.string(), z.unknown()),
  previousEntryHash: z.string().optional(),
  entryHash: z.string().optional(),
  createdAt: z.iso.datetime(),
})
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>

export const RecipientEnvelopeSchema = z.object({
  pubkey: z.string(),
  wrappedKey: z.string(),
  ephemeralPubkey: z.string(),
})
export type RecipientEnvelope = z.infer<typeof RecipientEnvelopeSchema>

const EncryptedNoteSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  callId: z.string().optional(),
  conversationId: z.string().optional(),
  contactHash: z.string().optional(),
  authorPubkey: z.string(),
  encryptedContent: z.string(),
  ephemeralPubkey: z.string().optional(),
  authorEnvelope: RecipientEnvelopeSchema.optional(),
  adminEnvelopes: z.array(RecipientEnvelopeSchema),
  replyCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type EncryptedNote = z.infer<typeof EncryptedNoteSchema>

const CreateNoteSchema = z.object({
  hubId: z.string().optional(),
  callId: z.string().optional(),
  conversationId: z.string().optional(),
  authorPubkey: z.string(),
  encryptedContent: z.string(),
  ephemeralPubkey: z.string().optional(),
  authorEnvelope: RecipientEnvelopeSchema.optional(),
  adminEnvelopes: z.array(RecipientEnvelopeSchema),
})
type CreateNoteInput = z.infer<typeof CreateNoteSchema>

export const KeyEnvelopeSchema = z.object({
  wrappedKey: z.string(),
  ephemeralPubkey: z.string(),
})
export type KeyEnvelope = z.infer<typeof KeyEnvelopeSchema>

const NotePayloadSchema = z.object({
  text: z.string(),
  fields: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.array(z.string()),
        z.number(),
        z.boolean(),
        z.object({ fileId: z.string() }),
      ])
    )
    .optional(),
})
export type NotePayload = z.infer<typeof NotePayloadSchema>

const EncryptedCallRecordSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  callerLast4: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  duration: z.number().int().optional(),
  status: z.string(),
  hasTranscription: z.boolean(),
  hasVoicemail: z.boolean(),
  hasRecording: z.boolean(),
  recordingSid: z.string().optional(),
  encryptedContent: z.string().optional(),
  adminEnvelopes: z.array(RecipientEnvelopeSchema),
  createdAt: z.iso.datetime(),
})
export type EncryptedCallRecord = z.infer<typeof EncryptedCallRecordSchema>
