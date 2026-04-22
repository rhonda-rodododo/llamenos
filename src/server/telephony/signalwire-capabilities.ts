import type { SignalWireConfig } from '@shared/schemas/providers'
import { SignalWireConfigSchema } from '@shared/schemas/providers'
import type {
  AutoConfigResult,
  ConnectionTestResult,
  NumberSearchQuery,
  PhoneNumberInfo,
  ProvisionResult,
  WebhookUrlSet,
} from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

function apiBase(config: SignalWireConfig): string {
  return (
    ((config as Record<string, unknown>)._testBaseUrl as string) ??
    `https://${config.signalwireSpace}.signalwire.com/api/laml`
  )
}

function basicAuth(sid: string, token: string): string {
  return `Basic ${btoa(`${sid}:${token}`)}`
}

export const signalwireCapabilities: ProviderCapabilities<SignalWireConfig> = {
  type: 'signalwire',
  displayName: 'SignalWire',
  description: 'Open-source compatible cloud communications with voice, SMS, and SIP support',
  credentialSchema: SignalWireConfigSchema,
  supportsOAuth: false,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config: SignalWireConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const url = `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}.json`
      const res = await fetch(url, {
        headers: { Authorization: basicAuth(config.accountSid, config.authToken) },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          connected: false,
          latencyMs,
          error: `HTTP ${res.status}`,
          errorType:
            res.status === 401
              ? 'invalid_credentials'
              : res.status === 429
                ? 'rate_limited'
                : 'unknown',
        }
      }
      const data = (await res.json()) as { friendly_name?: string; status?: string }
      if (data.status === 'suspended') {
        return {
          connected: false,
          latencyMs,
          error: 'Account suspended',
          errorType: 'account_suspended',
        }
      }
      return { connected: true, latencyMs, accountName: data.friendly_name }
    } catch (err) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: String(err),
        errorType: 'network_error',
      }
    }
  },

  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return {
      voiceIncoming: `${baseUrl}/telephony/incoming${qs}`,
      voiceStatus: `${baseUrl}/telephony/call-status${qs}`,
      smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}`,
    }
  },

  async listOwnedNumbers(config: SignalWireConfig): Promise<PhoneNumberInfo[]> {
    const url = `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`
    const res = await fetch(url, {
      headers: { Authorization: basicAuth(config.accountSid, config.authToken) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`SignalWire listOwnedNumbers: HTTP ${res.status}`)
    const data = (await res.json()) as {
      incoming_phone_numbers: Array<{
        phone_number: string
        iso_country: string
        locality?: string
        capabilities: { voice: boolean; sms: boolean; mms: boolean }
      }>
    }
    return data.incoming_phone_numbers.map((n) => ({
      number: n.phone_number,
      country: n.iso_country,
      locality: n.locality,
      capabilities: {
        voice: n.capabilities.voice,
        sms: n.capabilities.sms,
        mms: n.capabilities.mms,
      },
      owned: true,
    }))
  },

  async searchAvailableNumbers(
    config: SignalWireConfig,
    query: NumberSearchQuery
  ): Promise<PhoneNumberInfo[]> {
    const params = new URLSearchParams()
    if (query.areaCode) params.set('AreaCode', query.areaCode)
    if (query.contains) params.set('Contains', query.contains)
    if (query.limit) params.set('PageSize', String(query.limit))
    const country = query.country || 'US'
    const url = `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/AvailablePhoneNumbers/${country}/Local.json?${params}`
    const res = await fetch(url, {
      headers: { Authorization: basicAuth(config.accountSid, config.authToken) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`SignalWire searchAvailableNumbers: HTTP ${res.status}`)
    const data = (await res.json()) as {
      available_phone_numbers: Array<{
        phone_number: string
        iso_country: string
        locality?: string
        capabilities: { voice: boolean; SMS: boolean; MMS: boolean }
      }>
    }
    return data.available_phone_numbers.map((n) => ({
      number: n.phone_number,
      country: n.iso_country,
      locality: n.locality,
      capabilities: {
        voice: n.capabilities.voice,
        sms: n.capabilities.SMS,
        mms: n.capabilities.MMS,
      },
      owned: false,
    }))
  },

  async provisionNumber(config: SignalWireConfig, number: string): Promise<ProvisionResult> {
    const url = `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`
    const body = new URLSearchParams({ PhoneNumber: number })
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(config.accountSid, config.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string }
      return { ok: false, error: err.message ?? `HTTP ${res.status}` }
    }
    const data = (await res.json()) as { phone_number: string }
    return { ok: true, number: data.phone_number }
  },

  async configureWebhooks(
    config: SignalWireConfig,
    phoneNumber: string,
    webhookUrls: WebhookUrlSet
  ): Promise<AutoConfigResult> {
    const listUrl = `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`
    const listRes = await fetch(listUrl, {
      headers: { Authorization: basicAuth(config.accountSid, config.authToken) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!listRes.ok) return { ok: false, error: `Failed to list numbers: HTTP ${listRes.status}` }
    const listData = (await listRes.json()) as { incoming_phone_numbers: Array<{ sid: string }> }
    const numberSid = listData.incoming_phone_numbers[0]?.sid
    if (!numberSid) return { ok: false, error: `Number ${phoneNumber} not found on account` }

    const body = new URLSearchParams()
    if (webhookUrls.voiceIncoming) body.set('VoiceUrl', webhookUrls.voiceIncoming)
    if (webhookUrls.voiceStatus) body.set('StatusCallbackUrl', webhookUrls.voiceStatus)
    if (webhookUrls.voiceFallback) body.set('VoiceFallbackUrl', webhookUrls.voiceFallback)
    if (webhookUrls.smsIncoming) body.set('SmsUrl', webhookUrls.smsIncoming)
    if (webhookUrls.smsStatus) body.set('SmsStatusCallbackUrl', webhookUrls.smsStatus)
    body.set('VoiceMethod', 'POST')
    body.set('SmsMethod', 'POST')

    const updateUrl = `${apiBase(config)}/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers/${numberSid}.json`
    const updateRes = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(config.accountSid, config.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    if (!updateRes.ok) {
      const err = (await updateRes.json().catch(() => ({}))) as { message?: string }
      return { ok: false, error: err.message ?? `HTTP ${updateRes.status}` }
    }
    return { ok: true, details: { numberSid } }
  },
}
