import type { AsteriskConfig } from '@shared/schemas/providers'
import { AsteriskConfigSchema } from '@shared/schemas/providers'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

function ariBase(config: AsteriskConfig): string {
  return ((config as Record<string, unknown>)._testBaseUrl as string) ?? config.ariUrl
}

function basicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`
}

/** Block loopback and link-local addresses. Private IPs are allowed for self-hosted Asterisk. */
function isBlockedHost(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  )
    return true
  // Block 127.x.x.x range
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  // Block link-local 169.254.x.x
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  return false
}

export const asteriskCapabilities: ProviderCapabilities<AsteriskConfig> = {
  type: 'asterisk',
  displayName: 'Asterisk (Self-Hosted)',
  description: 'Self-hosted open-source PBX via ARI (Asterisk REST Interface)',
  credentialSchema: AsteriskConfigSchema,
  supportsOAuth: false,
  supportsSms: false,
  supportsSip: true,
  supportsWebRtc: false,
  supportsNumberProvisioning: false,
  supportsWebhookAutoConfig: false,

  async testConnection(config: AsteriskConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const base = ariBase(config)
      const parsed = new URL(base)
      if (isBlockedHost(parsed.hostname)) {
        return {
          connected: false,
          latencyMs: 0,
          error: 'Loopback and link-local addresses are not allowed',
          errorType: 'invalid_credentials',
        }
      }
      const url = `${base}/asterisk/info`
      const res = await fetch(url, {
        headers: { Authorization: basicAuth(config.ariUsername, config.ariPassword) },
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
      const data = (await res.json()) as {
        system?: { entity_id?: string }
        config?: { name?: string }
      }
      const name = data.config?.name ?? data.system?.entity_id
      return { connected: true, latencyMs, accountName: name }
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
    }
  },
}
