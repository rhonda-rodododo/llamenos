import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { WhatsAppConfig } from '@shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import { WhatsAppAdapter } from './adapter'
import type { TwilioWhatsAppClient } from './twilio-client'
import type { MetaWebhookPayload } from './types'

// ─── Helpers ────────────────────────────────────────────────────

function makeCryptoService(): CryptoService {
  return {
    hmac: mock((input: string, label: string) => `hmac:${label}:${input}`),
  } as unknown as CryptoService
}

const META_DIRECT_CONFIG: WhatsAppConfig = {
  integrationMode: 'direct',
  phoneNumberId: 'pn_123456',
  businessAccountId: 'ba_789',
  accessToken: 'test_access_token',
  appSecret: 'test_app_secret',
}

function makeMetaWebhookPayload(overrides?: Partial<MetaWebhookPayload>): MetaWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'ba_789',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+15551234567',
                phone_number_id: 'pn_123456',
              },
              contacts: [{ profile: { name: 'Test User' }, wa_id: '14155551234' }],
              messages: [
                {
                  from: '14155551234',
                  id: 'wamid.abc123',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'Hello, I need help' },
                },
              ],
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

function makeJsonRequest(
  payload: unknown,
  url = 'https://example.com/api/messaging/whatsapp/webhook'
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function makeFormRequest(
  fields: Record<string, string>,
  url = 'https://example.com/api/messaging/whatsapp/webhook'
): Request {
  const body = new URLSearchParams(fields)
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

// ─── Meta Direct Mode Tests ─────────────────────────────────────

describe('WhatsAppAdapter (Meta Direct mode)', () => {
  let adapter: WhatsAppAdapter
  let cryptoService: CryptoService
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    cryptoService = makeCryptoService()
    fetchSpy = spyOn(globalThis, 'fetch')

    // Mock the health check fetch that happens during MetaDirectClient construction
    // (none happens in constructor, but needed for later tests)
    adapter = new WhatsAppAdapter(META_DIRECT_CONFIG, cryptoService)
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // ─── parseIncomingMessage (Meta Cloud API) ───────────────────

  describe('parseIncomingMessage', () => {
    it('parses a standard text message from Meta Cloud API webhook', async () => {
      const payload = makeMetaWebhookPayload()
      const request = makeJsonRequest(payload)

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('whatsapp')
      expect(msg.externalId).toBe('wamid.abc123')
      expect(msg.senderIdentifier).toBe('14155551234')
      expect(msg.body).toBe('Hello, I need help')
      expect(msg.mediaUrls).toBeUndefined()
      expect(msg.mediaTypes).toBeUndefined()
      expect(msg.timestamp).toBeTruthy()
      expect(msg.metadata?.profileName).toBe('Test User')
      expect(msg.metadata?.waId).toBe('14155551234')
      expect(msg.metadata?.messageType).toBe('text')
      expect(msg.metadata?.phoneNumberId).toBe('pn_123456')
    })

    it('hashes sender identifier via CryptoService.hmac with HMAC_PHONE_PREFIX', async () => {
      const payload = makeMetaWebhookPayload()
      const request = makeJsonRequest(payload)

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:14155551234`)
      expect(cryptoService.hmac).toHaveBeenCalledWith('14155551234', HMAC_PHONE_PREFIX)
    })

    it('parses image message with media references', async () => {
      const payload = makeMetaWebhookPayload()
      const msg = payload.entry[0].changes[0].value.messages![0]
      msg.type = 'image'
      msg.text = undefined
      msg.image = { id: 'media_id_001', mime_type: 'image/jpeg', sha256: 'abc', caption: 'A photo' }

      const request = makeJsonRequest(payload)
      const result = await adapter.parseIncomingMessage(request)

      expect(result.body).toBe('A photo')
      expect(result.mediaUrls).toEqual(['media_id_001'])
      expect(result.mediaTypes).toEqual(['image/jpeg'])
    })

    it('parses location message', async () => {
      const payload = makeMetaWebhookPayload()
      const msg = payload.entry[0].changes[0].value.messages![0]
      msg.type = 'location'
      msg.text = undefined
      msg.location = { latitude: 37.7749, longitude: -122.4194, name: 'SF', address: '123 Main St' }

      const request = makeJsonRequest(payload)
      const result = await adapter.parseIncomingMessage(request)

      expect(result.body).toBe('Location: 37.7749, -122.4194 (SF) - 123 Main St')
    })

    it('parses reaction message', async () => {
      const payload = makeMetaWebhookPayload()
      const msg = payload.entry[0].changes[0].value.messages![0]
      msg.type = 'reaction'
      msg.text = undefined
      msg.reaction = { emoji: '👍', message_id: 'wamid.target001' }

      const request = makeJsonRequest(payload)
      const result = await adapter.parseIncomingMessage(request)

      expect(result.body).toBe('Reaction: 👍 on message wamid.target001')
    })

    it('throws when webhook has no entry', async () => {
      const payload: MetaWebhookPayload = { object: 'whatsapp_business_account', entry: [] }
      const request = makeJsonRequest(payload)

      await expect(adapter.parseIncomingMessage(request)).rejects.toThrow('no entry')
    })

    it('throws when webhook has no messages (status update)', async () => {
      const payload = makeMetaWebhookPayload()
      payload.entry[0].changes[0].value.messages = undefined

      const request = makeJsonRequest(payload)
      await expect(adapter.parseIncomingMessage(request)).rejects.toThrow('no messages')
    })
  })

  // ─── sendMessage (Meta Direct) ───────────────────────────────

  describe('sendMessage', () => {
    it('delegates to MetaDirectClient and returns success with message ID', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            contacts: [{ input: '14155559999', wa_id: '14155559999' }],
            messages: [{ id: 'wamid.sent001' }],
          }),
          { status: 200 }
        )
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: '14155559999',
        body: 'Your call has been received',
      })

      expect(result).toEqual({ success: true, externalId: 'wamid.sent001' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://graph.facebook.com/v21.0/pn_123456/messages')
      expect(opts.method).toBe('POST')

      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.to).toBe('14155559999')
      expect(sentBody.type).toBe('text')
      expect(sentBody.text.body).toBe('Your call has been received')
    })

    it('returns error when Meta API fails', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const result = await adapter.sendMessage({
        recipientIdentifier: '14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('401')
    })

    it('catches network errors and returns failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network unreachable'))

      const result = await adapter.sendMessage({
        recipientIdentifier: '14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network unreachable')
    })
  })

  // ─── sendMediaMessage (Meta Direct) ──────────────────────────

  describe('sendMediaMessage', () => {
    it('sends image via Meta Cloud API', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messaging_product: 'whatsapp',
            contacts: [{ input: '14155559999', wa_id: '14155559999' }],
            messages: [{ id: 'wamid.media001' }],
          }),
          { status: 200 }
        )
      )

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '14155559999',
        body: 'See this image',
        mediaUrl: 'https://storage.example.com/photo.jpg',
        mediaType: 'image/jpeg',
      })

      expect(result).toEqual({ success: true, externalId: 'wamid.media001' })

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.type).toBe('image')
      expect(sentBody.image.link).toBe('https://storage.example.com/photo.jpg')
    })
  })

  // ─── validateWebhook (Meta Direct) ───────────────────────────

  describe('validateWebhook', () => {
    it('returns false when X-Hub-Signature-256 header is missing', async () => {
      const request = makeJsonRequest(makeMetaWebhookPayload())
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('validates a correctly signed Meta webhook', async () => {
      const body = JSON.stringify(makeMetaWebhookPayload())

      // Compute expected HMAC-SHA256 signature
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode('test_app_secret'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
      const hex = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const request = new Request('https://example.com/api/messaging/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${hex}`,
        },
        body,
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(true)
    })

    it('rejects incorrectly signed Meta webhook', async () => {
      const request = new Request('https://example.com/api/messaging/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256':
            'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        },
        body: JSON.stringify(makeMetaWebhookPayload()),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })
  })

  // ─── getChannelStatus (Meta Direct) ──────────────────────────

  describe('getChannelStatus', () => {
    it('returns connected with integration mode details on success', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'pn_123456' }), { status: 200 })
      )

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details?.integrationMode).toBe('direct')
      expect(status.details?.provider).toBe('meta-direct')
    })

    it('returns disconnected on API error', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toContain('401')
    })

    it('returns disconnected on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network unreachable'))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toContain('Network unreachable')
    })
  })

  // ─── parseStatusWebhook (Meta Direct) ────────────────────────

  describe('parseStatusWebhook', () => {
    it('parses a Meta "delivered" status update', async () => {
      const payload: MetaWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'ba_789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+15551234567', phone_number_id: 'pn_123456' },
                  statuses: [
                    {
                      id: 'wamid.status001',
                      status: 'delivered',
                      timestamp: '1700000000',
                      recipient_id: '14155551234',
                    },
                  ],
                },
              },
            ],
          },
        ],
      }

      const request = makeJsonRequest(payload)
      const update = await adapter.parseStatusWebhook!(request)

      expect(update).not.toBeNull()
      expect(update!.externalId).toBe('wamid.status001')
      expect(update!.status).toBe('delivered')
    })

    it('parses a Meta "failed" status with error details', async () => {
      const payload: MetaWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'ba_789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+15551234567', phone_number_id: 'pn_123456' },
                  statuses: [
                    {
                      id: 'wamid.fail001',
                      status: 'failed',
                      timestamp: '1700000000',
                      recipient_id: '14155551234',
                      errors: [
                        {
                          code: 131026,
                          title: 'Rate limit',
                          message: 'Too many messages',
                          error_data: { details: 'slow down' },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      }

      const request = makeJsonRequest(payload)
      const update = await adapter.parseStatusWebhook!(request)

      expect(update).not.toBeNull()
      expect(update!.status).toBe('failed')
      expect(update!.failureReason).toBe('Too many messages')
    })

    it('returns null when no statuses present', async () => {
      const payload: MetaWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'ba_789',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+15551234567', phone_number_id: 'pn_123456' },
                },
              },
            ],
          },
        ],
      }

      const request = makeJsonRequest(payload)
      const update = await adapter.parseStatusWebhook!(request)
      expect(update).toBeNull()
    })
  })
})

// ─── Twilio Mode Tests ──────────────────────────────────────────

describe('WhatsAppAdapter (Twilio mode)', () => {
  let adapter: WhatsAppAdapter
  let cryptoService: CryptoService
  let mockClient: TwilioWhatsAppClient

  beforeEach(() => {
    cryptoService = makeCryptoService()

    mockClient = {
      sendTextMessage: mock(() =>
        Promise.resolve({
          sid: 'SM_WA_001',
          status: 'queued',
          error_code: null,
          error_message: null,
        })
      ),
      sendMediaMessage: mock(() =>
        Promise.resolve({
          sid: 'SM_WA_MEDIA_001',
          status: 'queued',
          error_code: null,
          error_message: null,
        })
      ),
      validateSignature: mock(() => Promise.resolve(true)),
      checkHealth: mock(() => Promise.resolve({ ok: true })),
    } as unknown as TwilioWhatsAppClient

    const config: WhatsAppConfig = { integrationMode: 'twilio' }
    adapter = WhatsAppAdapter.createWithTwilioClient(config, mockClient, cryptoService)
  })

  describe('parseIncomingMessage (Twilio)', () => {
    it('parses a Twilio WhatsApp webhook and strips whatsapp: prefix', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_WA_IN_001',
        AccountSid: 'AC_test',
        From: 'whatsapp:+14155551234',
        To: 'whatsapp:+15551234567',
        Body: 'Help me please',
        NumMedia: '0',
        ProfileName: 'John Doe',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('whatsapp')
      expect(msg.externalId).toBe('SM_WA_IN_001')
      expect(msg.senderIdentifier).toBe('+14155551234')
      expect(msg.body).toBe('Help me please')
      expect(msg.metadata?.profileName).toBe('John Doe')
      expect(msg.metadata?.twilioAccountSid).toBe('AC_test')
    })

    it('hashes sender via CryptoService.hmac after stripping whatsapp: prefix', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_WA_IN_002',
        AccountSid: 'AC_test',
        From: 'whatsapp:+14155551234',
        To: 'whatsapp:+15551234567',
        Body: 'test',
        NumMedia: '0',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:+14155551234`)
    })

    it('parses media attachments from Twilio webhook', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_WA_MEDIA_IN',
        AccountSid: 'AC_test',
        From: 'whatsapp:+14155551234',
        To: 'whatsapp:+15551234567',
        Body: 'See attached',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/wa_img0.jpg',
        MediaContentType0: 'image/jpeg',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.mediaUrls).toEqual(['https://api.twilio.com/media/wa_img0.jpg'])
      expect(msg.mediaTypes).toEqual(['image/jpeg'])
    })

    it('handles missing Body gracefully', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_WA_NOBODY',
        AccountSid: 'AC_test',
        From: 'whatsapp:+14155551234',
        To: 'whatsapp:+15551234567',
        NumMedia: '0',
      })

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.body).toBeUndefined()
    })
  })

  describe('sendMessage (Twilio)', () => {
    it('delegates to TwilioWhatsAppClient and returns success', async () => {
      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'Response message',
      })

      expect(result).toEqual({ success: true, externalId: 'SM_WA_001' })
      expect(mockClient.sendTextMessage).toHaveBeenCalledWith('+14155559999', 'Response message')
    })

    it('returns error when client throws', async () => {
      ;(mockClient.sendTextMessage as ReturnType<typeof mock>).mockRejectedValueOnce(
        new Error('Twilio error')
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Twilio error')
    })
  })

  describe('sendMediaMessage (Twilio)', () => {
    it('delegates to TwilioWhatsAppClient with media params', async () => {
      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'Image caption',
        mediaUrl: 'https://storage.example.com/photo.jpg',
        mediaType: 'image/jpeg',
      })

      expect(result).toEqual({ success: true, externalId: 'SM_WA_MEDIA_001' })
      expect(mockClient.sendMediaMessage).toHaveBeenCalledWith(
        '+14155559999',
        'https://storage.example.com/photo.jpg',
        'image/jpeg',
        'Image caption'
      )
    })
  })

  describe('validateWebhook (Twilio)', () => {
    it('delegates to TwilioWhatsAppClient.validateSignature', async () => {
      const request = makeFormRequest({ Body: 'test' })

      const valid = await adapter.validateWebhook(request)

      expect(valid).toBe(true)
      expect(mockClient.validateSignature).toHaveBeenCalled()
    })
  })

  describe('getChannelStatus (Twilio)', () => {
    it('returns connected with twilio integration mode', async () => {
      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details?.integrationMode).toBe('twilio')
      expect(status.details?.provider).toBe('twilio')
    })

    it('returns disconnected when health check fails', async () => {
      ;(mockClient.checkHealth as ReturnType<typeof mock>).mockResolvedValueOnce({
        ok: false,
        error: 'Auth failed',
      })

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Auth failed')
    })
  })

  describe('parseStatusWebhook (Twilio)', () => {
    it('maps Twilio "delivered" to normalized delivered', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_WA_STATUS_001',
        MessageStatus: 'delivered',
      })

      const update = await adapter.parseStatusWebhook!(request)

      expect(update).not.toBeNull()
      expect(update!.externalId).toBe('SM_WA_STATUS_001')
      expect(update!.status).toBe('delivered')
    })

    it('maps "queued" to "pending"', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_WA_Q_001',
        MessageStatus: 'queued',
      })

      const update = await adapter.parseStatusWebhook!(request)
      expect(update!.status).toBe('pending')
    })

    it('maps "undelivered" to "failed"', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_WA_UNDEL_001',
        MessageStatus: 'undelivered',
      })

      const update = await adapter.parseStatusWebhook!(request)
      expect(update!.status).toBe('failed')
    })

    it('returns null when MessageSid is missing', async () => {
      const request = makeFormRequest({ MessageStatus: 'delivered' })
      const update = await adapter.parseStatusWebhook!(request)
      expect(update).toBeNull()
    })
  })
})
