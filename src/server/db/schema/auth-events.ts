import type { RecipientEnvelope } from '@shared/types'
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const AUTH_EVENT_TYPES = [
  'login',
  'login_failed',
  'logout',
  'session_revoked',
  'sessions_revoked_others',
  'passkey_added',
  'passkey_removed',
  'passkey_renamed',
  'pin_changed',
  'recovery_rotated',
  'lockdown_triggered',
  'alert_sent',
  'signal_contact_changed',
] as const

export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number]

export const userAuthEvents = pgTable(
  'user_auth_events',
  {
    id: text('id').primaryKey(),
    userPubkey: text('user_pubkey').notNull(),
    eventType: text('event_type').notNull().$type<AuthEventType>(),
    encryptedPayload: ciphertext('encrypted_payload').notNull(),
    payloadEnvelope: jsonb<RecipientEnvelope[]>()('payload_envelope').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reportedSuspiciousAt: timestamp('reported_suspicious_at', { withTimezone: true }),
  },
  (table) => [
    index('user_auth_events_user_created_idx').on(table.userPubkey, table.createdAt),
    index('user_auth_events_created_at_idx').on(table.createdAt),
  ]
)

export type UserAuthEventRow = typeof userAuthEvents.$inferSelect
export type InsertUserAuthEvent = typeof userAuthEvents.$inferInsert
