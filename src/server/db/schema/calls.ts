import { index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const callLegTypeEnum = pgEnum('call_leg_type', ['phone', 'browser'])

export const activeCalls = pgTable(
  'active_calls',
  {
    callSid: text('call_sid').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    encryptedCallerNumber: ciphertext('encrypted_caller_number').notNull(),
    status: text('status').notNull().default('ringing'), // 'ringing' | 'in-progress' | 'completed'
    assignedPubkey: text('assigned_pubkey'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb<Record<string, unknown>>()('metadata').notNull().default({}),
  },
  (table) => [index('active_calls_hub_idx').on(table.hubId)]
)

export const callLegs = pgTable(
  'call_legs',
  {
    legSid: text('leg_sid').primaryKey(),
    callSid: text('call_sid').notNull(),
    hubId: text('hub_id').notNull().default('global'),
    userPubkey: text('user_pubkey').notNull(),
    encryptedPhone: ciphertext('encrypted_phone'),
    type: callLegTypeEnum('type').notNull().default('phone'),
    status: text('status').notNull().default('ringing'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('call_legs_call_sid_idx').on(table.callSid)]
)

export const callTokens = pgTable('call_tokens', {
  token: text('token').primaryKey(),
  callSid: text('call_sid').notNull(),
  hubId: text('hub_id').notNull().default('global'),
  pubkey: text('pubkey').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
