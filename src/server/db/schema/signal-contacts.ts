import type { RecipientEnvelope } from '@shared/types'
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const userSignalContacts = pgTable(
  'user_signal_contacts',
  {
    userPubkey: text('user_pubkey').primaryKey(),
    identifierHash: text('identifier_hash').notNull(),
    identifierCiphertext: ciphertext('identifier_ciphertext').notNull(),
    identifierEnvelope: jsonb<RecipientEnvelope[]>()('identifier_envelope').notNull().default([]),
    identifierType: text('identifier_type').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('user_signal_contacts_identifier_hash_idx').on(table.identifierHash)]
)

export type UserSignalContactRow = typeof userSignalContacts.$inferSelect
export type InsertUserSignalContact = typeof userSignalContacts.$inferInsert
