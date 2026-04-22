import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { RCSConfig } from '@shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import { RCSAdapter } from './adapter'
import type { RBMApiResponse, RBMWebhookPayload } from './types'

// ─── Helpers ────────────────────────────────────────────────────

// Minimal valid Google service account key (private key is unused in tests since we mock the client)
const FAKE_SERVICE_ACCOUNT_KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'key123',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7sBp\n-----END PRIVATE KEY-----\n',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  client_id: '123456789',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/test',
})

const TEST_CONFIG: RCSConfig = {
  agentId: 'rcs-agent-001',
  serviceAccountKey: FAKE_SERVICE_ACCOUNT_KEY,
  fallbackToSms: false,
}

function makeCryptoService(): CryptoService {
  return {
    hmac: mock((input: string, label: string) => `hmac:${label}:${input}`),
  } as unknown as CryptoService
}

function makeTextWebhookPayload(): RBMWebhookPayload {
  return {
    agentId: 'rcs-agent-001',
    senderId: '+14155551234',
    message: {
      messageId: 'rcs-msg-001',
      sendTime: '2024-01-15T10:30:00Z',
      text: 'Hello, I need help',
    },
  }
}

function makeJsonRequest(
  payload: unknown,
  url = 'https://example.com/api/messaging/rcs/webhook'
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/**
 * Create an RCSAdapter and replace the internal RBMClient with a mock.
 * This avoids the JWT/OAuth complexity in the real RBMClient.
 */
function makeAdapterWithMockClient(cryptoService: CryptoService) {
  const mockClient = {
    sendMessage: mock(
      (_phone: string, _content: unknown): Promise<RBMApiResponse> =>
        Promise.resolve({ name: 'rcs-sent-001' })
    ),
    checkStatus: mock(
      (): Promise<{ connected: boolean; error?: string }> => Promise.resolve({ connected: true })
    ),
  }

  const adapter = new RCSAdapter(TEST_CONFIG, cryptoService)
  // Replace the internal client with our mock
  ;(adapter as unknown as { client: typeof mockClient }).client = mockClient

  return { adapter, mockClient }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('RCSAdapter', () => {
  let cryptoService: CryptoService

  beforeEach(() => {
    cryptoService = makeCryptoService()
  })

  // ─── parseIncomingMessage ─────────────────────────────────────

  describe('parseIncomingMessage', () => {
    it('parses a standard RCS text message webhook', async () => {
      const { adapter } = makeAdapterWithMockClient(cryptoService)
      const payload = makeTextWebhookPayload()
      const request = makeJsonRequest(payload)

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('rcs')
      expect(msg.externalId).toBe('rcs-msg-001')
      expect(msg.senderIdentifier).toBe('+14155551234')
      expect(msg.body).toBe('Hello, I need help')
      expect(msg.mediaUrls).toBeUndefined()
      expect(msg.mediaTypes).toBeUndefined()
      expect(msg.timestamp).toBe('2024-01-15T10:30:00Z')
      expect(msg.metadata?.agentId).toBe('rcs-agent-001')
    })

    it('hashes sender identifier via CryptoService.hmac with HMAC_PHONE_PREFIX', async () => {
      const { adapter } = makeAdapterWithMockClient(cryptoService)
      const payload = makeTextWebhookPayload()
      const request = makeJsonRequest(payload)

      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.senderIdentifierHash).toBe(`hmac:${HMAC_PHONE_PREFIX}:+14155551234`)
      expect(cryptoService.hmac).toHaveBeenCalledWith('+14155551234', HMAC_PHONE_PREFIX)
    })

    it('parses file attachments from userFile payload', async () => {
      const { adapter } = makeAdapterWithMockClient(cryptoService)
      const payload: RBMWebhookPayload = {
        agentId: 'rcs-agent-001',
        senderId: '+14155551234',
        message: {
          messageId: 'rcs-msg-media-001',
          sendTime: '2024-01-15T10:31:00Z',
          userFile: {
            payload: {
              mimeType: 'image/jpeg',
              fileSizeBytes: 102400,
              fileUri: 'https://rcsbm.googleapis.com/files/abc123',
              fileName: 'photo.jpg',
            },
          },
        },
      }

      const request = makeJsonRequest(payload)
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.mediaUrls).toEqual(['https://rcsbm.googleapis.com/files/abc123'])
      expect(msg.mediaTypes).toEqual(['image/jpeg'])
    })

    it('parses suggestion response with postback data', async () => {
      const { adapter } = makeAdapterWithMockClient(cryptoService)
      const payload: RBMWebhookPayload = {
        agentId: 'rcs-agent-001',
        senderId: '+14155551234',
        message: {
          messageId: 'rcs-msg-suggestion-001',
          sendTime: '2024-01-15T10:32:00Z',
          suggestionResponse: {
            postbackData: 'action_confirm',
            text: 'Yes, confirm',
            type: 'REPLY',
          },
        },
      }

      const request = makeJsonRequest(payload)
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.body).toBe('Yes, confirm')
      expect(msg.metadata?.postbackData).toBe('action_confirm')
    })

    it('throws when webhook has no message content', async () => {
      const { adapter } = makeAdapterWithMockClient(cryptoService)
      const payload: RBMWebhookPayload = {
        agentId: 'rcs-agent-001',
        senderId: '+14155551234',
        event: { eventId: 'evt-001', sendTime: '2024-01-15T10:33:00Z', eventType: 'DELIVERED' },
      }

      const request = makeJsonRequest(payload)
      await expect(adapter.parseIncomingMessage(request)).rejects.toThrow('no message content')
    })
  })

  // ─── validateWebhook ──────────────────────────────────────────

  describe('validateWebhook', () => {
    it('returns true when no webhookSecret is configured', async () => {
      const config: RCSConfig = { ...TEST_CONFIG, webhookSecret: undefined }
      const adapter = new RCSAdapter(config, cryptoService)
      ;(adapter as unknown as { client: { sendMessage: unknown; checkStatus: unknown } }).client = {
        sendMessage: mock(() => Promise.resolve({ name: 'x' })),
        checkStatus: mock(() => Promise.resolve({ connected: true })),
      }

      const request = makeJsonRequest({})
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(true)
    })

    it('returns true for matching Bearer token', async () => {
      const config: RCSConfig = { ...TEST_CONFIG, webhookSecret: 'my_secret_token' }
      const adapter = new RCSAdapter(config, cryptoService)
      ;(adapter as unknown as { client: { sendMessage: unknown; checkStatus: unknown } }).client = {
        sendMessage: mock(() => Promise.resolve({ name: 'x' })),
        checkStatus: mock(() => Promise.resolve({ connected: true })),
      }

      const request = new Request('https://example.com/api/messaging/rcs/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer my_secret_token',
        },
        body: '{}',
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(true)
    })

    it('returns false for wrong Bearer token', async () => {
      const config: RCSConfig = { ...TEST_CONFIG, webhookSecret: 'my_secret_token' }
      const adapter = new RCSAdapter(config, cryptoService)
      ;(adapter as unknown as { client: { sendMessage: unknown; checkStatus: unknown } }).client = {
        sendMessage: mock(() => Promise.resolve({ name: 'x' })),
        checkStatus: mock(() => Promise.resolve({ connected: true })),
      }

      const request = new Request('https://example.com/api/messaging/rcs/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong_token',
        },
        body: '{}',
      })

      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('returns false when Authorization header is missing', async () => {
      const config: RCSConfig = { ...TEST_CONFIG, webhookSecret: 'my_secret_token' }
      const adapter = new RCSAdapter(config, cryptoService)
      ;(adapter as unknown as { client: { sendMessage: unknown; checkStatus: unknown } }).client = {
        sendMessage: mock(() => Promise.resolve({ name: 'x' })),
        checkStatus: mock(() => Promise.resolve({ connected: true })),
      }

      const request = makeJsonRequest({})
      const valid = await adapter.validateWebhook(request)
      expect(valid).toBe(false)
    })

    it('returns false for non-Bearer auth scheme', async () => {
      const config: RCSConfig = { ...TEST_CONFIG, webhookSecret: 'my_secret_token' }
      const adapter = new RCSAdapter(config, cryptoService)
      ;(adapter as unknown as { client: { sendMessage: unknown; checkStatus: unknown } }).client = {
        sendMessage: mock(() => Promise.resolve({ name: 'x' })),
        checkStatus: mock(() => Promise.resolve({ connected: true })),
      }

      const request = new Request('https://example.com/api/messaging/rcs/webhook', {
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
  })

  // ─── sendMessage ──────────────────────────────────────────────

  describe('sendMessage', () => {
    it('delegates to RBMClient.sendMessage with text content', async () => {
      const { adapter, mockClient } = makeAdapterWithMockClient(cryptoService)

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'Your call has been received',
      })

      expect(result).toEqual({ success: true, externalId: 'rcs-sent-001' })
      expect(mockClient.sendMessage).toHaveBeenCalledWith('+14155559999', {
        text: 'Your call has been received',
      })
    })

    it('returns error when RBMClient returns an error response', async () => {
      const { adapter, mockClient } = makeAdapterWithMockClient(cryptoService)
      mockClient.sendMessage.mockResolvedValueOnce({
        error: { code: 403, message: 'Permission denied', status: 'PERMISSION_DENIED' },
      })

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Permission denied')
    })

    it('catches thrown errors from the client', async () => {
      const { adapter, mockClient } = makeAdapterWithMockClient(cryptoService)
      mockClient.sendMessage.mockRejectedValueOnce(new Error('Network error'))

      const result = await adapter.sendMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })

  // ─── sendMediaMessage ─────────────────────────────────────────

  describe('sendMediaMessage', () => {
    it('sends media message with contentInfo and body', async () => {
      const { adapter, mockClient } = makeAdapterWithMockClient(cryptoService)
      mockClient.sendMessage.mockResolvedValueOnce({ name: 'rcs-media-sent-001' })

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'See this image',
        mediaUrl: 'https://storage.example.com/photo.jpg',
        mediaType: 'image/jpeg',
      })

      expect(result).toEqual({ success: true, externalId: 'rcs-media-sent-001' })
      expect(mockClient.sendMessage).toHaveBeenCalledWith('+14155559999', {
        text: 'See this image',
        contentInfo: {
          fileUrl: 'https://storage.example.com/photo.jpg',
          forceRefresh: true,
        },
      })
    })

    it('sends media without body when body is empty', async () => {
      const { adapter, mockClient } = makeAdapterWithMockClient(cryptoService)
      mockClient.sendMessage.mockResolvedValueOnce({ name: 'rcs-media-sent-002' })

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: '',
        mediaUrl: 'https://storage.example.com/file.pdf',
        mediaType: 'application/pdf',
      })

      expect(result.success).toBe(true)
      // Empty string is falsy so should become undefined
      expect(mockClient.sendMessage).toHaveBeenCalledWith('+14155559999', {
        text: undefined,
        contentInfo: {
          fileUrl: 'https://storage.example.com/file.pdf',
          forceRefresh: true,
        },
      })
    })

    it('returns error on RBM API error', async () => {
      const { adapter, mockClient } = makeAdapterWithMockClient(cryptoService)
      mockClient.sendMessage.mockResolvedValueOnce({
        error: { code: 400, message: 'Invalid file URL', status: 'INVALID_ARGUMENT' },
      })

      const result = await adapter.sendMediaMessage({
        recipientIdentifier: '+14155559999',
        body: 'test',
        mediaUrl: 'bad-url',
        mediaType: 'image/jpeg',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid file URL')
    })
  })

  // ─── getChannelStatus ─────────────────────────────────────────

  describe('getChannelStatus', () => {
    it('returns connected when RBMClient.checkStatus succeeds', async () => {
      const { adapter } = makeAdapterWithMockClient(cryptoService)

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(true)
      expect(status.error).toBeUndefined()
    })

    it('returns disconnected when RBMClient.checkStatus fails', async () => {
      const { adapter, mockClient } = makeAdapterWithMockClient(cryptoService)
      mockClient.checkStatus.mockResolvedValueOnce({
        connected: false,
        error: 'Auth token expired',
      })

      const status = await adapter.getChannelStatus()

      expect(status.connected).toBe(false)
      expect(status.error).toBe('Auth token expired')
    })
  })
})
