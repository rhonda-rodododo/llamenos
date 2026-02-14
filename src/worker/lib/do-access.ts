import type { Env } from '../types'
import type { TelephonyAdapter } from '../telephony/adapter'
import type { TelephonyProviderConfig } from '../../shared/types'
import { TwilioAdapter } from '../telephony/twilio'
import { SignalWireAdapter } from '../telephony/signalwire'
import { VonageAdapter } from '../telephony/vonage'
import { PlivoAdapter } from '../telephony/plivo'
import { AsteriskAdapter } from '../telephony/asterisk'

const IDENTITY_ID = 'global-identity'
const SETTINGS_ID = 'global-settings'
const RECORDS_ID = 'global-records'
const SHIFT_ID = 'global-shifts'
const CALL_ID = 'global-calls'

export interface DurableObjects {
  identity: DurableObjectStub
  settings: DurableObjectStub
  records: DurableObjectStub
  shifts: DurableObjectStub
  calls: DurableObjectStub
}

export function getDOs(env: Env): DurableObjects {
  return {
    identity: env.IDENTITY_DO.get(env.IDENTITY_DO.idFromName(IDENTITY_ID)),
    settings: env.SETTINGS_DO.get(env.SETTINGS_DO.idFromName(SETTINGS_ID)),
    records: env.RECORDS_DO.get(env.RECORDS_DO.idFromName(RECORDS_ID)),
    shifts: env.SHIFT_MANAGER.get(env.SHIFT_MANAGER.idFromName(SHIFT_ID)),
    calls: env.CALL_ROUTER.get(env.CALL_ROUTER.idFromName(CALL_ID)),
  }
}

/**
 * Create a TelephonyAdapter from provider config.
 * Reads config from SettingsDO; falls back to env vars for Twilio.
 */
export async function getTelephony(env: Env, dos: DurableObjects): Promise<TelephonyAdapter> {
  try {
    const res = await dos.settings.fetch(new Request('http://do/settings/telephony-provider'))
    if (res.ok) {
      const config = await res.json() as TelephonyProviderConfig | null
      if (config) {
        return createAdapterFromConfig(config)
      }
    }
  } catch {
    // Fall through to env var defaults
  }

  return new TwilioAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER)
}

/**
 * Create adapter from saved config.
 * Supports Twilio, SignalWire, Vonage, Plivo, and Asterisk (self-hosted).
 */
function createAdapterFromConfig(config: TelephonyProviderConfig): TelephonyAdapter {
  switch (config.type) {
    case 'twilio':
      return new TwilioAdapter(config.accountSid!, config.authToken!, config.phoneNumber)
    case 'signalwire':
      return new SignalWireAdapter(config.accountSid!, config.authToken!, config.phoneNumber, config.signalwireSpace!)
    case 'vonage':
      return new VonageAdapter(config.apiKey!, config.apiSecret!, config.applicationId!, config.phoneNumber, config.privateKey)
    case 'plivo':
      return new PlivoAdapter(config.authId!, config.authToken!, config.phoneNumber)
    case 'asterisk':
      return new AsteriskAdapter(
        config.ariUrl!,
        config.ariUsername!,
        config.ariPassword!,
        config.phoneNumber,
        config.bridgeCallbackUrl!,
        config.ariPassword!, // Bridge secret uses ARI password as shared secret
      )
    default:
      return new TwilioAdapter(config.accountSid!, config.authToken!, config.phoneNumber)
  }
}
