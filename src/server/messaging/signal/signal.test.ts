import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { SignalConfig } from '@shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import { SignalAdapter } from './adapter'
import type { SignalAboutResponse, SignalSendResponse, SignalWebhookPayload } from './types'

// ─── Helpers ────────────────────────────────────────────────────

const TEST_CONFIG: SignalConfig = {
  bridgeUrl: 'https://signal-bridge.example.com/',
  bridgeApiKey: 'bridge_api_key_abc123',
  webhookSecret: 'webhook_secret_xyz789',
  registeredNumber: '+15551234567',
}

function makeCryptoService(): CryptoService {
  return {
    hmac: mock((input: string, label: string) => `hmac:${label}:${input}`),
  } as unknown as CryptoService
}

function makeWebhookPayload(overrides?: Partial<SignalWebhookPayload>): SignalWebhookPayload {
  return {
    envelope: {
      source: '+14155551234',
      sourceUuid: 'uuid-1234-abcd',
      sourceName: 'Test User',
      sourceDevice: 1,
      timestamp: 1700000000000,
      dataMessage: {
        message: 'Hello, I need help',
        timestamp: 1700000000000,
      },
    },
    ...overrides,
  }
}

function makeJsonRequest(
  payload: unknown,
  url = 'https://example.com/api/messaging/signal/webhook'
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function makeAuthRequest(
  payload: unknown,
  secret: string,
  url = 'https://example.com/api/messaging/signal/webhook'
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  })
}

// ─── Tests ──────────────────────────────────────────────────────

describe('SignalAdapter', () => {
  let adapter: SignalAdapter
  let cryptoService: CryptoService
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    cryptoService = makeCryptoService()
    adapter = new SignalAdapter(TEST_CONFIG, cryptoService)
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // ─── parseIncomingMessage ─────────────────────────────────────

  describe('parseIncomingMessage', () => {
    it('parses a standard signal-cli webhook with text message', async () => {
      const payload = makeWebhookPayload()
      const request = makeJsonRequest(payload)

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('signal')
      expect(msg.externalId).toBe('1700000000000')
      expect(msg.senderIdentifier).toBe('uuid-1234-abcd')
      expect(msg.body).toBe('Hello, I need help')
      expect(msg.mediaUrls).toBeUndefined()
      expect(msg.mediaTypes).toBeUndefined()
      expect(msg.timestamp).toBe(new Date(1700000000000).toISOString())
    })

    it('uses source phone when sourceUuid is not available', async () => {
      const payload = makeWebhookPayload()
      payload.envelope.sourceUuid = undefined

      const request = makeJsonRequest(payload)
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifier).toBe('+14155551234')
    })

    it('hashes the source phone via CryptoService.hmac with HMAC_PHONE_PREFIX', async () => {
      const payload = makeWebhookPayload()
      const request = makeJsonRequest(payload)

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:+14155551234`)
      expect(cryptoService.hmac).toHaveBeenCalledWith('+14155551234', HMAC_PHONE_PREFIX)
    })

    it('parses attachments with bridge attachment URLs', async () => {
      const payload = makeWebhookPayload()
      payload.envelope.dataMessage!.attachments = [
        { id: 'att_001', contentType: 'image/jpeg', size: 1024 },
        { id: 'att_002', contentType: 'audio/ogg', size: 2048 },
      ]

      const request = makeJsonRequest(payload)
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.mediaUrls).toEqual([
        'https://signal-bridge.example.com/v1/attachments/att_001',
        'https://signal-bridge.example.com/v1/attachments/att_002',
      ])
      expect(msg.mediaTypes).toEqual(['image/jpeg', 'audio/ogg'])
    })

    it('strips trailing slash from bridge URL in attachment paths', async () => {
      // Config has trailing slash; adapter should normalize
      const payload = makeWebhookPayload()
      payload.envelope.dataMessage!.attachments = [
        { id: 'att_003', contentType: 'image/png', size: 512 },
      ]

      const request = makeJsonRequest(payload)
      const msg = await adapter.parseIncomingMessage(request)

      // Should NOT produce double slash
      expect(msg.mediaUrls?.[0]).toBe('https://signal-bridge.example.com/v1/attachments/att_003')
    })

    it('includes metadata from envelope fields', async () => {
      const payload = makeWebhookPayload()
      payload.envelope.dataMessage!.groupInfo = { groupId: 'group_abc', type: 'DELIVER' }

      const request = makeJsonRequest(payload)
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.metadata?.source).toBe('+14155551234')
      expect(msg.metadata?.sourceUuid).toBe('uuid-1234-abcd')
      expect(msg.metadata?.sourceName).toBe('Test User')
      expect(msg.metadata?.sourceDevice).toBe('1')
      expect(msg.metadata?.groupId).toBe('group_abc')
    })

    it('handles missing dataMessage.message (undefined body)', async () => {
      const payload = makeWebhookPayload()
      payload.envelope.dataMessage!.message = undefined

      const request = makeJsonRequest(payload)
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.body).toBeUndefined()
    })
  })

  // ─── validateWebhook ──────────────────────────────────────────

  describe('validateWebhook', () => {
    it('returns true for a matching Bearer token', async () => {
      const request = makeAuthRequest({}, 'webhook_secret_xyz789')
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(true)
    })

    it('returns false when Authorization header is missing', async () => {
      const request = makeJsonRequest({})
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('returns false for wrong Bearer token', async () => {
      const request = makeAuthRequest({}, 'wrong_secret')
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('returns false for non-Bearer auth scheme', async () => {
      const request = new Request('https://example.com/api/messaging/signal/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic dGVzdDp0ZXN0',
        },
        body: '{}',
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('uses constant-time comparison (different-length tokens still return false)', async () => {
      const request = makeAuthRequest({}, 'short')
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })
  })

  // ─── sendMessage ──────────────────────────────────────────────

  describe('sendMessage', () => {
    it('sends POST to signal-cli bridge /v2/send with correct payload', async () => {
      const sendResponse: SignalSendResponse = { timestamp: 1700000001000 }
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(sendResponse), { status: 200 }))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'Your call has been received',
      })

      expect(result).toEqual({ success: true, externalId: '1700000001000' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://signal-bridge.example.com/v2/send')
      expect(opts.method).toBe('POST')
      expect((opts.headers as Record<string, string>).Authorization).toBe(
        'Bearer bridge_api_key_abc123'
      )

      const sentBody = JSON.parse(opts.body as string)
      expect(sentBody.number).toBe('+15551234567')
      expect(sentBody.recipients).toEqual(['+14155559999'])
      expect(sentBody.message).toBe('Your call has been received')
    })

    it('returns error on non-OK bridge response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Signal bridge returned 400')
    })

    it('returns error on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection refused')
    })
  })

  // ─── sendMediaMessage ─────────────────────────────────────────

  describe('sendMediaMessage', () => {
    it('downloads media, base64-encodes it, and sends as attachment', async () => {
      // First call: media download
      const mediaBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG header
      fetchSpy.mockResolvedValueOnce(new Response(mediaBytes, { status: 200 }))

      // Second call: signal-cli bridge send
      const sendResponse: SignalSendResponse = { timestamp: 1700000002000 }
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(sendResponse), { status: 200 }))

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'Here is a document',
        mediaUrl: 'https://storage.example.com/photo.png',
        mediaType: 'image/png',
      })

      expect(result).toEqual({ success: true, externalId: '1700000002000' })
      expect(fetchSpy).toHaveBeenCalledTimes(2)

      // Verify media download
      const [downloadUrl] = fetchSpy.mock.calls[0] as [string]
      expect(downloadUrl).toBe('https://storage.example.com/photo.png')

      // Verify send request includes base64 attachment
      const [sendUrl, sendOpts] = fetchSpy.mock.calls[1] as [string, RequestInit]
      expect(sendUrl).toBe('https://signal-bridge.example.com/v2/send')

      const sentBody = JSON.parse(sendOpts.body as string)
      expect(sentBody.message).toBe('Here is a document')
      expect(sentBody.base64_attachments).toHaveLength(1)
      expect(sentBody.base64_attachments[0]).toStartWith('data:image/png;base64,')
    })

    it('returns error when media download fails', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
        mediaUrl: 'https://storage.example.com/missing.png',
        mediaType: 'image/png',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to download media')
    })

    it('returns error when bridge send fails after download', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      fetchSpy.mockResolvedValueOnce(new Response('Server Error', { status: 500 }))

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
        mediaUrl: 'https://storage.example.com/file.pdf',
        mediaType: 'application/pdf',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Signal bridge returned 500')
    })
  })

  // ─── getChannelStatus ─────────────────────────────────────────

  describe('getChannelStatus', () => {
    it('returns connected with version details from /v1/about', async () => {
      const aboutResponse: SignalAboutResponse = {
        versions: { 'signal-cli': '0.13.0', 'signal-cli-rest-api': '0.80' },
        mode: 'native',
        number: '+15551234567',
      }
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(aboutResponse), { status: 200 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details).toEqual({
        signalCliVersion: '0.13.0',
        apiVersion: '0.80',
        mode: 'native',
        registeredNumber: '+15551234567',
      })

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://signal-bridge.example.com/v1/about')
      expect(opts.method).toBe('GET')
      expect((opts.headers as Record<string, string>).Authorization).toBe(
        'Bearer bridge_api_key_abc123'
      )
    })

    it('returns disconnected on non-OK response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Signal bridge returned 401')
    })

    it('returns disconnected on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toContain('Connection refused')
    })

    it('falls back to configured number when about response has no number', async () => {
      const aboutResponse: SignalAboutResponse = {
        versions: { 'signal-cli': '0.13.0', 'signal-cli-rest-api': '0.80' },
        mode: 'native',
      }
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(aboutResponse), { status: 200 }))

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.details?.registeredNumber).toBe('+15551234567')
    })
  })
})
