import { z } from 'zod/v4'

export const EncryptedFileMetadataSchema = z.object({
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  dimensions: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
  duration: z.number().optional(),
  checksum: z.string(),
})
export type EncryptedFileMetadata = z.infer<typeof EncryptedFileMetadataSchema>

/**
 * V2 ECIES key envelope for a single file recipient.
 * Adds versioning (v=2), wire-format label identity (labelId), and renames
 * encryptedFileKey → wrappedKey to match the EnvelopeV2 interface.
 */
export const FileKeyEnvelopeV2Schema = z.object({
  v: z.literal(2),
  labelId: z.number().int(),
  pubkey: z.string(),
  wrappedKey: z.string(),
  ephemeralPubkey: z.string(),
})
export type FileKeyEnvelope = z.infer<typeof FileKeyEnvelopeV2Schema>

/** @deprecated Pre-Task 8 legacy schema — kept for reading old server responses during migration. */
export const FileKeyEnvelopeSchema = FileKeyEnvelopeV2Schema

export const EncryptedMetaItemSchema = z.object({
  pubkey: z.string(),
  encryptedContent: z.string(),
  ephemeralPubkey: z.string(),
})
export type EncryptedMetaItem = z.infer<typeof EncryptedMetaItemSchema>

export const FileFieldValueSchema = z.object({
  fileId: z.string(),
})
export type FileFieldValue = z.infer<typeof FileFieldValueSchema>

export const FileRecordSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  conversationId: z.string().nullable(),
  messageId: z.string().optional(),
  uploadedBy: z.string(),
  recipientEnvelopes: z.array(FileKeyEnvelopeV2Schema),
  encryptedMetadata: z.array(EncryptedMetaItemSchema),
  totalSize: z.number().int(),
  totalChunks: z.number().int(),
  status: z.enum(['uploading', 'complete', 'failed']),
  completedChunks: z.number().int(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  contextType: z.enum(['conversation', 'note', 'report', 'custom_field', 'voicemail']).optional(),
  contextId: z.string().optional(),
})
export type FileRecord = z.infer<typeof FileRecordSchema>

export const UploadInitSchema = z.object({
  totalSize: z.number().int(),
  totalChunks: z.number().int(),
  conversationId: z.string(),
  /**
   * New uploads (Task 8+) send FileKeyEnvelopeV2 entries.
   * The schema accepts any object shape for forward compat; Task 9 will enforce V2 strictly.
   */
  recipientEnvelopes: z.array(z.object({}).passthrough()),
  encryptedMetadata: z.array(EncryptedMetaItemSchema),
  contextType: z.enum(['conversation', 'note', 'report', 'custom_field', 'voicemail']).optional(),
  contextId: z.string().optional(),
  /**
   * Client-generated UUID for AAD binding (Task 8+).
   * The server records this as the canonical fileId so that the fileId-bound AAD
   * round-trips correctly on decrypt. Server-side acceptance is implemented in Task 9.
   */
  fileId: z.string().uuid().optional(),
})
export type UploadInit = z.infer<typeof UploadInitSchema>
