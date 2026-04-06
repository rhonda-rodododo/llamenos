import type { AuthEventsService } from './auth-events'
import type { SecurityPrefsService } from './security-prefs'
import type { SignalContactsService } from './signal-contacts'

export type AlertInput =
  | { type: 'new_device'; city: string; country: string; userAgent: string }
  | { type: 'passkey_added'; credentialLabel: string }
  | { type: 'passkey_removed'; credentialLabel: string }
  | { type: 'pin_changed' }
  | { type: 'recovery_rotated' }
  | { type: 'lockdown_triggered'; tier: 'A' | 'B' | 'C' }
  | { type: 'session_revoked_remote'; city: string; country: string }
  | {
      type: 'digest'
      periodDays: number
      loginCount: number
      alertCount: number
      failedCount: number
    }

export function formatDisappearingTimerSeconds(days: number): number {
  return days * 86400
}

export function renderAlertMessage(input: AlertInput): string {
  switch (input.type) {
    case 'new_device':
      return `New sign-in detected from ${input.city}, ${input.country} (${input.userAgent}). If this wasn't you, revoke the session and rotate your PIN.`
    case 'passkey_added':
      return `Passkey "${input.credentialLabel}" was added to your account.`
    case 'passkey_removed':
      return `Passkey "${input.credentialLabel}" was removed from your account.`
    case 'pin_changed':
      return "Your PIN was changed. If this wasn't you, trigger an emergency lockdown."
    case 'recovery_rotated':
      return 'Your recovery key was rotated. Save the new key in a safe place.'
    case 'lockdown_triggered':
      return `Emergency lockdown tier ${input.tier} was triggered on your account.`
    case 'session_revoked_remote':
      return `A session from ${input.city}, ${input.country} was revoked.`
    case 'digest':
      return `Weekly summary: ${input.loginCount} login(s), ${input.alertCount} alert(s), ${input.failedCount} failed attempt(s) over the last ${input.periodDays} days.`
  }
}

const MAX_RETRIES = 3

async function sendToNotifier(
  notifierUrl: string,
  apiKey: string,
  identifierHash: string,
  message: string,
  disappearingTimerSeconds: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${notifierUrl.replace(/\/+$/, '')}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ identifierHash, message, disappearingTimerSeconds }),
    })
    if (!res.ok) {
      return { ok: false, error: `Notifier ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'notifier error' }
  }
}

export interface UserNotificationsConfig {
  notifierUrl: string
  notifierApiKey: string
}

export class UserNotificationsService {
  constructor(
    private signalContacts: SignalContactsService,
    private prefs: SecurityPrefsService,
    private authEvents: AuthEventsService,
    private config: UserNotificationsConfig
  ) {}

  async sendAlert(userPubkey: string, alert: AlertInput): Promise<{ delivered: boolean }> {
    const contact = await this.signalContacts.findByUser(userPubkey)
    if (!contact) return { delivered: false }
    const prefs = await this.prefs.get(userPubkey)

    if (alert.type === 'digest' && prefs.digestCadence === 'off') {
      return { delivered: false }
    }

    const message = renderAlertMessage(alert)
    const timer = formatDisappearingTimerSeconds(prefs.disappearingTimerDays)

    let lastErr = ''
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await sendToNotifier(
        this.config.notifierUrl,
        this.config.notifierApiKey,
        contact.identifierHash,
        message,
        timer
      )
      if (result.ok) {
        await this.authEvents.record({
          userPubkey,
          eventType: 'alert_sent',
          payload: { meta: { alertType: alert.type } },
        })
        return { delivered: true }
      }
      lastErr = result.error ?? 'unknown'
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt))
    }

    console.error(`[user-notifications] delivery failed for ${userPubkey}: ${lastErr}`)
    return { delivered: false }
  }
}
