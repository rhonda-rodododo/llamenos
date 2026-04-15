import { z } from 'zod/v4'
import { RecipientEnvelopeSchema } from './records'

const ConversationSchema = z.object({
  id: z.uuid(),
  hubId: z.string(),
  channelType: z.enum(['sms', 'whatsapp', 'signal', 'rcs', 'web']),
  contactIdentifierHash: z.string(),
  contactLast4: z.string().optional(),
  externalId: z.string().optional(),
  assignedTo: z.string().optional(),
  status: z.enum(['active', 'waiting', 'closed']),
  reportTypeId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  messageCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime(),
  // E2EE envelope-encrypted contactLast4 (Phase 2D)
  encryptedContactLast4: z.string().optional(),
  contactLast4Envelopes: z.array(RecipientEnvelopeSchema).optional(),
})
export type Conversation = z.infer<typeof ConversationSchema>

const CreateConversationSchema = z.object({
  hubId: z.string().optional(),
  channelType: z.enum(['sms', 'whatsapp', 'signal', 'rcs', 'web']),
  contactIdentifierHash: z.string(),
  contactLast4: z.string().optional(),
  externalId: z.string().optional(),
  assignedTo: z.string().optional(),
})
type CreateConversationInput = z.infer<typeof CreateConversationSchema>

const EncryptedMessageSchema = z.object({
  id: z.uuid(),
  conversationId: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  authorPubkey: z.string(),
  encryptedContent: z.string(),
  readerEnvelopes: z.array(RecipientEnvelopeSchema),
  hasAttachments: z.boolean(),
  attachmentIds: z.array(z.string()),
  externalId: z.string().optional(),
  status: z.enum(['pending', 'sent', 'failed', 'read']),
  deliveredAt: z.iso.datetime().optional(),
  readAt: z.iso.datetime().optional(),
  failureReason: z.string().optional(),
  retryCount: z.number().int(),
  createdAt: z.iso.datetime(),
})
export type EncryptedMessage = z.infer<typeof EncryptedMessageSchema>
