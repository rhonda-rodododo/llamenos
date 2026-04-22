import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import type { MessagingChannelType } from '@shared/schemas/common'
import { MESSAGING_CAPABILITIES } from './capabilities'

const ALL_CHANNEL_TYPES: MessagingChannelType[] = ['sms', 'whatsapp', 'signal', 'rcs', 'telegram']

describe('MESSAGING_CAPABILITIES', () => {
  // ─── Coverage check ──────────────────────────────────────────

  it('has an entry for every MessagingChannelType', () => {
    for (const channelType of ALL_CHANNEL_TYPES) {
      expect(MESSAGING_CAPABILITIES[channelType]).toBeDefined()
      expect(MESSAGING_CAPABILITIES[channelType].channelType).toBe(channelType)
    }
  })

  it('has no extra entries beyond known channel types', () => {
    const keys = Object.keys(MESSAGING_CAPABILITIES)
    expect(keys.sort()).toEqual([...ALL_CHANNEL_TYPES].sort())
  })

  // ─── Display metadata ────────────────────────────────────────

  it('every entry has displayName and description', () => {
    for (const channelType of ALL_CHANNEL_TYPES) {
      const cap = MESSAGING_CAPABILITIES[channelType]
      expect(cap.displayName.length).toBeGreaterThan(0)
      expect(cap.description.length).toBeGreaterThan(0)
    }
  })

  it('every entry has a credentialSchema', () => {
    for (const channelType of ALL_CHANNEL_TYPES) {
      expect(MESSAGING_CAPABILITIES[channelType].credentialSchema).toBeDefined()
    }
  })

  // ─── testConnection ──────────────────────────────────────────

  describe('testConnection', () => {
    let fetchSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      fetchSpy = spyOn(globalThis, 'fetch')
    })

    afterEach(() => {
      fetchSpy.mockRestore()
    })

    it('sms returns connected without making network calls', async () => {
      const result = await MESSAGING_CAPABILITIES.sms.testConnection({})
      expect(result.connected).toBe(true)
      expect(result.accountName).toBe('Uses telephony provider')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('whatsapp with twilio mode returns connected without network calls', async () => {
      const result = await MESSAGING_CAPABILITIES.whatsapp.testConnection({
        integrationMode: 'twilio',
        enabled: true,
      })
      expect(result.connected).toBe(true)
      expect(result.accountName).toBe('Uses Twilio credentials')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('whatsapp direct mode returns error when missing credentials', async () => {
      const result = await MESSAGING_CAPABILITIES.whatsapp.testConnection({
        integrationMode: 'direct',
        enabled: true,
        phoneNumberId: '',
        accessToken: '',
      })
      expect(result.connected).toBe(false)
      expect(result.errorType).toBe('invalid_credentials')
    })

    it('whatsapp direct mode calls Facebook Graph API', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ verified_name: 'Crisis Line' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await MESSAGING_CAPABILITIES.whatsapp.testConnection({
        integrationMode: 'direct',
        enabled: true,
        phoneNumberId: '12345',
        accessToken: 'tok_abc',
      })

      expect(result.connected).toBe(true)
      expect(result.accountName).toBe('Crisis Line')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url] = fetchSpy.mock.calls[0] as [string]
      expect(url).toContain('graph.facebook.com')
      expect(url).toContain('12345')
    })

    it('telegram calls Bot API /getMe', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: { id: 1, is_bot: true, first_name: 'Bot', username: 'crisis_bot' },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )

      const result = await MESSAGING_CAPABILITIES.telegram.testConnection({
        enabled: true,
        botToken: '123:ABC',
      })

      expect(result.connected).toBe(true)
      expect(result.accountName).toBe('@crisis_bot')
      const [url] = fetchSpy.mock.calls[0] as [string]
      expect(url).toContain('/getMe')
    })

    it('telegram returns error when botToken is missing', async () => {
      const result = await MESSAGING_CAPABILITIES.telegram.testConnection({
        enabled: true,
        botToken: '',
      })
      expect(result.connected).toBe(false)
      expect(result.errorType).toBe('invalid_credentials')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('telegram handles network errors', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network unreachable'))

      const result = await MESSAGING_CAPABILITIES.telegram.testConnection({
        enabled: true,
        botToken: '123:ABC',
      })

      expect(result.connected).toBe(false)
      expect(result.errorType).toBe('network_error')
      expect(result.error).toContain('Network unreachable')
    })

    it('rcs validates service account key JSON', async () => {
      const result = await MESSAGING_CAPABILITIES.rcs.testConnection({
        enabled: true,
        agentId: 'agent1',
        serviceAccountKey: JSON.stringify({
          client_email: 'bot@project.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----\nMIIE...',
        }),
      })
      expect(result.connected).toBe(true)
      expect(result.accountName).toBe('bot@project.iam.gserviceaccount.com')
    })

    it('rcs returns error on invalid JSON key', async () => {
      const result = await MESSAGING_CAPABILITIES.rcs.testConnection({
        enabled: true,
        agentId: 'agent1',
        serviceAccountKey: 'not-json',
      })
      expect(result.connected).toBe(false)
      expect(result.error).toContain('Invalid JSON')
    })
  })

  // ─── getWebhookUrls ─────────────────────────────────────────

  describe('getWebhookUrls', () => {
    const baseUrl = 'https://app.example.com'

    it('sms generates correct webhook path', () => {
      const urls = MESSAGING_CAPABILITIES.sms.getWebhookUrls(baseUrl)
      expect(urls.smsIncoming).toBe('https://app.example.com/api/messaging/sms/webhook')
    })

    it('whatsapp generates correct webhook path', () => {
      const urls = MESSAGING_CAPABILITIES.whatsapp.getWebhookUrls(baseUrl)
      expect(urls.whatsappIncoming).toBe('https://app.example.com/api/messaging/whatsapp/webhook')
    })

    it('signal generates correct webhook path', () => {
      const urls = MESSAGING_CAPABILITIES.signal.getWebhookUrls(baseUrl)
      expect(urls.signalIncoming).toBe('https://app.example.com/api/messaging/signal/webhook')
    })

    it('rcs generates correct webhook path', () => {
      const urls = MESSAGING_CAPABILITIES.rcs.getWebhookUrls(baseUrl)
      expect(urls.rcsIncoming).toBe('https://app.example.com/api/messaging/rcs/webhook')
    })

    it('telegram generates correct webhook path', () => {
      const urls = MESSAGING_CAPABILITIES.telegram.getWebhookUrls(baseUrl)
      expect(urls.telegramIncoming).toBe('https://app.example.com/api/messaging/telegram/webhook')
    })

    it('appends hub query parameter when hubId is provided', () => {
      for (const channelType of ALL_CHANNEL_TYPES) {
        const urls = MESSAGING_CAPABILITIES[channelType].getWebhookUrls(baseUrl, 'hub-abc')
        const urlValues = Object.values(urls)
        expect(urlValues.length).toBeGreaterThan(0)
        for (const url of urlValues) {
          expect(url).toContain('?hub=hub-abc')
        }
      }
    })

    it('does not append query parameter when hubId is omitted', () => {
      for (const channelType of ALL_CHANNEL_TYPES) {
        const urls = MESSAGING_CAPABILITIES[channelType].getWebhookUrls(baseUrl)
        const urlValues = Object.values(urls)
        for (const url of urlValues) {
          expect(url).not.toContain('?hub=')
        }
      }
    })
  })

  // ─── configureWebhooks (telegram only) ───────────────────────

  describe('configureWebhooks', () => {
    let fetchSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      fetchSpy = spyOn(globalThis, 'fetch')
    })

    afterEach(() => {
      fetchSpy.mockRestore()
    })

    it('telegram supports webhook auto-config', () => {
      expect(MESSAGING_CAPABILITIES.telegram.supportsWebhookAutoConfig).toBe(true)
      expect(MESSAGING_CAPABILITIES.telegram.configureWebhooks).toBeDefined()
    })

    it('sms does not support webhook auto-config', () => {
      expect(MESSAGING_CAPABILITIES.sms.supportsWebhookAutoConfig).toBe(false)
      expect(MESSAGING_CAPABILITIES.sms.configureWebhooks).toBeUndefined()
    })

    it('telegram configureWebhooks calls setWebhook API', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const config = { enabled: true, botToken: '123:ABC', webhookSecret: 'sec' }
      const webhookUrls = {
        telegramIncoming: 'https://app.example.com/api/messaging/telegram/webhook',
      }

      const result = await MESSAGING_CAPABILITIES.telegram.configureWebhooks!(config, webhookUrls)

      expect(result.ok).toBe(true)
      expect(result.details?.telegramIncoming).toBe(
        'https://app.example.com/api/messaging/telegram/webhook'
      )

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/setWebhook')
      const body = JSON.parse(init.body as string)
      expect(body.url).toBe('https://app.example.com/api/messaging/telegram/webhook')
      expect(body.secret_token).toBe('sec')
    })

    it('telegram configureWebhooks returns error when telegramIncoming URL is missing', async () => {
      const config = { enabled: true, botToken: '123:ABC' }
      const result = await MESSAGING_CAPABILITIES.telegram.configureWebhooks!(config, {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Missing telegram webhook URL')
    })

    it('telegram configureWebhooks handles API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: 'Invalid URL' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const config = { enabled: true, botToken: '123:ABC' }
      const webhookUrls = { telegramIncoming: 'http://invalid' }

      const result = await MESSAGING_CAPABILITIES.telegram.configureWebhooks!(config, webhookUrls)
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Invalid URL')
    })

    it('telegram configureWebhooks handles network errors', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('DNS resolution failed'))

      const config = { enabled: true, botToken: '123:ABC' }
      const webhookUrls = { telegramIncoming: 'https://app.example.com/webhook' }

      const result = await MESSAGING_CAPABILITIES.telegram.configureWebhooks!(config, webhookUrls)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('DNS resolution failed')
    })
  })
})
