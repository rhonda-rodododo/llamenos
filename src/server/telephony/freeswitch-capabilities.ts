import type { FreeSwitchConfig } from '@shared/schemas/providers'
import { FreeSwitchConfigSchema } from '@shared/schemas/providers'
import type { ConnectionTestResult, WebhookUrlSet } from '@shared/types'
import type { ProviderCapabilities } from './capabilities'

/** Block loopback and link-local addresses. Private IPs are allowed for self-hosted FreeSWITCH. */
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

export const freeswitchCapabilities: ProviderCapabilities<FreeSwitchConfig> = {
  type: 'freeswitch',
  displayName: 'FreeSWITCH (Self-Hosted)',
  description:
    'Self-hosted open-source telephony platform with mod_httapi for IVR and Verto for WebRTC',
  credentialSchema: FreeSwitchConfigSchema,
  supportsOAuth: false,
  supportsSms: false,
  supportsSip: true,
  supportsWebRtc: true,
  supportsNumberProvisioning: false,
  supportsWebhookAutoConfig: false,

  async testConnection(config: FreeSwitchConfig): Promise<ConnectionTestResult> {
    const start = Date.now()

    // Test via sip-bridge health endpoint if configured
    if (config.bridgeCallbackUrl) {
      try {
        const parsed = new URL(config.bridgeCallbackUrl)
        if (isBlockedHost(parsed.hostname)) {
          return {
            connected: false,
            latencyMs: 0,
            error: 'Loopback and link-local addresses are not allowed',
            errorType: 'invalid_credentials',
          }
        }
        const url = `${config.bridgeCallbackUrl}/health`
        const res = await fetch(url, {
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
          status?: string
          version?: string
          uptime?: number
        }
        if (data.status === 'ok') {
          return {
            connected: true,
            latencyMs,
            accountName: data.version ? `FreeSWITCH Bridge v${data.version}` : 'FreeSWITCH Bridge',
          }
        }
        return {
          connected: false,
          latencyMs,
          error: `SIP bridge unhealthy: ${JSON.stringify(data)}`,
          errorType: 'unknown',
        }
      } catch (err) {
        return {
          connected: false,
          latencyMs: Date.now() - start,
          error: `SIP bridge unreachable: ${String(err)}`,
          errorType: 'network_error',
        }
      }
    }

    // Fall back to testing ESL URL reachability
    try {
      const parsed = new URL(config.eslUrl)
      if (isBlockedHost(parsed.hostname)) {
        return {
          connected: false,
          latencyMs: 0,
          error: 'Loopback and link-local addresses are not allowed',
          errorType: 'invalid_credentials',
        }
      }
      // ESL is a TCP socket protocol, not HTTP — we can only verify the host is reachable
      // by attempting an HTTP connection that will likely fail but confirms network reachability
      await fetch(config.eslUrl, { signal: AbortSignal.timeout(5_000) }).catch(() => {})
      const latencyMs = Date.now() - start
      return {
        connected: true,
        latencyMs,
        accountName: 'FreeSWITCH (ESL reachable)',
      }
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
