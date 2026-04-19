import { eq } from 'drizzle-orm'
import type { Database } from '../db'
import { type UserSecurityPrefsRow, userSecurityPrefs } from '../db/schema/security-prefs'

export type DigestCadence = 'off' | 'daily' | 'weekly'
export type NotificationChannel = 'web_push' | 'signal'

const DEFAULTS = {
  autoLockMs: 900000,
  disappearingTimerDays: 1,
  digestCadence: 'weekly' as DigestCadence,
  alertOnNewDevice: true,
  alertOnPasskeyChange: true,
  alertOnPinChange: true,
  notificationChannel: 'web_push' as NotificationChannel,
}

export class SecurityPrefsService {
  constructor(private db: Database) {}

  async get(userPubkey: string): Promise<UserSecurityPrefsRow> {
    const rows = await this.db
      .select()
      .from(userSecurityPrefs)
      .where(eq(userSecurityPrefs.userPubkey, userPubkey))
      .limit(1)
    if (rows[0]) return rows[0]
    const inserted = await this.db
      .insert(userSecurityPrefs)
      .values({ userPubkey, ...DEFAULTS })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error('Failed to insert security prefs')
    return row
  }

  async update(
    userPubkey: string,
    patch: Partial<Omit<UserSecurityPrefsRow, 'userPubkey' | 'updatedAt'>>
  ): Promise<UserSecurityPrefsRow> {
    await this.get(userPubkey)
    const rows = await this.db
      .update(userSecurityPrefs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(userSecurityPrefs.userPubkey, userPubkey))
      .returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to update security prefs')
    return row
  }
}
