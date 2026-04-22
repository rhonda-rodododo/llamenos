/**
 * Adapter factories for telephony, messaging, and Nostr publisher.
 *
 * Replaces the DO-based factory functions in src/worker/lib/do-access.ts.
 * Takes service instances instead of DO stubs.
 */

import type { MessagingChannelType, TelephonyProviderConfig } from '../../shared/types'
import type { CryptoService } from '../lib/crypto-service'
import { AppError } from '../lib/errors'
import { createLogger } from '../lib/logger'
import { createNostrPublisher, type NostrPublisher } from '../lib/nostr-publisher'
import type { MessagingAdapter } from '../messaging/adapter'
import { createRCSAdapter } from '../messaging/rcs/factory'
import { createSignalAdapter } from '../messaging/signal/factory'
import { createSMSAdapter } from '../messaging/sms/factory'
import { createTelegramAdapter } from '../messaging/telegram/factory'
import { createWhatsAppAdapter } from '../messaging/whatsapp/factory'
import type { SettingsService } from '../services/settings'
import type { TelephonyAdapter } from '../telephony/adapter'
import { AsteriskAdapter } from '../telephony/asterisk'
import { BandwidthAdapter } from '../telephony/bandwidth'
import { FreeSwitchAdapter } from '../telephony/freeswitch'
import { PlivoAdapter } from '../telephony/plivo'
import { SignalWireAdapter } from '../telephony/signalwire'
import { TelnyxAdapter } from '../telephony/telnyx'
import { TwilioAdapter } from '../telephony/twilio'
import { VonageAdapter } from '../telephony/vonage'

const log = createLogger('lib.adapters')

let cachedPublisher: NostrPublisher | null = null

/**
 * Get a TelephonyAdapter for the given hub (or global config).
 * Falls back to env-var Twilio credentials if no DB config is found.
 */
export async function getTelephony(
  settings: SettingsService,
  hubId?: string,
  env?: {
    TWILIO_ACCOUNT_SID?: string
    TWILIO_AUTH_TOKEN?: string
    TWILIO_PHONE_NUMBER?: string
  }
): Promise<TelephonyAdapter | null> {
  // Try hub-specific config first, then global
  const hId = hubId ?? undefined
  let config: TelephonyProviderConfig | null = null

  if (hId) {
    config = await settings.getTelephonyProvider(hId)
  }
  if (!config) {
    config = await settings.getTelephonyProvider(undefined) // global
  }

  if (config) {
    try {
      return createAdapterFromConfig(config)
    } catch (e) {
      // Config exists but is incomplete (e.g. type:'twilio' without credentials).
      // Fall through to env-var / TestAdapter fallback instead of throwing 500.
      log.warn('DB telephony config invalid, falling through to fallback', {
        err: (e as Error).message,
      })
    }
  }

  // Fall back to env vars (Twilio only)
  if (env?.TWILIO_ACCOUNT_SID && env?.TWILIO_AUTH_TOKEN && env?.TWILIO_PHONE_NUMBER) {
    return new TwilioAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER)
  }

  // Test adapter fallback — returns valid TwiML without real API calls
  if (Bun.env.USE_TEST_ADAPTER === 'true') {
    const { TestAdapter } = await import('../telephony/test')
    return new TestAdapter()
  }

  return null
}

/**
 * Get a MessagingAdapter for the specified channel.
 * Throws if the channel is not configured.
 */
export async function getMessagingAdapter(
  channel: MessagingChannelType,
  settings: SettingsService,
  crypto: CryptoService,
  hubId?: string
): Promise<MessagingAdapter> {
  const config = await settings.getMessagingConfig(hubId)
  if (!config?.enabledChannels.includes(channel)) {
    throw new Error(`${channel} channel is not enabled`)
  }

  switch (channel) {
    case 'sms': {
      if (!config.sms?.enabled) throw new Error('SMS is not enabled')
      // SMS reuses telephony provider credentials
      const telConfig = hubId
        ? ((await settings.getTelephonyProvider(hubId)) ??
          (await settings.getTelephonyProvider(undefined)))
        : await settings.getTelephonyProvider(undefined)
      if (!telConfig) throw new Error('SMS requires a configured telephony provider')
      return createSMSAdapter(telConfig, config.sms, crypto)
    }
    case 'whatsapp': {
      if (!config.whatsapp) throw new Error('WhatsApp is not configured')
      return createWhatsAppAdapter(config.whatsapp, crypto)
    }
    case 'signal': {
      if (!config.signal) throw new Error('Signal is not configured')
      return createSignalAdapter(config.signal, crypto)
    }
    case 'rcs': {
      if (!config.rcs) throw new Error('RCS is not configured')
      return createRCSAdapter(config.rcs, crypto)
    }
    case 'telegram': {
      if (!config.telegram) throw new Error('Telegram is not configured')
      return createTelegramAdapter(config.telegram, crypto)
    }
    default:
      throw new Error(`Unknown channel: ${channel}`)
  }
}

/**
 * Get the Nostr event publisher.
 * Lazily creates and caches the publisher instance.
 * Returns a NoopNostrPublisher if no relay is configured.
 */
export function getNostrPublisher(env: {
  NOSFLARE?: { fetch(request: Request): Promise<Response> }
  SERVER_NOSTR_SECRET?: string
  NOSTR_RELAY_URL?: string
}): NostrPublisher {
  if (!cachedPublisher) {
    cachedPublisher = createNostrPublisher(env)
  }
  return cachedPublisher
}

/** Close and reset the cached Nostr publisher (call on graceful shutdown). */
export function closeNostrPublisher(): void {
  if (cachedPublisher) {
    try {
      cachedPublisher.close()
    } catch (err) {
      log.error('Nostr publisher close failed', err)
    }
    cachedPublisher = null
  }
}

/**
 * Create adapter from saved config.
 * Supports Twilio, SignalWire, Vonage, Plivo, and Asterisk (self-hosted).
 */
function createAdapterFromConfig(config: TelephonyProviderConfig): TelephonyAdapter {
  switch (config.type) {
    case 'twilio': {
      if (!config.accountSid || !config.authToken)
        throw new AppError(500, 'Twilio config missing accountSid or authToken')
      return new TwilioAdapter(config.accountSid, config.authToken, config.phoneNumber)
    }
    case 'signalwire': {
      if (!config.accountSid || !config.authToken || !config.signalwireSpace)
        throw new AppError(
          500,
          'SignalWire config missing accountSid, authToken, or signalwireSpace'
        )
      return new SignalWireAdapter(
        config.accountSid,
        config.authToken,
        config.phoneNumber,
        config.signalwireSpace
      )
    }
    case 'vonage': {
      if (!config.apiKey || !config.apiSecret || !config.applicationId)
        throw new AppError(500, 'Vonage config missing apiKey, apiSecret, or applicationId')
      return new VonageAdapter(
        config.apiKey,
        config.apiSecret,
        config.applicationId,
        config.phoneNumber,
        config.privateKey
      )
    }
    case 'plivo': {
      if (!config.authId || !config.authToken)
        throw new AppError(500, 'Plivo config missing authId or authToken')
      return new PlivoAdapter(config.authId, config.authToken, config.phoneNumber)
    }
    case 'asterisk': {
      if (!config.ariUrl || !config.ariUsername || !config.ariPassword || !config.bridgeCallbackUrl)
        throw new AppError(
          500,
          'Asterisk config missing ariUrl, ariUsername, ariPassword, or bridgeCallbackUrl'
        )
      return new AsteriskAdapter(
        config.ariUrl,
        config.ariUsername,
        config.ariPassword,
        config.phoneNumber,
        config.bridgeCallbackUrl,
        config.ariPassword // Bridge secret uses ARI password as shared secret
      )
    }
    case 'telnyx': {
      if (!config.apiKey) throw new AppError(500, 'Telnyx config missing apiKey')
      return new TelnyxAdapter(config.apiKey, config.texmlAppId ?? '', config.phoneNumber)
    }
    case 'bandwidth': {
      if (!config.accountId || !config.apiToken || !config.apiSecret || !config.applicationId)
        throw new AppError(
          500,
          'Bandwidth config missing accountId, apiToken, apiSecret, or applicationId'
        )
      return new BandwidthAdapter(
        config.accountId,
        config.apiToken,
        config.apiSecret,
        config.applicationId,
        config.phoneNumber
      )
    }
    case 'freeswitch': {
      if (!config.eslUrl || !config.eslPassword || !config.bridgeCallbackUrl)
        throw new AppError(
          500,
          'FreeSWITCH config missing eslUrl, eslPassword, or bridgeCallbackUrl'
        )
      return new FreeSwitchAdapter(
        config.phoneNumber,
        config.bridgeCallbackUrl,
        config.bridgeSecret || config.eslPassword,
        config.eslUrl // callbackBaseUrl — the app's public URL for mod_httapi callbacks
      )
    }
  }
  // Unreachable for valid TelephonyProviderConfig values, but the DB may store
  // invalid JSON (e.g. {}). Throw so getTelephony() can fall through to TestAdapter.
  throw new AppError(
    500,
    `Unknown telephony provider type: ${(config as Record<string, unknown>).type ?? 'undefined'}`
  )
}
