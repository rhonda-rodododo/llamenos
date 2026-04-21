import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AuditEntryPayload } from '../../../shared/schemas/audit-entries'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext, hmacHashed } from '../crypto-columns'

export const bans = pgTable(
  'bans',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    phoneHash: hmacHashed('phone_hash').notNull(),
    encryptedPhone: ciphertext('encrypted_phone').notNull(),
    phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes').notNull().default([]),
    encryptedReason: ciphertext('encrypted_reason').notNull(),
    reasonEnvelopes: jsonb<RecipientEnvelope[]>()('reason_envelopes').notNull().default([]),
    bannedBy: text('banned_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bans_hub_phone_hash_idx').on(table.hubId, table.phoneHash)]
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    actorPubkey: text('actor_pubkey').notNull(),
    previousEntryHash: text('previous_entry_hash'),
    entryHash: text('entry_hash'),
    encryptedEvent: ciphertext('encrypted_event').notNull(),
    encryptedDetails: ciphertext('encrypted_details').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_hub_idx').on(table.hubId),
    index('audit_log_hub_created_idx').on(table.hubId, table.createdAt),
  ]
)

/**
 * Signed audit entries — Tier 0 high-assurance audit chain.
 *
 * Separate from `audit_log` (activity log). These entries are schnorr-signed
 * by the signer's identity key, chained by SHA-256 of the canonicalized
 * payload, and carry a discriminated-union payload describing membership
 * changes, role changes, key rotations, and device lifecycle events.
 */
export const signedAuditEntries = pgTable(
  'signed_audit_entries',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb<AuditEntryPayload>()('payload').notNull(),
    prevEntryHash: text('prev_entry_hash'),
    entryHash: text('entry_hash').notNull(),
    signerDeviceId: text('signer_device_id').notNull(),
    signerPubkey: text('signer_pubkey').notNull(),
    signature: text('signature').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('signed_audit_entries_hub_type_created_idx').on(table.hubId, table.type, table.createdAt),
    index('signed_audit_entries_hub_signer_idx').on(table.hubId, table.signerPubkey),
    // Prevents two appenders racing on the same head (lost update on fork).
    unique('signed_audit_entries_hub_prev_hash_unique').on(table.hubId, table.prevEntryHash),
    // Global uniqueness turns accidental/adversarial hash collisions into
    // clean insert failures that the route layer translates to AuditChainError.
    unique('signed_audit_entries_entry_hash_unique').on(table.entryHash),
    // At most one genesis entry per hub. Postgres treats NULLs as distinct
    // in plain UNIQUE, so the hub uniqueness of the null-prev row needs a
    // partial unique index instead.
    uniqueIndex('signed_audit_entries_hub_genesis_unique')
      .on(table.hubId)
      .where(sql`${table.prevEntryHash} IS NULL`),
  ]
)

export const callRecords = pgTable(
  'call_records',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    encryptedCallerLast4: ciphertext('encrypted_caller_last4'),
    callerLast4Envelopes: jsonb<RecipientEnvelope[]>()('caller_last4_envelopes')
      .notNull()
      .default([]),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    duration: integer('duration'),
    status: text('status').notNull().default('completed'),
    hasTranscription: boolean('has_transcription').notNull().default(false),
    hasVoicemail: boolean('has_voicemail').notNull().default(false),
    hasRecording: boolean('has_recording').notNull().default(false),
    recordingSid: text('recording_sid'),
    voicemailFileId: text('voicemail_file_id'),
    // Encrypted fields (envelope pattern)
    encryptedContent: text('encrypted_content'),
    adminEnvelopes: jsonb<RecipientEnvelope[]>()('admin_envelopes').notNull().default([]),
  },
  (table) => [
    index('call_records_hub_idx').on(table.hubId),
    index('call_records_hub_started_idx').on(table.hubId, table.startedAt),
  ]
)

export const noteEnvelopes = pgTable(
  'note_envelopes',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    callId: text('call_id'),
    conversationId: text('conversation_id'),
    contactHash: text('contact_hash'),
    authorPubkey: text('author_pubkey').notNull(),
    encryptedContent: text('encrypted_content'),
    ephemeralPubkey: text('ephemeral_pubkey'),
    authorEnvelope: jsonb<RecipientEnvelope>()('author_envelope'),
    adminEnvelopes: jsonb<RecipientEnvelope[]>()('admin_envelopes').default([]),
    mlsCiphertext: text('mls_ciphertext'),
    mlsEpoch: integer('mls_epoch'),
    replyCount: integer('reply_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('note_envelopes_hub_idx').on(table.hubId),
    index('note_envelopes_call_idx').on(table.callId),
    index('note_envelopes_contact_hash_idx').on(table.contactHash),
  ]
)

/** Note replies — Epic 123 placeholder. Schema matches parent note encryption pattern. */
export const noteReplies = pgTable('note_replies', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  parentNoteId: text('parent_note_id').notNull(),
  encryptedContent: text('encrypted_content'),
  authorEnvelope: jsonb<RecipientEnvelope>()('author_envelope'),
  adminEnvelopes: jsonb<RecipientEnvelope[]>()('admin_envelopes').default([]),
  mlsCiphertext: text('mls_ciphertext'),
  mlsEpoch: integer('mls_epoch'),
  authorPubkey: text('author_pubkey').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
