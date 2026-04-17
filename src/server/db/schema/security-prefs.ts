import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const userSecurityPrefs = pgTable('user_security_prefs', {
  userPubkey: text('user_pubkey').primaryKey(),
  autoLockMs: integer('auto_lock_ms').notNull().default(900000),
  disappearingTimerDays: integer('disappearing_timer_days').notNull().default(1),
  digestCadence: text('digest_cadence').notNull().default('weekly'),
  alertOnNewDevice: boolean('alert_on_new_device').notNull().default(true),
  alertOnPasskeyChange: boolean('alert_on_passkey_change').notNull().default(true),
  alertOnPinChange: boolean('alert_on_pin_change').notNull().default(true),
  notificationChannel: text('notification_channel').notNull().default('web_push'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type UserSecurityPrefsRow = typeof userSecurityPrefs.$inferSelect
export type InsertUserSecurityPrefs = typeof userSecurityPrefs.$inferInsert
