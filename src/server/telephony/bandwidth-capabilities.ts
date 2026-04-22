import type { BandwidthConfig } from '@shared/schemas/providers'
import { BandwidthConfigSchema } from '@shared/schemas/providers'
import type {
  AutoConfigResult,
  ConnectionTestResult,
  NumberSearchQuery,
  PhoneNumberInfo,
  ProvisionResult,
  WebhookUrlSet,
} from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

function apiBase(config: BandwidthConfig): string {
  return (
    ((config as Record<string, unknown>)._testBaseUrl as string) ??
    'https://dashboard.bandwidth.com/api'
  )
}

function voiceApiBase(config: BandwidthConfig): string {
  return (
    ((config as Record<string, unknown>)._testVoiceBaseUrl as string) ??
    `https://voice.bandwidth.com/api/v2/accounts/${config.accountId}`
  )
}

function basicAuth(apiToken: string, apiSecret: string): string {
  return `Basic ${btoa(`${apiToken}:${apiSecret}`)}`
}

export const bandwidthCapabilities: ProviderCapabilities<BandwidthConfig> = {
  type: 'bandwidth',
  displayName: 'Bandwidth',
  description:
    'Carrier-grade CPaaS with direct PSTN infrastructure, voice, SMS, and number provisioning',
  credentialSchema: BandwidthConfigSchema,
  supportsOAuth: false,
  supportsSms: true,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: true,
  supportsWebhookAutoConfig: true,

  async testConnection(config: BandwidthConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      // Test Voice API connectivity by listing calls (small page)
      const url = `${voiceApiBase(config)}/calls?pageSize=1`
      const res = await fetch(url, {
        headers: { Authorization: basicAuth(config.apiToken, config.apiSecret) },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          connected: false,
          latencyMs,
          error: `HTTP ${res.status}`,
          errorType:
            res.status === 401 || res.status === 403
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

  async listOwnedNumbers(config: BandwidthConfig): Promise<PhoneNumberInfo[]> {
    const url = `${apiBase(config)}/accounts/${config.accountId}/inServiceNumbers`
    const res = await fetch(url, {
      headers: { Authorization: basicAuth(config.apiToken, config.apiSecret) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Bandwidth listOwnedNumbers: HTTP ${res.status}`)
    // Bandwidth returns XML for the dashboard API — parse as text
    const text = await res.text()
    // Extract phone numbers from XML response
    const numbers: PhoneNumberInfo[] = []
    const matches = text.matchAll(/<TelephoneNumber>(\+?\d+)<\/TelephoneNumber>/g)
    for (const match of matches) {
      const number = match[1].startsWith('+') ? match[1] : `+1${match[1]}`
      numbers.push({
        number,
        country: 'US',
        capabilities: { voice: true, sms: true, mms: false },
        owned: true,
      })
    }
    return numbers
  },

  async searchAvailableNumbers(
    config: BandwidthConfig,
    query: NumberSearchQuery
  ): Promise<PhoneNumberInfo[]> {
    const params = new URLSearchParams()
    if (query.areaCode) params.set('areaCode', query.areaCode)
    if (query.limit) params.set('quantity', String(query.limit))
    const url = `${apiBase(config)}/accounts/${config.accountId}/availableNumbers?${params}`
    const res = await fetch(url, {
      headers: { Authorization: basicAuth(config.apiToken, config.apiSecret) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Bandwidth searchAvailableNumbers: HTTP ${res.status}`)
    const text = await res.text()
    const numbers: PhoneNumberInfo[] = []
    const matches = text.matchAll(/<TelephoneNumber>(\+?\d+)<\/TelephoneNumber>/g)
    for (const match of matches) {
      const number = match[1].startsWith('+') ? match[1] : `+1${match[1]}`
      numbers.push({
        number,
        country: query.country || 'US',
        capabilities: { voice: true, sms: true, mms: false },
        owned: false,
      })
    }
    return numbers
  },

  async provisionNumber(config: BandwidthConfig, number: string): Promise<ProvisionResult> {
    const url = `${apiBase(config)}/accounts/${config.accountId}/orders`
    const orderXml = `<?xml version="1.0" encoding="UTF-8"?>
<Order>
  <ExistingTelephoneNumberOrderType>
    <TelephoneNumberList>
      <TelephoneNumber>${number.replace('+1', '')}</TelephoneNumber>
    </TelephoneNumberList>
  </ExistingTelephoneNumberOrderType>
  <SiteId>1</SiteId>
</Order>`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(config.apiToken, config.apiSecret),
        'Content-Type': 'application/xml',
      },
      body: orderXml,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      return { ok: false, error: err || `HTTP ${res.status}` }
    }
    return { ok: true, number }
  },

  async configureWebhooks(
    config: BandwidthConfig,
    _phoneNumber: string,
    webhookUrls: WebhookUrlSet
  ): Promise<AutoConfigResult> {
    const url = `${voiceApiBase(config)}/../applications/${config.applicationId}`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: basicAuth(config.apiToken, config.apiSecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        callInitiatedCallbackUrl: webhookUrls.voiceIncoming,
        callStatusCallbackUrl: webhookUrls.voiceStatus,
        callInitiatedMethod: 'POST',
        callStatusMethod: 'POST',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string }
      return { ok: false, error: err.message ?? `HTTP ${res.status}` }
    }
    return { ok: true, details: { applicationId: config.applicationId } }
  },
}
