import type { RecipientEnvelope } from '@shared/types'
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export type SessionRevokedReason =
  | 'user'
  | 'lockdown_a'
  | 'lockdown_b'
  | 'lockdown_c'
  | 'admin'
  | 'replay'
  | 'expired'

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    userPubkey: text('user_pubkey').notNull(),
    tokenHash: text('token_hash').notNull(),
    /**
     * Previous token hash — accepted on refresh as a one-rotation grace window,
     * to tolerate concurrent refreshes (e.g. two tabs) and provide a minimal
     * replay-detection signal if a stale token is presented.
     */
    prevTokenHash: text('prev_token_hash'),
    ipHash: text('ip_hash').notNull(),
    credentialId: text('credential_id'),
    encryptedMeta: ciphertext('encrypted_meta').notNull(),
    metaEnvelope: jsonb<RecipientEnvelope[]>()('meta_envelope').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason').$type<SessionRevokedReason>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('user_sessions_user_pubkey_idx').on(table.userPubkey),
    index('user_sessions_token_hash_idx').on(table.tokenHash),
    index('user_sessions_prev_token_hash_idx').on(table.prevTokenHash),
    index('user_sessions_expires_at_idx').on(table.expiresAt),
  ]
)

export type UserSessionRow = typeof userSessions.$inferSelect
export type InsertUserSession = typeof userSessions.$inferInsert
