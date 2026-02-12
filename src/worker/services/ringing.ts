import type { Env } from '../types'
import type { DurableObjects } from '../lib/do-access'
import { getTelephony } from '../lib/do-access'

export async function startParallelRinging(
  callSid: string,
  callerNumber: string,
  origin: string,
  env: Env,
  dos: DurableObjects,
) {
  try {
    // Get on-shift volunteers
    const shiftRes = await dos.shifts.fetch(new Request('http://do/current-volunteers'))
    let { volunteers: onShiftPubkeys } = await shiftRes.json() as { volunteers: string[] }

    // If no one is on shift, use fallback group
    if (onShiftPubkeys.length === 0) {
      const fallbackRes = await dos.session.fetch(new Request('http://do/fallback'))
      const fallback = await fallbackRes.json() as { volunteers: string[] }
      onShiftPubkeys = fallback.volunteers
    }

    console.log(`[ringing] callSid=${callSid} onShift=${onShiftPubkeys.length}`)

    if (onShiftPubkeys.length === 0) {
      console.log('[ringing] no volunteers on shift or in fallback — skipping')
      return
    }

    // Get volunteer phone numbers
    const volRes = await dos.session.fetch(new Request('http://do/volunteers'))
    const { volunteers: allVolunteers } = await volRes.json() as { volunteers: Array<{ pubkey: string; phone: string; active: boolean; onBreak?: boolean }> }

    const toRing = allVolunteers
      .filter(v => onShiftPubkeys.includes(v.pubkey) && v.active && v.phone && !v.onBreak)
      .map(v => ({ pubkey: v.pubkey, phone: v.phone }))

    if (toRing.length === 0) {
      console.log('[ringing] no available volunteers with phones — skipping')
      return
    }

    console.log(`[ringing] ringing ${toRing.length} volunteers for callSid=${callSid}`)

    // Notify CallRouter DO of the incoming call
    await dos.calls.fetch(new Request('http://do/calls/incoming', {
      method: 'POST',
      body: JSON.stringify({
        callSid,
        callerNumber,
        volunteerPubkeys: toRing.map(v => v.pubkey),
      }),
    }))

    // Ring all volunteers via telephony adapter
    const adapter = await getTelephony(env, dos)
    await adapter.ringVolunteers({
      callSid,
      callerNumber,
      volunteers: toRing,
      callbackUrl: origin,
    })
  } catch (err) {
    console.error('[ringing] startParallelRinging failed:', err)
  }
}
