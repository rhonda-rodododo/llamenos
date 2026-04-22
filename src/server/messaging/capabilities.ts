import type {
  RCSConfig,
  SignalBridgeConfig,
  TelegramConfig,
  WhatsAppConfig,
} from '@shared/schemas/providers'
import {
  RCSConfigSchema,
  SignalBridgeConfigSchema,
  SMSConfigSchema,
  TelegramConfigSchema,
  WhatsAppConfigSchema,
} from '@shared/schemas/providers'
import type {
  AutoConfigResult,
  ConnectionTestResult,
  MessagingChannelType,
  WebhookUrlSet,
} from '@shared/types'
import type { z } from 'zod/v4'
import { validateExternalUrl } from '../lib/ssrf-guard'

export interface MessagingChannelCapabilities<T = unknown> {
  readonly channelType: MessagingChannelType
  readonly displayName: string
  readonly description: string
  readonly credentialSchema: z.ZodType<T>
  readonly supportsWebhookAutoConfig: boolean

  testConnection(config: T): Promise<ConnectionTestResult>
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet
  configureWebhooks?(config: T, webhookUrls: WebhookUrlSet): Promise<AutoConfigResult>
}

const smsCapabilities: MessagingChannelCapabilities = {
  channelType: 'sms',
  displayName: 'SMS',
  description: 'Text messaging via telephony provider',
  credentialSchema: SMSConfigSchema,
  supportsWebhookAutoConfig: false,
  async testConnection(): Promise<ConnectionTestResult> {
    return { connected: true, latencyMs: 0, accountName: 'Uses telephony provider' }
  },
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { smsIncoming: `${baseUrl}/api/messaging/sms/webhook${qs}` }
  },
}

const whatsappCapabilities: MessagingChannelCapabilities<WhatsAppConfig> = {
  channelType: 'whatsapp',
  displayName: 'WhatsApp',
  description: 'WhatsApp Business messaging',
  credentialSchema: WhatsAppConfigSchema,
  supportsWebhookAutoConfig: false,
  async testConnection(config: WhatsAppConfig): Promise<ConnectionTestResult> {
    if (config.integrationMode === 'twilio') {
      return { connected: true, latencyMs: 0, accountName: 'Uses Twilio credentials' }
    }
    if (!config.phoneNumberId || !config.accessToken) {
      return {
        connected: false,
        latencyMs: 0,
        error: 'Phone Number ID and Access Token required',
        errorType: 'invalid_credentials',
      }
    }
    const start = Date.now()
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          connected: false,
          latencyMs,
          error: `HTTP ${res.status}`,
          errorType: res.status === 401 ? 'invalid_credentials' : 'unknown',
        }
      }
      const data = (await res.json()) as { verified_name?: string }
      return { connected: true, latencyMs, accountName: data.verified_name }
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
    return { whatsappIncoming: `${baseUrl}/api/messaging/whatsapp/webhook${qs}` }
  },
}

const signalCapabilities: MessagingChannelCapabilities<SignalBridgeConfig> = {
  channelType: 'signal',
  displayName: 'Signal',
  description: 'Encrypted messaging via signal-cli bridge',
  credentialSchema: SignalBridgeConfigSchema,
  supportsWebhookAutoConfig: false,
  async testConnection(config: SignalBridgeConfig): Promise<ConnectionTestResult> {
    const urlError = validateExternalUrl(config.bridgeUrl, 'Signal Bridge URL')
    if (urlError)
      return { connected: false, latencyMs: 0, error: urlError, errorType: 'invalid_credentials' }

    const start = Date.now()
    try {
      const headers: Record<string, string> = {}
      if (config.bridgeApiKey) headers.Authorization = `Bearer ${config.bridgeApiKey}`
      const res = await fetch(`${config.bridgeUrl}/v1/about`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          connected: false,
          latencyMs,
          error: `HTTP ${res.status}`,
          errorType: res.status === 401 ? 'invalid_credentials' : 'unknown',
        }
      }
      const data = (await res.json()) as { versions?: Record<string, string> }
      return {
        connected: true,
        latencyMs,
        accountName: `signal-cli ${data.versions?.['signal-cli'] ?? ''}`.trim(),
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
    return { signalIncoming: `${baseUrl}/api/messaging/signal/webhook${qs}` }
  },
}

const rcsCapabilities: MessagingChannelCapabilities<RCSConfig> = {
  channelType: 'rcs',
  displayName: 'RCS',
  description: 'Rich Communication Services via Google RBM',
  credentialSchema: RCSConfigSchema,
  supportsWebhookAutoConfig: false,
  async testConnection(config: RCSConfig): Promise<ConnectionTestResult> {
    const start = Date.now()
    try {
      const keyData = JSON.parse(config.serviceAccountKey) as {
        client_email?: string
        private_key?: string
      }
      if (!keyData.client_email || !keyData.private_key) {
        return {
          connected: false,
          latencyMs: 0,
          error: 'Invalid service account key',
          errorType: 'invalid_credentials',
        }
      }
      return { connected: true, latencyMs: Date.now() - start, accountName: keyData.client_email }
    } catch (_err) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        error: 'Invalid JSON in service account key',
        errorType: 'invalid_credentials',
      }
    }
  },
  getWebhookUrls(baseUrl: string, hubId?: string): WebhookUrlSet {
    const qs = hubId ? `?hub=${hubId}` : ''
    return { rcsIncoming: `${baseUrl}/api/messaging/rcs/webhook${qs}` }
  },
}

const telegramCapabilities: MessagingChannelCapabilities<TelegramConfig> = {
  channelType: 'telegram',
  displayName: 'Telegram',
  description: 'Telegram messaging via Bot API',
  credentialSchema: TelegramConfigSchema,
  supportsWebhookAutoConfig: true,
  async testConnection(config: TelegramConfig): Promise<ConnectionTestResult> {
    if (!config.botToken) {
      return {
        connected: false,
        latencyMs: 0,
        error: 'Bot token is required',
        errorType: 'invalid_credentials',
      }
    }
    const start = Date.now()
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          connected: false,
          latencyMs,
          error: `HTTP ${res.status}`,
          errorType: res.status === 401 ? 'invalid_credentials' : 'unknown',
        }
      }
      const data = (await res.json()) as { ok: boolean; result?: { username?: string } }
      return {
        connected: data.ok,
        latencyMs,
        accountName: data.result?.username ? `@${data.result.username}` : undefined,
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
    return { telegramIncoming: `${baseUrl}/api/messaging/telegram/webhook${qs}` }
  },
  async configureWebhooks(
    config: TelegramConfig,
    webhookUrls: WebhookUrlSet
  ): Promise<AutoConfigResult> {
    const url = webhookUrls.telegramIncoming
    if (!url) {
      return { ok: false, error: 'Missing telegram webhook URL' }
    }

    try {
      const body: Record<string, unknown> = { url }
      if (config.webhookSecret) body.secret_token = config.webhookSecret

      const res = await fetch(`https://api.telegram.org/bot${config.botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await res.json()) as { ok: boolean; description?: string }
      if (!data.ok) {
        return { ok: false, error: data.description ?? `HTTP ${res.status}` }
      }
      return { ok: true, details: { telegramIncoming: url } }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },
}

export const MESSAGING_CAPABILITIES: Record<MessagingChannelType, MessagingChannelCapabilities> = {
  sms: smsCapabilities,
  whatsapp: whatsappCapabilities,
  signal: signalCapabilities,
  rcs: rcsCapabilities,
  telegram: telegramCapabilities,
}
