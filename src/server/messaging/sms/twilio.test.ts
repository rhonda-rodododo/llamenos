import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { CryptoService } from '../../lib/crypto-service'
import { TwilioSMSAdapter } from './twilio'

const TEST_ACCOUNT_SID = 'ACtest00000000000000000000000000'
const TEST_AUTH_TOKEN = 'test_auth_token_abc123'
const TEST_PHONE = '+15551234567'

function makeCryptoService(): CryptoService {
  return {
    hmac: mock((input: string, label: string) => `hmac:${label}:${input}`),
  } as unknown as CryptoService
}

function makeFormRequest(
  fields: Record<string, string>,
  url = 'https://example.com/api/messaging/sms/webhook'
): Request {
  const body = new URLSearchParams(fields)
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

describe('TwilioSMSAdapter', () => {
  let adapter: TwilioSMSAdapter
  let cryptoService: CryptoService
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    cryptoService = makeCryptoService()
    adapter = new TwilioSMSAdapter(TEST_ACCOUNT_SID, TEST_AUTH_TOKEN, TEST_PHONE, cryptoService)
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    process.env.BASE_URL = undefined as unknown as string
  })

  // ─── parseIncomingMessage ─────────────────────────────────────

  describe('parseIncomingMessage', () => {
    it('parses standard Twilio SMS webhook fields', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Body: 'Hello, I need help',
        MessageSid: 'SM1234abcd',
        NumMedia: '0',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('sms')
      expect(msg.externalId).toBe('SM1234abcd')
      expect(msg.senderIdentifier).toBe('+14155551234')
      expect(msg.body).toBe('Hello, I need help')
      expect(msg.mediaUrls).toBeUndefined()
      expect(msg.mediaTypes).toBeUndefined()
      expect(msg.metadata).toEqual({ to: '+15551234567' })
      expect(msg.timestamp).toBeTruthy()
    })

    it('hashes sender identifier via CryptoService.hmac with HMAC_PHONE_PREFIX', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Body: 'test',
        MessageSid: 'SM0001',
        NumMedia: '0',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:+14155551234`)
      expect(cryptoService.hmac).toHaveBeenCalledWith('+14155551234', HMAC_PHONE_PREFIX)
    })

    it('parses media attachments from NumMedia > 0', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        Body: 'See attached',
        MessageSid: 'SM2222',
        NumMedia: '2',
        MediaUrl0: 'https://api.twilio.com/media/img0.jpg',
        MediaContentType0: 'image/jpeg',
        MediaUrl1: 'https://api.twilio.com/media/doc1.pdf',
        MediaContentType1: 'application/pdf',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.mediaUrls).toEqual([
        'https://api.twilio.com/media/img0.jpg',
        'https://api.twilio.com/media/doc1.pdf',
      ])
      expect(msg.mediaTypes).toEqual(['image/jpeg', 'application/pdf'])
    })

    it('handles missing Body field gracefully (returns undefined)', async () => {
      const request = makeFormRequest({
        From: '+14155551234',
        To: '+15551234567',
        MessageSid: 'SM3333',
        NumMedia: '0',
      })

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.body).toBeUndefined()
    })

    it('handles missing fields with empty string defaults', async () => {
      const request = makeFormRequest({})

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifier).toBe('')
      expect(msg.externalId).toBe('')
      expect(msg.metadata).toEqual({ to: '' })
    })
  })

  // ─── sendMessage ──────────────────────────────────────────────

  describe('sendMessage', () => {
    it('sends POST to Twilio Messages API with correct params', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM_SENT_001' }), { status: 200 })
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'Your call has been received',
      })

      expect(result).toEqual({ success: true, externalId: 'SM_SENT_001' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        `https://api.twilio.com/2010-04-01/Accounts/${TEST_ACCOUNT_SID}/Messages.json`
      )
      expect(opts.method).toBe('POST')

      // Verify Basic auth header
      const expectedAuth = `Basic ${btoa(`${TEST_ACCOUNT_SID}:${TEST_AUTH_TOKEN}`)}`
      expect((opts.headers as Record<string, string>).Authorization).toBe(expectedAuth)

      // Verify form body params
      const sentBody = new URLSearchParams(opts.body as string)
      expect(sentBody.get('To')).toBe('+14155559999')
      expect(sentBody.get('From')).toBe(TEST_PHONE)
      expect(sentBody.get('Body')).toBe('Your call has been received')
    })

    it('includes StatusCallback when BASE_URL is set', async () => {
      process.env.BASE_URL = 'https://hotline.example.com'
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM_CB_001' }), { status: 200 })
      )

      await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const sentBody = new URLSearchParams(opts.body as string)
      expect(sentBody.get('StatusCallback')).toBe(
        'https://hotline.example.com/api/messaging/sms/webhook'
      )
    })

    it('does not include StatusCallback when BASE_URL is unset', async () => {
      process.env.BASE_URL = undefined as unknown as string
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM_NOCB' }), { status: 200 })
      )

      await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const sentBody = new URLSearchParams(opts.body as string)
      expect(sentBody.get('StatusCallback')).toBeNull()
    })

    it('returns error on non-OK response with Twilio error message', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Invalid phone number' }), { status: 400 })
      )

      const result = await adapter.sendMessage({
        recipientIdentifier: 'bad-number',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid phone number')
    })

    it('returns generic error when Twilio response body is not JSON', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Twilio SMS API returned 500')
    })
  })

  // ─── sendMediaMessage ─────────────────────────────────────────

  describe('sendMediaMessage', () => {
    it('includes MediaUrl in the request body', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM_MEDIA_001' }), { status: 200 })
      )

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'Here is an image',
        mediaUrl: 'https://storage.example.com/photo.jpg',
        mediaType: 'image/jpeg',
      })

      expect(result).toEqual({ success: true, externalId: 'SM_MEDIA_001' })

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      const sentBody = new URLSearchParams(opts.body as string)
      expect(sentBody.get('MediaUrl')).toBe('https://storage.example.com/photo.jpg')
      expect(sentBody.get('Body')).toBe('Here is an image')
    })
  })

  // ─── getChannelStatus ─────────────────────────────────────────

  describe('getChannelStatus', () => {
    it('returns connected status with account details on success', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'active', friendly_name: 'Crisis Hotline' }), {
          status: 200,
        })
      )

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details).toEqual({
        provider: 'twilio',
        channel: 'sms',
        accountStatus: 'active',
        accountName: 'Crisis Hotline',
        phoneNumber: TEST_PHONE,
      })

      // Verify GET to account endpoint
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${TEST_ACCOUNT_SID}.json`)
      expect(opts.method).toBe('GET')
    })

    it('returns disconnected on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Twilio API returned 401')
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
      expect(status.error).toBe('Unknown error connecting to Twilio')
    })
  })

  // ─── deleteMessage ────────────────────────────────────────────

  describe('deleteMessage', () => {
    it('sends DELETE to the correct Twilio message endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))

      await adapter.deleteMessage('SM_DEL_001')

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        `https://api.twilio.com/2010-04-01/Accounts/${TEST_ACCOUNT_SID}/Messages/SM_DEL_001.json`
      )
      expect(opts.method).toBe('DELETE')
    })
  })

  // ─── parseStatusWebhook ───────────────────────────────────────

  describe('parseStatusWebhook', () => {
    it('maps Twilio "delivered" status to normalized "delivered"', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_STATUS_001',
        MessageStatus: 'delivered',
      })

      const update = await adapter.parseStatusWebhook(request)

      expect(update).not.toBeNull()
      expect(update?.externalId).toBe('SM_STATUS_001')
      expect(update?.status).toBe('delivered')
      expect(update?.failureReason).toBeUndefined()
    })

    it('maps Twilio "failed" status with error details', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_FAIL_001',
        MessageStatus: 'failed',
        ErrorCode: '30006',
        ErrorMessage: 'Landline or unreachable carrier',
      })

      const update = await adapter.parseStatusWebhook(request)

      expect(update).not.toBeNull()
      expect(update?.status).toBe('failed')
      expect(update?.failureReason).toBe('30006: Landline or unreachable carrier')
    })

    it('maps "queued" and "sending" to "pending"', async () => {
      for (const twilioStatus of ['queued', 'sending']) {
        const request = makeFormRequest({
          MessageSid: 'SM_Q_001',
          MessageStatus: twilioStatus,
        })

        const update = await adapter.parseStatusWebhook(request)
        expect(update?.status).toBe('pending')
      }
    })

    it('maps "undelivered" to "failed"', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_UNDEL_001',
        MessageStatus: 'undelivered',
      })

      const update = await adapter.parseStatusWebhook(request)
      expect(update?.status).toBe('failed')
    })

    it('returns null for unknown status values', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_UNK_001',
        MessageStatus: 'received',
      })

      const update = await adapter.parseStatusWebhook(request)
      expect(update).toBeNull()
    })

    it('returns null when MessageSid is missing', async () => {
      const request = makeFormRequest({
        MessageStatus: 'delivered',
      })

      const update = await adapter.parseStatusWebhook(request)
      expect(update).toBeNull()
    })

    it('returns null when MessageStatus is missing', async () => {
      const request = makeFormRequest({
        MessageSid: 'SM_NOSTATUS',
      })

      const update = await adapter.parseStatusWebhook(request)
      expect(update).toBeNull()
    })
  })

  // ─── validateWebhook ──────────────────────────────────────────

  describe('validateWebhook', () => {
    it('returns false when X-Twilio-Signature header is missing', async () => {
      const request = makeFormRequest({
        Body: 'test',
        From: '+14155551234',
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('validates a correctly signed webhook', async () => {
      const url = 'https://example.com/api/messaging/sms/webhook'
      const fields: Record<string, string> = {
        Body: 'Hello',
        From: '+14155551234',
        To: '+15551234567',
      }

      // Compute expected signature the same way the adapter does
      const params = new URLSearchParams(fields)
      let dataString = url
      for (const key of Array.from(params.keys()).sort()) {
        dataString += key + params.get(key)
      }

      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(TEST_AUTH_TOKEN),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(dataString))
      const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))

      const body = params.toString()
      const request = new Request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': signature,
        },
        body,
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(true)
    })

    it('rejects an incorrectly signed webhook', async () => {
      const request = new Request('https://example.com/api/messaging/sms/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': 'invalid_signature_base64==',
        },
        body: new URLSearchParams({ Body: 'test', From: '+14155551234' }).toString(),
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })
  })
})
