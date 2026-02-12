import type { Env } from '../types'
import type { TelephonyAdapter } from '../telephony/adapter'
import type { TelephonyProviderConfig } from '../../shared/types'
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

/**
 * Create a TelephonyAdapter from provider config.
 * Reads config from SessionManagerDO; falls back to env vars for Twilio.
 */
export async function getTelephony(env: Env, dos: DurableObjects): Promise<TelephonyAdapter> {
  // Try reading provider config from DO
  try {
    const res = await dos.session.fetch(new Request('http://do/settings/telephony-provider'))
    if (res.ok) {
      const config = await res.json() as TelephonyProviderConfig | null
      if (config) {
        return createAdapterFromConfig(config)
      }
    }
  } catch {
    // Fall through to env var defaults
  }

  // Fallback to Twilio env vars
  return new TwilioAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER)
}

/**
 * Create adapter from saved config. Only Twilio is implemented now;
 * other providers will be added in Epic 33.
 */
function createAdapterFromConfig(config: TelephonyProviderConfig): TelephonyAdapter {
  switch (config.type) {
    case 'twilio':
      return new TwilioAdapter(config.accountSid!, config.authToken!, config.phoneNumber)
    case 'signalwire':
      // SignalWire extends TwilioAdapter with different URLs — will be added in Epic 33
      // For now, fall through to Twilio (SignalWire is API-compatible)
      return new TwilioAdapter(config.accountSid!, config.authToken!, config.phoneNumber)
    case 'vonage':
    case 'plivo':
    case 'asterisk':
      // These adapters will be implemented in Epic 33/35.
      // Config can be saved now; adapter creation will fail gracefully.
      throw new Error(`Provider "${config.type}" is not yet implemented. Please configure Twilio or SignalWire.`)
    default:
      return new TwilioAdapter(config.accountSid!, config.authToken!, config.phoneNumber)
  }
}
