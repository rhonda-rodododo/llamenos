import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const recoveryRequests = pgTable('recovery_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  initiatedByUserId: text('initiated_by_user_id').notNull(),
  recoveryType: text('recovery_type').notNull().default('admin_reset'),
  status: text('status').notNull().default('pending'),
  threshold: integer('threshold').notNull().default(2),
  participantsCount: integer('participants_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  newDeviceId: text('new_device_id'),
  sigchainEntryId: text('sigchain_entry_id'),
})
