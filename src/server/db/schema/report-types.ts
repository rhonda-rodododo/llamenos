import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { ciphertext } from '../crypto-columns'
import { hubs } from './settings'

export const reportTypes = pgTable(
  'report_types',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id')
      .notNull()
      .default('global')
      .references(() => hubs.id),
    encryptedName: ciphertext('encrypted_name').notNull(),
    encryptedDescription: ciphertext('encrypted_description'),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('report_types_hub_idx').on(table.hubId),
    // Partial unique index: only one default per hub among non-archived types
    // Note: Drizzle doesn't support WHERE clauses on indexes natively; this is enforced via SQL migration
    // The SQL migration adds: CREATE UNIQUE INDEX report_types_one_default_per_hub ON report_types (hub_id) WHERE is_default = TRUE AND archived_at IS NULL
  ]
)
