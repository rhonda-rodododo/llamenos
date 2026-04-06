import type { LockdownTier } from '../../shared/schemas/lockdown'
import type { AuthEventsService } from './auth-events'
import type { IdentityService } from './identity'
import type { SessionService } from './sessions'
import type { UserNotificationsService } from './user-notifications'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Generate a 128-bit random recovery key formatted as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX.
 * Matches the format used in src/client/lib/backup.ts.
 */
export function generateRecoveryKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let base32 = ''
  let bits = 0
  let buffer = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      base32 += BASE32[(buffer >> bits) & 0x1f]
    }
  }
  if (bits > 0) {
    base32 += BASE32[(buffer << (5 - bits)) & 0x1f]
  }
  const groups: string[] = []
  for (let i = 0; i < base32.length; i += 4) {
    groups.push(base32.slice(i, i + 4))
  }
  return groups.join('-')
}

export interface LockdownResult {
  tier: LockdownTier
  revokedSessions: number
  deletedPasskeys: number
  accountDeactivated: boolean
  notificationDelivered: boolean
}

export class SecurityActionsService {
  constructor(
    private sessions: SessionService,
    private identity: IdentityService,
    private authEvents: AuthEventsService,
    private notifications: UserNotificationsService
  ) {}

  async runLockdown(
    userPubkey: string,
    tier: LockdownTier,
    currentSessionId: string | null
  ): Promise<LockdownResult> {
    let deletedPasskeys = 0
    let accountDeactivated = false

    // Tier C revokes EVERYTHING (no exception); A & B keep the current session.
    const keepSessionId = tier === 'C' ? undefined : (currentSessionId ?? undefined)
    const revokedSessions = await this.sessions.revokeAllForUser(
      userPubkey,
      tier === 'A' ? 'lockdown_a' : tier === 'B' ? 'lockdown_b' : 'lockdown_c',
      keepSessionId
    )

    if (tier === 'B' || tier === 'C') {
      const creds = await this.identity.getWebAuthnCredentials(userPubkey)
      // Tier B keeps the credential bound to the current session; tier C deletes all.
      const currentSession = currentSessionId
        ? await this.sessions.findByIdForUser(currentSessionId, userPubkey)
        : null
      const keepCredId = tier === 'B' ? (currentSession?.credentialId ?? null) : null
      for (const cred of creds) {
        if (tier === 'B' && cred.id === keepCredId) continue
        await this.identity.deleteWebAuthnCredential(userPubkey, cred.id)
        deletedPasskeys++
      }
    }

    if (tier === 'C') {
      await this.identity.setUserActive(userPubkey, false)
      accountDeactivated = true
    }

    await this.authEvents.record({
      userPubkey,
      eventType: 'lockdown_triggered',
      payload: { lockdownTier: tier, meta: { revokedSessions, deletedPasskeys } },
    })

    let notificationDelivered = false
    try {
      const { delivered } = await this.notifications.sendAlert(userPubkey, {
        type: 'lockdown_triggered',
        tier,
      })
      notificationDelivered = delivered
    } catch (err) {
      console.error('[security-actions] lockdown notification failed:', err)
    }

    return { tier, revokedSessions, deletedPasskeys, accountDeactivated, notificationDelivered }
  }
}
