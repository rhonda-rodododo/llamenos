import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { CryptoService } from '../../lib/crypto-service'
import { TelnyxSMSAdapter } from './telnyx'

const TEST_API_KEY = 'KEY_telnyx_test_abc123'
const TEST_PHONE = '+15551234567'

function makeCryptoService(): CryptoService {
  return {
    hmac: mock((input: string, label: string) => `hmac:${label}:${input}`),
  } as unknown as CryptoService
}

function makeTelnyxWebhook(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: {
      event_type: 'message.received',
      id: 'evt-001',
      occurred_at: '2026-01-15T10:30:00Z',
      record_type: 'event',
      payload: {
        id: 'MSG-TELNYX-001',
        direction: 'inbound',
        from: { phone_number: '+14155551234' },
        to: [{ phone_number: '+15551234567' }],
        text: 'Hello, I need help',
        received_at: '2026-01-15T10:30:00Z',
        ...overrides,
      },
    },
  }
}

function makeJsonRequest(body: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request('https://example.com/api/messaging/sms/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('TelnyxSMSAdapter', () => {
  let adapter: TelnyxSMSAdapter
  let cryptoService: CryptoService
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    cryptoService = makeCryptoService()
    adapter = new TelnyxSMSAdapter(TEST_API_KEY, TEST_PHONE, cryptoService)
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // ─── parseIncomingMessage ─────────────────────────────────────

  describe('parseIncomingMessage', () => {
    it('parses standard Telnyx inbound message webhook', async () => {
      const request = makeJsonRequest(makeTelnyxWebhook())

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('sms')
      expect(msg.externalId).toBe('MSG-TELNYX-001')
      expect(msg.senderIdentifier).toBe('+14155551234')
      expect(msg.body).toBe('Hello, I need help')
      expect(msg.timestamp).toBe('2026-01-15T10:30:00Z')
      expect(msg.metadata).toEqual({ to: '+15551234567' })
      expect(msg.mediaUrls).toBeUndefined()
      expect(msg.mediaTypes).toBeUndefined()
    })

    it('hashes sender identifier via CryptoService.hmac with HMAC_PHONE_PREFIX', async () => {
      const request = makeJsonRequest(makeTelnyxWebhook())

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:+14155551234`)
      expect(cryptoService.hmac).toHaveBeenCalledWith('+14155551234', HMAC_PHONE_PREFIX)
    })

    it('parses media attachments', async () => {
      const request = makeJsonRequest(
        makeTelnyxWebhook({
          media: [
            { url: 'https://telnyx.com/media/img0.jpg', content_type: 'image/jpeg' },
            { url: 'https://telnyx.com/media/doc1.pdf', content_type: 'application/pdf' },
          ],
        })
      )

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.mediaUrls).toEqual([
        'https://telnyx.com/media/img0.jpg',
        'https://telnyx.com/media/doc1.pdf',
      ])
      expect(msg.mediaTypes).toEqual(['image/jpeg', 'application/pdf'])
    })

    it('handles missing text field gracefully (returns undefined)', async () => {
      const request = makeJsonRequest(makeTelnyxWebhook({ text: undefined }))

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.body).toBeUndefined()
    })

    it('handles missing from field with empty string default', async () => {
      const request = makeJsonRequest(makeTelnyxWebhook({ from: undefined }))

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.senderIdentifier).toBe('')
    })

    it('falls back to phoneNumber when to array is missing', async () => {
      const request = makeJsonRequest(makeTelnyxWebhook({ to: undefined }))

      const msg = await adapter.parseIncomingMessage(request)
      expect(msg.metadata).toEqual({ to: TEST_PHONE })
    })
  })

  // ─── sendMessage ──────────────────────────────────────────────

  describe('sendMessage', () => {
    it('sends POST to api.telnyx.com with Bearer auth', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'TELNYX-SENT-001' } }), { status: 200 })
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'Your call has been received',
      })

      expect(result).toEqual({ success: true, externalId: 'TELNYX-SENT-001' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.telnyx.com/v2/messages')
      expect(opts.method).toBe('POST')

      // Verify Bearer auth header
      expect((opts.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_API_KEY}`)

      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.to).toBe('+14155559999')
      expect(sentBody.from).toBe(TEST_PHONE)
      expect(sentBody.text).toBe('Your call has been received')
    })

    it('returns error on non-OK response with Telnyx error detail', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ detail: 'Invalid phone number format' }] }), {
          status: 400,
        })
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: 'bad-number',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid phone number format')
    })

    it('returns generic error when Telnyx error body is not JSON', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Telnyx API returned 500')
    })
  })

  // ─── sendMediaMessage ─────────────────────────────────────────

  describe('sendMediaMessage', () => {
    it('includes media_urls in the request body', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'TELNYX-MEDIA-001' } }), { status: 200 })
      )

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'Here is an image',
        mediaUrl: 'https://storage.example.com/photo.jpg',
        mediaType: 'image/jpeg',
      })

      expect(result).toEqual({ success: true, externalId: 'TELNYX-MEDIA-001' })

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.telnyx.com/v2/messages')

      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.media_urls).toEqual(['https://storage.example.com/photo.jpg'])
      expect(sentBody.text).toBe('Here is an image')
      expect(sentBody.from).toBe(TEST_PHONE)
      expect(sentBody.to).toBe('+14155559999')
    })

    it('returns error on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ detail: 'Media URL unreachable' }] }), {
          status: 422,
        })
      )

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
        mediaUrl: 'https://broken.example.com/img.jpg',
        mediaType: 'image/jpeg',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Media URL unreachable')
    })
  })

  // ─── parseStatusWebhook ───────────────────────────────────────

  describe('parseStatusWebhook', () => {
    it('maps "message.sent" to "sent" status', async () => {
      const body = {
        data: {
          event_type: 'message.sent',
          id: 'evt-status-001',
          occurred_at: '2026-01-15T10:31:00Z',
          record_type: 'event',
          payload: {
            id: 'MSG-STATUS-001',
            direction: 'outbound',
            sent_at: '2026-01-15T10:31:00Z',
          },
        },
      }

      const request = makeJsonRequest(body)
      const update = await adapter.parseStatusWebhook(request)

      expect(update).not.toBeNull()
      expect(update?.externalId).toBe('MSG-STATUS-001')
      expect(update?.status).toBe('sent')
      expect(update?.failureReason).toBeUndefined()
      expect(update?.timestamp).toBe('2026-01-15T10:31:00Z')
    })

    it('maps "message.finalized" to "delivered" status', async () => {
      const body = {
        data: {
          event_type: 'message.finalized',
          id: 'evt-status-002',
          occurred_at: '2026-01-15T10:32:00Z',
          record_type: 'event',
          payload: {
            id: 'MSG-STATUS-002',
            direction: 'outbound',
            completed_at: '2026-01-15T10:32:00Z',
          },
        },
      }

      const request = makeJsonRequest(body)
      const update = await adapter.parseStatusWebhook(request)

      expect(update).not.toBeNull()
      expect(update?.status).toBe('delivered')
      expect(update?.timestamp).toBe('2026-01-15T10:32:00Z')
    })

    it('maps "message.failed" to "failed" with error details', async () => {
      const body = {
        data: {
          event_type: 'message.failed',
          id: 'evt-status-003',
          occurred_at: '2026-01-15T10:33:00Z',
          record_type: 'event',
          payload: {
            id: 'MSG-STATUS-003',
            direction: 'outbound',
            errors: [{ code: '40001', title: 'Undeliverable', detail: 'Number not reachable' }],
          },
        },
      }

      const request = makeJsonRequest(body)
      const update = await adapter.parseStatusWebhook(request)

      expect(update).not.toBeNull()
      expect(update?.status).toBe('failed')
      expect(update?.failureReason).toBe('Number not reachable')
    })

    it('returns null for unknown event types', async () => {
      const body = {
        data: {
          event_type: 'message.received',
          id: 'evt-unknown',
          occurred_at: '2026-01-15T10:34:00Z',
          record_type: 'event',
          payload: { id: 'MSG-UNK-001', direction: 'inbound' },
        },
      }

      const request = makeJsonRequest(body)
      const update = await adapter.parseStatusWebhook(request)
      expect(update).toBeNull()
    })

    it('returns null when payload id is missing', async () => {
      const body = {
        data: {
          event_type: 'message.sent',
          id: 'evt-noid',
          occurred_at: '2026-01-15T10:35:00Z',
          record_type: 'event',
          payload: { direction: 'outbound' },
        },
      }

      const request = makeJsonRequest(body)
      const update = await adapter.parseStatusWebhook(request)
      expect(update).toBeNull()
    })

    it('returns null on malformed JSON', async () => {
      const request = new Request('https://example.com/api/messaging/sms/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      })

      const update = await adapter.parseStatusWebhook(request)
      expect(update).toBeNull()
    })
  })

  // ─── validateWebhook ──────────────────────────────────────────

  describe('validateWebhook', () => {
    it('returns false when telnyx-signature-ed25519 header is missing', async () => {
      const request = makeJsonRequest(makeTelnyxWebhook(), {
        'telnyx-timestamp': '1700000000',
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('returns false when telnyx-timestamp header is missing', async () => {
      const request = makeJsonRequest(makeTelnyxWebhook(), {
        'telnyx-signature-ed25519': 'somesig',
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('returns false when timestamp is not a number', async () => {
      const request = makeJsonRequest(makeTelnyxWebhook(), {
        'telnyx-signature-ed25519': 'somesig',
        'telnyx-timestamp': 'not-a-number',
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('returns false when timestamp is older than 5 minutes', async () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400)
      const request = makeJsonRequest(makeTelnyxWebhook(), {
        'telnyx-signature-ed25519': btoa('somesig'),
        'telnyx-timestamp': oldTimestamp,
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })
  })

  // ─── getChannelStatus ─────────────────────────────────────────

  describe('getChannelStatus', () => {
    it('returns connected status on successful API response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details).toEqual({
        provider: 'telnyx',
        channel: 'sms',
        phoneNumber: TEST_PHONE,
      })

      // Verify GET to messaging_profiles endpoint
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.telnyx.com/v2/messaging_profiles')
      expect(opts.method).toBe('GET')
      expect((opts.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_API_KEY}`)
    })

    it('returns disconnected on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Telnyx API returned 401')
    })

    it('returns disconnected on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network unreachable'))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Network unreachable')
    })

    it('returns generic error for non-Error throws', async () => {
      fetchSpy.mockRejectedValueOnce('some string error')

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Unknown error connecting to Telnyx')
    })
  })
})
