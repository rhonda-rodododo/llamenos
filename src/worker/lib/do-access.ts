import type { Env } from '../types'
import type { TelephonyAdapter } from '../telephony/adapter'
import { TwilioAdapter } from '../telephony/twilio'

const SESSION_ID = 'global-session'
const SHIFT_ID = 'global-shifts'
const CALL_ID = 'global-calls'

export interface DurableObjects {
  session: DurableObjectStub
  shifts: DurableObjectStub
  calls: DurableObjectStub
}

export function getDOs(env: Env): DurableObjects {
  return {
    session: env.SESSION_MANAGER.get(env.SESSION_MANAGER.idFromName(SESSION_ID)),
    shifts: env.SHIFT_MANAGER.get(env.SHIFT_MANAGER.idFromName(SHIFT_ID)),
    calls: env.CALL_ROUTER.get(env.CALL_ROUTER.idFromName(CALL_ID)),
  }
}

export function getTelephony(env: Env): TelephonyAdapter {
  return new TwilioAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER)
}
