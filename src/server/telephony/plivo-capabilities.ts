import type { PlivoConfig } from '@shared/schemas/providers'
import { PlivoConfigSchema } from '@shared/schemas/providers'
import type {
  AutoConfigResult,
  ConnectionTestResult,
  NumberSearchQuery,
  PhoneNumberInfo,
  ProvisionResult,
  WebhookUrlSet,
} from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

function apiBase(config: PlivoConfig): string {
  return ((config as Record<string, unknown>)._testBaseUrl as string) ?? 'https://api.plivo.com'
}

function basicAuth(authId: string, authToken: string): string {
  return `Basic ${btoa(`${authId}:${authToken}`)}`
}

export const plivoCapabilities: ProviderCapabilities<PlivoConfig> = {
  type: 'plivo',
  displayName: 'Plivo',
  description: 'Cloud communications API for voice and SMS',
  credentialSchema: PlivoConfigSchema,
  supportsOAuth: false,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config: PlivoConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const url = `${apiBase(config)}/v1/Account/${config.authId}/`
      const res = await fetch(url, {
        headers: { Authorization: basicAuth(config.authId, config.authToken) },
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
      const data = (await res.json()) as { name?: string; account_type?: string; state?: string }
      if (data.state === 'suspended') {
        return {
          connected: false,
          latencyMs,
          error: 'Account suspended',
          errorType: 'account_suspended',
        }
      }
      return { connected: true, latencyMs, accountName: data.name }
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

  async listOwnedNumbers(config: PlivoConfig): Promise<PhoneNumberInfo[]> {
    const url = `${apiBase(config)}/v1/Account/${config.authId}/Number/`
    const res = await fetch(url, {
      headers: { Authorization: basicAuth(config.authId, config.authToken) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Plivo listOwnedNumbers: HTTP ${res.status}`)
    const data = (await res.json()) as {
      objects: Array<{
        number: string
        country: string
        region?: string
        voice_enabled: boolean
        sms_enabled: boolean
        mms_enabled: boolean
        monthly_rental_rate?: string
      }>
    }
    return (data.objects ?? []).map((n) => ({
      number: `+${n.number}`,
      country: n.country,
      locality: n.region,
      capabilities: { voice: n.voice_enabled, sms: n.sms_enabled, mms: n.mms_enabled },
      monthlyFee: n.monthly_rental_rate,
      owned: true,
    }))
  },

  async searchAvailableNumbers(
    config: PlivoConfig,
    query: NumberSearchQuery
  ): Promise<PhoneNumberInfo[]> {
    const params = new URLSearchParams()
    params.set('country_iso', query.country || 'US')
    if (query.areaCode) params.set('region', query.areaCode)
    if (query.contains) params.set('pattern', query.contains)
    if (query.limit) params.set('limit', String(query.limit))
    const url = `${apiBase(config)}/v1/Account/${config.authId}/PhoneNumber/?${params}`
    const res = await fetch(url, {
      headers: { Authorization: basicAuth(config.authId, config.authToken) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Plivo searchAvailableNumbers: HTTP ${res.status}`)
    const data = (await res.json()) as {
      objects: Array<{
        number: string
        country: string
        region?: string
        voice_enabled: boolean
        sms_enabled: boolean
        mms_enabled: boolean
        monthly_rental_rate?: string
      }>
    }
    return (data.objects ?? []).map((n) => ({
      number: `+${n.number}`,
      country: n.country,
      locality: n.region,
      capabilities: { voice: n.voice_enabled, sms: n.sms_enabled, mms: n.mms_enabled },
      monthlyFee: n.monthly_rental_rate,
      owned: false,
    }))
  },

  async provisionNumber(config: PlivoConfig, number: string): Promise<ProvisionResult> {
    // Plivo expects number without + prefix in URL
    const cleanNumber = number.startsWith('+') ? number.slice(1) : number
    const url = `${apiBase(config)}/v1/Account/${config.authId}/PhoneNumber/${cleanNumber}/`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(config.authId, config.authToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      return { ok: false, error: err.error ?? err.message ?? `HTTP ${res.status}` }
    }
    return { ok: true, number: `+${cleanNumber}` }
  },

  async configureWebhooks(
    config: PlivoConfig,
    phoneNumber: string,
    webhookUrls: WebhookUrlSet
  ): Promise<AutoConfigResult> {
    const cleanNumber = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber
    const url = `${apiBase(config)}/v1/Account/${config.authId}/Number/${cleanNumber}/`
    const body: Record<string, string> = {}
    if (webhookUrls.voiceIncoming) body.answer_url = webhookUrls.voiceIncoming
    if (webhookUrls.voiceFallback) body.fallback_answer_url = webhookUrls.voiceFallback
    if (webhookUrls.smsIncoming) body.message_url = webhookUrls.smsIncoming
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(config.authId, config.authToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      return { ok: false, error: err.error ?? err.message ?? `HTTP ${res.status}` }
    }
    return { ok: true, details: { number: phoneNumber } }
  },
}
