import { eq } from 'drizzle-orm'
import type { Database } from '../db'
import { userSecurityPrefs } from '../db/schema/security-prefs'
import type { AuthEventsService } from './auth-events'
import type { SecurityPrefsService } from './security-prefs'
import type { SignalContactsService } from './signal-contacts'
import type { UserNotificationsService } from './user-notifications'

export async function runDigestCron(
  db: Database,
  authEvents: AuthEventsService,
  _prefs: SecurityPrefsService,
  signalContacts: SignalContactsService,
  notifications: UserNotificationsService,
  cadence: 'daily' | 'weekly'
): Promise<{ sent: number }> {
  const periodDays = cadence === 'daily' ? 1 : 7
  const since = new Date(Date.now() - periodDays * 86400_000)

  const targets = await db
    .select()
    .from(userSecurityPrefs)
    .where(eq(userSecurityPrefs.digestCadence, cadence))

  let sent = 0
  for (const user of targets) {
    const contact = await signalContacts.findByUser(user.userPubkey)
    if (!contact) continue
    const events = await authEvents.listForUser(user.userPubkey, { limit: 200, since })
    const loginCount = events.filter((e) => e.eventType === 'login').length
    const failedCount = events.filter((e) => e.eventType === 'login_failed').length
    const alertCount = events.filter((e) => e.eventType === 'alert_sent').length
    const result = await notifications.sendAlert(user.userPubkey, {
      type: 'digest',
      periodDays,
      loginCount,
      alertCount,
      failedCount,
    })
    if (result.delivered) sent++
  }
  return { sent }
}
