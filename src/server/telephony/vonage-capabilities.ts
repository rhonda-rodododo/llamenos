import type { VonageConfig } from '@shared/schemas/providers'
import { VonageConfigSchema } from '@shared/schemas/providers'
import type {
  AutoConfigResult,
  ConnectionTestResult,
  NumberSearchQuery,
  PhoneNumberInfo,
  ProvisionResult,
  WebhookUrlSet,
} from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

function restBase(config: VonageConfig): string {
  return ((config as Record<string, unknown>)._testBaseUrl as string) ?? 'https://rest.nexmo.com'
}

function apiBaseV2(config: VonageConfig): string {
  return ((config as Record<string, unknown>)._testBaseUrl as string) ?? 'https://api.nexmo.com'
}

function authParams(config: VonageConfig): string {
  return `api_key=${encodeURIComponent(config.apiKey)}&api_secret=${encodeURIComponent(config.apiSecret)}`
}

export const vonageCapabilities: ProviderCapabilities<VonageConfig> = {
  type: 'vonage',
  displayName: 'Vonage',
  description: 'Global communications platform with voice, SMS, and SIP capabilities',
  credentialSchema: VonageConfigSchema,
  supportsOAuth: false,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config: VonageConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const url = `${restBase(config)}/account/get-balance?${authParams(config)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
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
      const data = (await res.json()) as {
        value?: number
        'error-code'?: string
        'error-code-label'?: string
      }
      if (data['error-code'] && data['error-code'] !== '200') {
        return {
          connected: false,
          latencyMs,
          error: data['error-code-label'] ?? `Error code: ${data['error-code']}`,
          errorType: data['error-code'] === '401' ? 'invalid_credentials' : 'unknown',
        }
      }
      return { connected: true, latencyMs }
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

  async listOwnedNumbers(config: VonageConfig): Promise<PhoneNumberInfo[]> {
    const url = `${restBase(config)}/account/numbers?${authParams(config)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Vonage listOwnedNumbers: HTTP ${res.status}`)
    const data = (await res.json()) as {
      numbers: Array<{
        msisdn: string
        country: string
        type: string
        features: string[]
      }>
    }
    return (data.numbers ?? []).map((n) => ({
      number: `+${n.msisdn}`,
      country: n.country,
      capabilities: {
        voice: n.features.includes('VOICE'),
        sms: n.features.includes('SMS'),
        mms: n.features.includes('MMS'),
      },
      owned: true,
    }))
  },

  async searchAvailableNumbers(
    config: VonageConfig,
    query: NumberSearchQuery
  ): Promise<PhoneNumberInfo[]> {
    const params = new URLSearchParams()
    params.set('country', query.country || 'US')
    if (query.contains) params.set('pattern', query.contains)
    if (query.limit) params.set('size', String(query.limit))
    const url = `${restBase(config)}/number/search?${authParams(config)}&${params}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Vonage searchAvailableNumbers: HTTP ${res.status}`)
    const data = (await res.json()) as {
      numbers: Array<{
        msisdn: string
        country: string
        type: string
        features: string[]
        cost?: string
      }>
    }
    return (data.numbers ?? []).map((n) => ({
      number: `+${n.msisdn}`,
      country: n.country,
      capabilities: {
        voice: n.features.includes('VOICE'),
        sms: n.features.includes('SMS'),
        mms: n.features.includes('MMS'),
      },
      monthlyFee: n.cost,
      owned: false,
    }))
  },

  async provisionNumber(config: VonageConfig, number: string): Promise<ProvisionResult> {
    // Vonage expects MSISDN (no +)
    const msisdn = number.startsWith('+') ? number.slice(1) : number
    // Need country — derive from number or default to US
    const country = msisdn.startsWith('1') ? 'US' : 'GB'
    const body = new URLSearchParams({
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      country,
      msisdn,
    })
    const url = `${restBase(config)}/number/buy`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { 'error-code-label'?: string }
      return { ok: false, error: err['error-code-label'] ?? `HTTP ${res.status}` }
    }
    return { ok: true, number: `+${msisdn}` }
  },

  async configureWebhooks(
    config: VonageConfig,
    _phoneNumber: string,
    webhookUrls: WebhookUrlSet
  ): Promise<AutoConfigResult> {
    const url = `${apiBaseV2(config)}/v2/applications/${config.applicationId}`
    const appBody = {
      capabilities: {
        voice: {
          webhooks: {
            answer_url: { address: webhookUrls.voiceIncoming, http_method: 'POST' },
            event_url: { address: webhookUrls.voiceStatus, http_method: 'POST' },
            ...(webhookUrls.voiceFallback
              ? { fallback_answer_url: { address: webhookUrls.voiceFallback, http_method: 'POST' } }
              : {}),
          },
        },
        ...(webhookUrls.smsIncoming
          ? {
              messages: {
                webhooks: {
                  inbound_url: { address: webhookUrls.smsIncoming, http_method: 'POST' },
                  ...(webhookUrls.smsStatus
                    ? { status_url: { address: webhookUrls.smsStatus, http_method: 'POST' } }
                    : {}),
                },
              },
            }
          : {}),
      },
    }
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${config.apiKey}:${config.apiSecret}`)}`,
      },
      body: JSON.stringify(appBody),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { title?: string; detail?: string }
      return { ok: false, error: err.detail ?? err.title ?? `HTTP ${res.status}` }
    }
    return { ok: true, details: { applicationId: config.applicationId } }
  },
}
