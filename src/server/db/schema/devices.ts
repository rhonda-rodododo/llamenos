import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { hubs } from './settings'

export const userDevices = pgTable('user_devices', {
  deviceId: text('device_id').primaryKey(),
  userId: text('user_id').notNull(),
  signingPubkey: text('signing_pubkey').notNull(),
  encryptionPubkey: text('encryption_pubkey').notNull(),
  encryptedDisplayName: text('encrypted_display_name').notNull(),
  addedByDeviceId: text('added_by_device_id'),
  addedSigchainEntryId: text('added_sigchain_entry_id').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBySigchainEntryId: text('revoked_by_sigchain_entry_id'),
  revokedReason: text('revoked_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userPukEnvelopes = pgTable('user_puk_envelopes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  generation: integer('generation').notNull(),
  envelope: text('envelope').notNull(),
  sigchainEntryId: text('sigchain_entry_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Tier 3 P1 hardening (0061 migration): hub_id must reference hubs.id with
// ON DELETE CASCADE so deleting a hub sweeps its PTK generations atomically
// and we never leave orphan key metadata pointing at a non-existent hub.
export const hubPtkGenerations = pgTable('hub_ptk_generations', {
  id: text('id').primaryKey(),
  hubId: text('hub_id')
    .notNull()
    .references(() => hubs.id, { onDelete: 'cascade' }),
  generation: integer('generation').notNull(),
  oldGenWrappedUnderNew: text('old_gen_wrapped_under_new'),
  rotatedBySigchainEntryId: text('rotated_by_sigchain_entry_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Tier 3 P1 hardening (0061 migration): every envelope row must point at a
// live hub and a live device. Cascade both so hub deletion and device
// revocation (hard delete) sweep wrapped hub-key material atomically.
export const hubKeyEnvelopes = pgTable('hub_key_envelopes', {
  id: text('id').primaryKey(),
  hubId: text('hub_id')
    .notNull()
    .references(() => hubs.id, { onDelete: 'cascade' }),
  generation: integer('generation').notNull(),
  deviceId: text('device_id')
    .notNull()
    .references(() => userDevices.deviceId, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  envelope: text('envelope').notNull(),
  sigchainEntryId: text('sigchain_entry_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const deviceEnrollmentSessions = pgTable('device_enrollment_sessions', {
  sessionId: text('session_id').primaryKey(),
  userId: text('user_id').notNull(),
  primaryDeviceId: text('primary_device_id').notNull(),
  candidateSigningPubkey: text('candidate_signing_pubkey').notNull(),
  candidateEncryptionPubkey: text('candidate_encryption_pubkey').notNull(),
  enrollmentNonce: text('enrollment_nonce').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const userMasterWraps = pgTable('user_master_wraps', {
  userId: text('user_id').primaryKey(),
  masterSeedUnderPukSecretbox: text('master_seed_under_puk_secretbox').notNull(),
  masterSeedUnderRecoveryGroup: text('master_seed_under_recovery_group'),
  pukSeedUnderRecoveryGroup: text('puk_seed_under_recovery_group'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
