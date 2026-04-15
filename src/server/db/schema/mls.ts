import {
  bigint,
  customType,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { userDevices } from './devices'
import { hubs } from './settings'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
  fromDriver: (val) => val,
  toDriver: (val) => val,
})

export const mlsHubState = pgTable('mls_hub_state', {
  hubId: text('hub_id')
    .primaryKey()
    .references(() => hubs.id, { onDelete: 'cascade' }),
  groupId: bytea('group_id').notNull(),
  ciphersuite: smallint('ciphersuite').notNull().default(1),
  currentEpoch: bigint('current_epoch', { mode: 'number' }).notNull().default(0),
  lastCommitAt: timestamp('last_commit_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const mlsKeyPackages = pgTable(
  'mls_key_packages',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => userDevices.deviceId, { onDelete: 'cascade' }),
    hubId: text('hub_id')
      .notNull()
      .references(() => hubs.id, { onDelete: 'cascade' }),
    keyPackageRef: bytea('key_package_ref').notNull(),
    keyPackageData: bytea('key_package_data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    unique('mls_key_packages_device_hub_ref_uniq').on(
      table.deviceId,
      table.hubId,
      table.keyPackageRef
    ),
    index('mls_key_packages_hub_consumed_idx').on(table.hubId, table.consumedAt),
  ]
)

export const mlsEpochCommits = pgTable(
  'mls_epoch_commits',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id')
      .notNull()
      .references(() => hubs.id, { onDelete: 'cascade' }),
    epoch: bigint('epoch', { mode: 'number' }).notNull(),
    committerDeviceId: text('committer_device_id')
      .notNull()
      .references(() => userDevices.deviceId),
    commitData: bytea('commit_data').notNull(),
    welcomeData: bytea('welcome_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('mls_epoch_commits_hub_epoch_uniq').on(table.hubId, table.epoch),
    index('mls_epoch_commits_hub_epoch_idx').on(table.hubId, table.epoch),
  ]
)
