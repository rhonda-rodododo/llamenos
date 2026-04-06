import { boolean, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext, hmacHashed } from '../crypto-columns'

export const users = pgTable('users', {
  pubkey: text('pubkey').primaryKey(),
  roles: jsonb<string[]>()('roles').notNull().default([]),
  hubRoles: jsonb<Array<{ hubId: string; roleIds: string[] }>>()('hub_roles').notNull().default([]),
  encryptedSecretKey: text('encrypted_secret_key').notNull().default(''),
  kekProofHash: text('kek_proof_hash'),
  active: boolean('active').notNull().default(true),
  transcriptionEnabled: boolean('transcription_enabled').notNull().default(true),
  spokenLanguages: jsonb<string[]>()('spoken_languages').notNull().default([]),
  uiLanguage: text('ui_language').notNull().default('en'),
  profileCompleted: boolean('profile_completed').notNull().default(false),
  onBreak: boolean('on_break').notNull().default(false),
  callPreference: text('call_preference').notNull().default('phone'),
  supportedMessagingChannels: jsonb<string[]>()('supported_messaging_channels'),
  messagingEnabled: boolean('messaging_enabled'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  nameEnvelopes: jsonb<RecipientEnvelope[]>()('name_envelopes').notNull().default([]),
  encryptedPhone: ciphertext('encrypted_phone').notNull(),
  phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: text('id').primaryKey(), // base64url credential ID
  pubkey: text('pubkey').notNull(),
  publicKey: text('public_key').notNull(),
  counter: text('counter').notNull().default('0'), // stored as text to avoid bigint issues
  transports: jsonb<string[]>()('transports').notNull().default([]),
  backedUp: boolean('backed_up').notNull().default(false),
  encryptedLabel: ciphertext('encrypted_label'),
  labelEnvelopes: jsonb<RecipientEnvelope[]>()('label_envelopes').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
})

export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: text('id').primaryKey(),
  pubkey: text('pubkey'),
  challenge: text('challenge').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const inviteCodes = pgTable('invite_codes', {
  code: text('code').primaryKey(),
  roleIds: jsonb<string[]>()('role_ids').notNull().default([]),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedBy: text('used_by'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  nameEnvelopes: jsonb<RecipientEnvelope[]>()('name_envelopes').notNull().default([]),
  encryptedPhone: ciphertext('encrypted_phone').notNull(),
  phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes').notNull().default([]),
  recipientPhoneHash: hmacHashed('recipient_phone_hash'),
  deliveryChannel: varchar('delivery_channel', { length: 16 }),
  deliverySentAt: timestamp('delivery_sent_at', { withTimezone: true }),
})

export const provisionRooms = pgTable('provision_rooms', {
  roomId: text('room_id').primaryKey(),
  ephemeralPubkey: text('ephemeral_pubkey').notNull(),
  token: text('token').notNull(),
  status: text('status').notNull().default('waiting'),
  encryptedNsec: text('encrypted_nsec'),
  primaryPubkey: text('primary_pubkey'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const webauthnSettings = pgTable('webauthn_settings', {
  id: text('id').primaryKey().default('global'),
  requireForAdmins: boolean('require_for_admins').notNull().default(false),
  requireForUsers: boolean('require_for_users').notNull().default(false),
})
