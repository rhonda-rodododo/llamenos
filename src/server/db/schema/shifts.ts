import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { jsonb } from '../bun-jsonb'
import { ciphertext } from '../crypto-columns'

export const shiftSchedules = pgTable(
  'shift_schedules',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    encryptedName: ciphertext('encrypted_name').notNull(),
    startTime: text('start_time').notNull(), // HH:MM
    endTime: text('end_time').notNull(), // HH:MM
    days: jsonb<number[]>()('days').notNull().default([]), // 0=Sun, 6=Sat
    userPubkeys: jsonb<string[]>()('user_pubkeys').notNull().default([]),
    ringGroupId: text('ring_group_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('shift_schedules_hub_idx').on(table.hubId)]
)

export const shiftOverrides = pgTable('shift_overrides', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  scheduleId: text('schedule_id'),
  date: text('date').notNull(), // YYYY-MM-DD
  type: text('type').notNull(), // 'cancel' | 'substitute'
  userPubkeys: jsonb<string[]>()('user_pubkeys'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ringGroups = pgTable('ring_groups', {
  id: text('id').primaryKey(),
  hubId: text('hub_id').notNull().default('global'),
  encryptedName: ciphertext('encrypted_name').notNull(),
  userPubkeys: jsonb<string[]>()('user_pubkeys').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const activeShifts = pgTable(
  'active_shifts',
  {
    pubkey: text('pubkey').notNull(),
    hubId: text('hub_id').notNull().default('global'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    ringGroupId: text('ring_group_id'),
  },
  (table) => [primaryKey({ columns: [table.pubkey, table.hubId] })]
)
