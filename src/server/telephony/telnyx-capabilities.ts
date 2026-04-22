import type { TelnyxConfig } from '@shared/schemas/providers'
import { TelnyxConfigSchema } from '@shared/schemas/providers'
import type {
  AutoConfigResult,
  ConnectionTestResult,
  NumberSearchQuery,
  PhoneNumberInfo,
  ProvisionResult,
  WebhookUrlSet,
} from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

function apiBase(config: TelnyxConfig): string {
  return ((config as Record<string, unknown>)._testBaseUrl as string) ?? 'https://api.telnyx.com'
}

function bearerAuth(apiKey: string): string {
  return `Bearer ${apiKey}`
}

export const telnyxCapabilities: ProviderCapabilities<TelnyxConfig> = {
  type: 'telnyx',
  displayName: 'Telnyx',
  description: 'Mission-critical communications platform with voice, SMS, SIP, and WebRTC support',
  credentialSchema: TelnyxConfigSchema,
  supportsOAuth: true,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: true,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config: TelnyxConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const url = `${apiBase(config)}/v2/texml_applications?page[size]=1`
      const res = await fetch(url, {
        headers: { Authorization: bearerAuth(config.apiKey) },
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
      await res.json() // consume body
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

  async listOwnedNumbers(config: TelnyxConfig): Promise<PhoneNumberInfo[]> {
    const url = `${apiBase(config)}/v2/phone_numbers?page[size]=100`
    const res = await fetch(url, {
      headers: { Authorization: bearerAuth(config.apiKey) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Telnyx listOwnedNumbers: HTTP ${res.status}`)
    const data = (await res.json()) as {
      data: Array<{
        phone_number: string
        country_code: string
        locality?: string
        purchased_at?: string
        features?: Array<{ name: string }>
      }>
    }
    return (data.data ?? []).map((n) => {
      const featureNames = (n.features ?? []).map((f) => f.name.toLowerCase())
      return {
        number: n.phone_number,
        country: n.country_code,
        locality: n.locality,
        capabilities: {
          voice: featureNames.includes('voice'),
          sms: featureNames.includes('sms'),
          mms: featureNames.includes('mms'),
        },
        owned: true,
      }
    })
  },

  async searchAvailableNumbers(
    config: TelnyxConfig,
    query: NumberSearchQuery
  ): Promise<PhoneNumberInfo[]> {
    const params = new URLSearchParams()
    params.set('filter[country_code]', query.country || 'US')
    if (query.areaCode) params.set('filter[national_destination_code]', query.areaCode)
    if (query.contains) params.set('filter[phone_number][contains]', query.contains)
    if (query.limit) params.set('filter[limit]', String(query.limit))
    const url = `${apiBase(config)}/v2/available_phone_numbers?${params}`
    const res = await fetch(url, {
      headers: { Authorization: bearerAuth(config.apiKey) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Telnyx searchAvailableNumbers: HTTP ${res.status}`)
    const data = (await res.json()) as {
      data: Array<{
        phone_number: string
        country_code: string
        region_information?: Array<{ region_name?: string }>
        features?: Array<{ name: string }>
        cost_information?: { monthly_cost?: string }
      }>
    }
    return (data.data ?? []).map((n) => {
      const featureNames = (n.features ?? []).map((f) => f.name.toLowerCase())
      return {
        number: n.phone_number,
        country: n.country_code,
        locality: n.region_information?.[0]?.region_name,
        capabilities: {
          voice: featureNames.includes('voice'),
          sms: featureNames.includes('sms'),
          mms: featureNames.includes('mms'),
        },
        monthlyFee: n.cost_information?.monthly_cost,
        owned: false,
      }
    })
  },

  async provisionNumber(config: TelnyxConfig, number: string): Promise<ProvisionResult> {
    const url = `${apiBase(config)}/v2/number_orders`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: bearerAuth(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_numbers: [{ phone_number: number }],
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { errors?: Array<{ detail?: string }> }
      return { ok: false, error: err.errors?.[0]?.detail ?? `HTTP ${res.status}` }
    }
    return { ok: true, number }
  },

  async configureWebhooks(
    config: TelnyxConfig,
    _phoneNumber: string,
    webhookUrls: WebhookUrlSet
  ): Promise<AutoConfigResult> {
    const base = apiBase(config)
    const headers = {
      Authorization: bearerAuth(config.apiKey),
      'Content-Type': 'application/json',
    }

    if (config.texmlAppId) {
      // Update existing TeXML application
      const url = `${base}/v2/texml_applications/${config.texmlAppId}`
      const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          voice_url: webhookUrls.voiceIncoming,
          status_callback_url: webhookUrls.voiceStatus,
          ...(webhookUrls.voiceFallback ? { voice_fallback_url: webhookUrls.voiceFallback } : {}),
          voice_method: 'POST',
          status_callback_method: 'POST',
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { errors?: Array<{ detail?: string }> }
        return { ok: false, error: err.errors?.[0]?.detail ?? `HTTP ${res.status}` }
      }
      return { ok: true, details: { texmlAppId: config.texmlAppId } }
    }

    // Create a new TeXML application
    const url = `${base}/v2/texml_applications`
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        friendly_name: 'Llamenos Hotline',
        voice_url: webhookUrls.voiceIncoming,
        status_callback_url: webhookUrls.voiceStatus,
        ...(webhookUrls.voiceFallback ? { voice_fallback_url: webhookUrls.voiceFallback } : {}),
        voice_method: 'POST',
        status_callback_method: 'POST',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { errors?: Array<{ detail?: string }> }
      return { ok: false, error: err.errors?.[0]?.detail ?? `HTTP ${res.status}` }
    }
    const data = (await res.json()) as { data?: { id?: string } }
    return {
      ok: true,
      details: {
        texmlAppId: data.data?.id,
        note: 'New TeXML application created — save texmlAppId to config',
      },
    }
  },
}
