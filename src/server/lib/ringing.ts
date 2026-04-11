import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import { KIND_CALL_RING } from '@shared/nostr-events'
import type { Services } from '../services'
import type { Env } from '../types'
import { getTelephony } from './adapters'
import { createLogger } from './logger'
import { publishNostrEvent } from './nostr-events'

const log = createLogger('lib.ringing')

export async function startParallelRinging(
  callSid: string,
  callerNumber: string,
  origin: string,
  env: Env,
  services: Services,
  hubId?: string
) {
  try {
    // Get on-shift users
    let onShiftPubkeys = await services.shifts.getEffectiveUsers(hubId)

    // If no one is on shift, use fallback group
    if (onShiftPubkeys.length === 0) {
      onShiftPubkeys = await services.settings.getFallbackGroup(hubId)
    }

    log.info('Ringing users', { callSid, onShiftCount: onShiftPubkeys.length })

    if (onShiftPubkeys.length === 0) {
      log.info('No users on shift or in fallback — skipping')
      return
    }

    // Get user details (including call preference)
    const allUsers = await services.identity.getUsers()

    // All available on-shift users (for WebSocket notification)
    const available = allUsers.filter(
      (v) => onShiftPubkeys.includes(v.pubkey) && v.active && !v.onBreak
    )

    // Build unified user list with phone and/or browser identity per user
    const toRing = available
      .filter((v) => {
        const pref = v.callPreference ?? 'phone'
        return (
          ((pref === 'phone' || pref === 'both') && v.phone) ||
          pref === 'browser' ||
          pref === 'both'
        )
      })
      .map((v) => {
        const pref = v.callPreference ?? 'phone'
        return {
          pubkey: v.pubkey,
          phone: (pref === 'phone' || pref === 'both') && v.phone ? v.phone : undefined,
          browserIdentity:
            pref === 'browser' || pref === 'both' ? `vol_${v.pubkey.slice(0, 16)}` : undefined,
        }
      })

    // Count phone vs browser for logging
    const phoneCount = toRing.filter((v) => v.phone).length
    const browserCount = toRing.filter((v) => v.browserIdentity).length

    if (available.length === 0) {
      log.info('No available users — skipping')
      return
    }

    log.info('Ringing available users', {
      callSid,
      total: available.length,
      phoneCount,
      browserCount,
    })

    // Record incoming call in the call service (includes all available users for WebSocket)
    await services.calls.createActiveCall({
      callSid,
      hubId: hubId ?? 'global',
      callerNumber,
      status: 'ringing',
    })

    // Auto-link to contact if phone hash matches a known contact
    try {
      const callerPhoneHash = services.crypto.hmac(callerNumber, HMAC_PHONE_PREFIX)
      const contact = await services.contacts.findByIdentifierHash(
        callerPhoneHash,
        hubId ?? 'global'
      )
      if (contact) {
        await services.contacts.linkCall(contact.id, callSid, hubId ?? 'global', 'auto')
      }
    } catch (err) {
      log.error('Auto-link contact failed (non-fatal)', err)
    }

    // Publish call:ring event to Nostr relay for real-time client notification
    publishNostrEvent(
      env,
      KIND_CALL_RING,
      {
        type: 'call:ring',
        callId: callSid,
        callSid,
        hubId: hubId ?? 'global',
        startedAt: new Date().toISOString(),
      },
      hubId
    )

    // Send Web Push notifications to all available users (fire-and-forget)
    const availablePubkeys = available.map((v) => v.pubkey)
    services.push
      .sendPushToUsers(
        availablePubkeys,
        { type: 'call:ring', callSid, hubId: hubId ?? 'global' },
        env
      )
      .catch((err) =>
        log.warn('Push notification failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      )

    // Create browser call legs for users with browser identity
    for (const usr of toRing.filter((v) => v.browserIdentity)) {
      await services.calls.createCallLeg({
        legSid: `browser_${callSid}_${usr.pubkey.slice(0, 8)}`,
        callSid,
        hubId: hubId ?? 'global',
        userPubkey: usr.pubkey,
        type: 'browser',
      })
    }

    // Ring users via telephony adapter (handles both phone and browser legs)
    if (toRing.length > 0) {
      const adapter = await getTelephony(services.settings, hubId, {
        TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
      })
      if (!adapter) {
        log.warn('No telephony adapter configured — phone users cannot be rung')
        // Don't return — browser-only users can still handle the call via WebSocket
      } else {
        await adapter.ringUsers({
          callSid,
          callerNumber,
          users: toRing,
          callbackUrl: origin,
          hubId,
        })
      }
    }
  } catch (err) {
    log.error('startParallelRinging failed', err)
  }
}
