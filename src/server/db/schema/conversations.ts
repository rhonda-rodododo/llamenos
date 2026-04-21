import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'
import type { EncryptedMetaItem, FileKeyEnvelope, RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const messageDeliveryStatusEnum = pgEnum('message_delivery_status', [
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
])

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    channelType: text('channel_type').notNull(), // 'sms' | 'whatsapp' | 'signal' | 'rcs' | 'web'
    contactIdentifierHash: text('contact_identifier_hash').notNull(),
    encryptedContactLast4: ciphertext('encrypted_contact_last4'),
    contactLast4Envelopes: jsonb<RecipientEnvelope[]>()('contact_last4_envelopes')
      .notNull()
      .default([]),
    externalId: text('external_id'), // provider's thread/contact ID
    assignedTo: text('assigned_to'), // user pubkey
    status: text('status').notNull().default('active'), // 'active' | 'waiting' | 'closed'
    metadata: jsonb<Record<string, unknown>>()('metadata').notNull().default({}),
    /** FK to report_types (nullable) — set when channelType='web' and metadata.type='report' */
    reportTypeId: text('report_type_id'),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.hubId, table.channelType, table.contactIdentifierHash),
    index('conversations_hub_idx').on(table.hubId),
  ]
)

export const messageEnvelopes = pgTable(
  'message_envelopes',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    direction: text('direction').notNull(), // 'inbound' | 'outbound'
    authorPubkey: text('author_pubkey').notNull(),
    encryptedContent: text('encrypted_content').notNull(),
    readerEnvelopes: jsonb<RecipientEnvelope[]>()('reader_envelopes').notNull().default([]),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    attachmentIds: jsonb<string[]>()('attachment_ids').notNull().default([]),
    externalId: text('external_id'),
    status: text('status').notNull().default('pending'),
    deliveryStatus: messageDeliveryStatusEnum('delivery_status').notNull().default('pending'),
    deliveryStatusUpdatedAt: timestamp('delivery_status_updated_at', { withTimezone: true }),
    providerMessageId: varchar('provider_message_id', { length: 128 }),
    deliveryError: text('delivery_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    retryCount: integer('retry_count').notNull().default(0),
    // MLS group-encrypted ciphertext (base64-encoded TLS-serialized MLS message)
    mlsCiphertext: text('mls_ciphertext'),
    // MLS epoch at which this message was encrypted
    mlsEpoch: integer('mls_epoch'),
    // Server-encrypted body for inbound messages before client claim (AES-GCM under LABEL_MESSAGE)
    serverEncryptedBody: text('server_encrypted_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('message_envelopes_conversation_idx').on(table.conversationId)]
)

export const fileRecords = pgTable('file_records', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  conversationId: text('conversation_id'),
  messageId: text('message_id'),
  uploadedBy: text('uploaded_by').notNull(),
  recipientEnvelopes: jsonb<FileKeyEnvelope[]>()('recipient_envelopes').notNull().default([]),
  encryptedMetadata: jsonb<EncryptedMetaItem[]>()('encrypted_metadata').notNull().default([]),
  totalSize: integer('total_size').notNull(),
  totalChunks: integer('total_chunks').notNull(),
  status: text('status').notNull().default('uploading'), // 'uploading' | 'complete' | 'failed'
  completedChunks: integer('completed_chunks').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  // Optional context binding — set after the parent record (note/report/etc.) is saved
  contextType: text('context_type'), // 'conversation' | 'note' | 'report' | 'custom_field'
  contextId: text('context_id'),
})
