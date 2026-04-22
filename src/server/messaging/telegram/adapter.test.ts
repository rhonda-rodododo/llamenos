import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { TelegramConfig } from '../../../shared/types'
import type { CryptoService } from '../../lib/crypto-service'
import { TelegramAdapter } from './adapter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: TelegramConfig = {
  enabled: true,
  botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
  webhookSecret: 'test-webhook-secret-12345',
  botUsername: 'test_crisis_bot',
}

function makeCrypto(): CryptoService {
  return {
    hmac: mock((input: string, _prefix: string) => `hmac:${input}`),
  } as unknown as CryptoService
}

function makeRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request('https://example.com/api/messaging/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

/** Mock globalThis.fetch with a handler function, returning a restore function. */
function mockFetchWith(
  handler: (url: string | URL | Request, init?: RequestInit) => Response | Promise<Response>
): { restore: () => void; getMock: () => ReturnType<typeof mock> } {
  const originalFetch = globalThis.fetch
  const mockFn = mock(handler as typeof fetch) as unknown as typeof fetch
  globalThis.fetch = mockFn
  return {
    restore: () => {
      globalThis.fetch = originalFetch
    },
    getMock: () => mockFn as unknown as ReturnType<typeof mock>,
  }
}

/** Standard text message Update payload */
function textMessageUpdate(overrides?: Record<string, unknown>) {
  return {
    update_id: 123456789,
    message: {
      message_id: 100,
      from: {
        id: 987654321,
        is_bot: false,
        first_name: 'Anonymous',
        username: 'user123',
        language_code: 'es',
      },
      chat: {
        id: 987654321,
        type: 'private',
      },
      date: 1712108400,
      text: 'I need help',
      ...overrides,
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter
  let crypto: CryptoService

  beforeEach(() => {
    crypto = makeCrypto()
    adapter = new TelegramAdapter(TEST_CONFIG, crypto)
  })

  // ── parseIncomingMessage ──────────────────────────────────────────────

  describe('parseIncomingMessage', () => {
    test('parses a text message', async () => {
      const request = makeRequest(textMessageUpdate())
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.channelType).toBe('telegram')
      expect(msg.externalId).toBe('100')
      expect(msg.senderIdentifier).toBe('987654321')
      expect(msg.senderIdentifierHash).toBe('hmac:987654321')
      expect(msg.body).toBe('I need help')
      expect(msg.mediaUrls).toBeUndefined()
      expect(msg.mediaTypes).toBeUndefined()
      expect(msg.timestamp).toBe(new Date(1712108400 * 1000).toISOString())
      expect(msg.metadata?.chatId).toBe('987654321')
      expect(msg.metadata?.chatType).toBe('private')
      expect(msg.metadata?.username).toBe('user123')
      expect(msg.metadata?.firstName).toBe('Anonymous')
      expect(msg.metadata?.languageCode).toBe('es')
    })

    test('parses a voice message', async () => {
      const request = makeRequest(
        textMessageUpdate({
          text: undefined,
          voice: {
            file_id: 'AwACAgIAAxkB_voice_test',
            file_unique_id: 'unique123',
            duration: 5,
            mime_type: 'audio/ogg',
            file_size: 12345,
          },
        })
      )
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.body).toBeUndefined()
      expect(msg.mediaUrls).toEqual(['telegram:file:AwACAgIAAxkB_voice_test'])
      expect(msg.mediaTypes).toEqual(['audio/ogg'])
    })

    test('parses a photo message with caption', async () => {
      const request = makeRequest(
        textMessageUpdate({
          text: undefined,
          caption: 'Look at this',
          photo: [
            {
              file_id: 'small_photo_id',
              file_unique_id: 'u1',
              width: 90,
              height: 90,
            },
            {
              file_id: 'medium_photo_id',
              file_unique_id: 'u2',
              width: 320,
              height: 320,
            },
            {
              file_id: 'large_photo_id',
              file_unique_id: 'u3',
              width: 800,
              height: 800,
              file_size: 54321,
            },
          ],
        })
      )
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.body).toBe('Look at this')
      // Should use the largest photo (last in array)
      expect(msg.mediaUrls).toEqual(['telegram:file:large_photo_id'])
      expect(msg.mediaTypes).toEqual(['image/jpeg'])
    })

    test('parses a document message', async () => {
      const request = makeRequest(
        textMessageUpdate({
          text: undefined,
          caption: 'My document',
          document: {
            file_id: 'doc_file_id_123',
            file_unique_id: 'udoc1',
            file_name: 'report.pdf',
            mime_type: 'application/pdf',
            file_size: 98765,
          },
        })
      )
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.body).toBe('My document')
      expect(msg.mediaUrls).toEqual(['telegram:file:doc_file_id_123'])
      expect(msg.mediaTypes).toEqual(['application/pdf'])
    })

    test('parses an edited message', async () => {
      const update = {
        update_id: 123456790,
        edited_message: {
          message_id: 100,
          from: {
            id: 987654321,
            is_bot: false,
            first_name: 'Anonymous',
          },
          chat: { id: 987654321, type: 'private' as const },
          date: 1712108500,
          text: 'I need help (edited)',
        },
      }
      const request = makeRequest(update)
      const msg = await adapter.parseIncomingMessage(request)

      expect(msg.body).toBe('I need help (edited)')
      expect(msg.metadata?.edited).toBe('true')
    })

    test('throws when update has no message', async () => {
      const request = makeRequest({ update_id: 123 })
      await expect(adapter.parseIncomingMessage(request)).rejects.toThrow(
        'Update does not contain a message'
      )
    })

    test('throws when message has no sender', async () => {
      const update = {
        update_id: 123,
        message: {
          message_id: 1,
          chat: { id: 123, type: 'private' },
          date: 1712108400,
          text: 'test',
        },
      }
      const request = makeRequest(update)
      await expect(adapter.parseIncomingMessage(request)).rejects.toThrow('Message has no sender')
    })
  })

  // ── validateWebhook ───────────────────────────────────────────────────

  describe('validateWebhook', () => {
    test('accepts valid secret token', async () => {
      const request = makeRequest(
        {},
        { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-12345' }
      )
      const result = await adapter.validateWebhook(request)
      expect(result).toBe(true)
    })

    test('rejects incorrect secret token', async () => {
      const request = makeRequest({}, { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' })
      const result = await adapter.validateWebhook(request)
      expect(result).toBe(false)
    })

    test('rejects missing secret token header', async () => {
      const request = makeRequest({})
      const result = await adapter.validateWebhook(request)
      expect(result).toBe(false)
    })

    test('accepts all webhooks when no secret is configured', async () => {
      const noSecretAdapter = new TelegramAdapter(
        { ...TEST_CONFIG, webhookSecret: undefined },
        crypto
      )
      const request = makeRequest({})
      const result = await noSecretAdapter.validateWebhook(request)
      expect(result).toBe(true)
    })
  })

  // ── sendMessage ───────────────────────────────────────────────────────

  describe('sendMessage', () => {
    test('sends a text message and returns externalId', async () => {
      const { restore, getMock } = mockFetchWith(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 201, chat: { id: 12345, type: 'private' }, date: 1712108400 },
            }),
            { status: 200 }
          )
      )

      try {
        const result = await adapter.sendMessage({
          recipientIdentifier: '12345',
          body: 'Hello from Llamenos',
        })

        expect(result.success).toBe(true)
        expect(result.externalId).toBe('201')

        // Verify the fetch call
        const fetchMock = getMock()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toContain('/sendMessage')
        const body = JSON.parse(opts.body as string) as Record<string, unknown>
        expect(body.chat_id).toBe(12345)
        expect(body.text).toBe('Hello from Llamenos')
      } finally {
        restore()
      }
    })

    test('returns error for non-numeric chat ID', async () => {
      const result = await adapter.sendMessage({
        recipientIdentifier: 'not-a-number',
        body: 'Hello',
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('must be numeric')
    })

    test('returns error when API fails', async () => {
      const { restore } = mockFetchWith(
        async () =>
          new Response(
            JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }),
            { status: 403 }
          )
      )

      try {
        const result = await adapter.sendMessage({
          recipientIdentifier: '12345',
          body: 'Hello',
        })
        expect(result.success).toBe(false)
        expect(result.error).toContain('bot was blocked')
      } finally {
        restore()
      }
    })
  })

  // ── sendMediaMessage ──────────────────────────────────────────────────

  describe('sendMediaMessage', () => {
    test('routes image to sendPhoto', async () => {
      const { restore, getMock } = mockFetchWith(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 202, chat: { id: 12345, type: 'private' }, date: 1712108400 },
            }),
            { status: 200 }
          )
      )

      try {
        const result = await adapter.sendMediaMessage({
          recipientIdentifier: '12345',
          body: 'A photo',
          mediaUrl: 'https://example.com/photo.jpg',
          mediaType: 'image/jpeg',
        })

        expect(result.success).toBe(true)
        const [url] = getMock().mock.calls[0] as [string]
        expect(url).toContain('/sendPhoto')
      } finally {
        restore()
      }
    })

    test('routes audio to sendVoice', async () => {
      const { restore, getMock } = mockFetchWith(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 203, chat: { id: 12345, type: 'private' }, date: 1712108400 },
            }),
            { status: 200 }
          )
      )

      try {
        await adapter.sendMediaMessage({
          recipientIdentifier: '12345',
          body: '',
          mediaUrl: 'https://example.com/voice.ogg',
          mediaType: 'audio/ogg',
        })

        const [url] = getMock().mock.calls[0] as [string]
        expect(url).toContain('/sendVoice')
      } finally {
        restore()
      }
    })

    test('routes other types to sendDocument', async () => {
      const { restore, getMock } = mockFetchWith(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 204, chat: { id: 12345, type: 'private' }, date: 1712108400 },
            }),
            { status: 200 }
          )
      )

      try {
        await adapter.sendMediaMessage({
          recipientIdentifier: '12345',
          body: 'A file',
          mediaUrl: 'https://example.com/report.pdf',
          mediaType: 'application/pdf',
        })

        const [url] = getMock().mock.calls[0] as [string]
        expect(url).toContain('/sendDocument')
      } finally {
        restore()
      }
    })
  })

  // ── getChannelStatus ──────────────────────────────────────────────────

  describe('getChannelStatus', () => {
    test('returns connected with bot details', async () => {
      const { restore } = mockFetchWith(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              result: {
                id: 123456,
                is_bot: true,
                first_name: 'CrisisBot',
                username: 'crisis_bot',
              },
            }),
            { status: 200 }
          )
      )

      try {
        const status = await adapter.getChannelStatus()
        expect(status.connected).toBe(true)
        expect(status.details?.botId).toBe(123456)
        expect(status.details?.botUsername).toBe('crisis_bot')
        expect(status.details?.botName).toBe('CrisisBot')
      } finally {
        restore()
      }
    })

    test('returns not connected when API fails', async () => {
      const { restore } = mockFetchWith(
        async () =>
          new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 })
      )

      try {
        const status = await adapter.getChannelStatus()
        expect(status.connected).toBe(false)
        expect(status.error).toContain('Unauthorized')
      } finally {
        restore()
      }
    })

    test('returns not connected when fetch throws', async () => {
      const { restore } = mockFetchWith(async () => {
        throw new Error('Network timeout')
      })

      try {
        const status = await adapter.getChannelStatus()
        expect(status.connected).toBe(false)
        expect(status.error).toContain('Network timeout')
      } finally {
        restore()
      }
    })
  })
})
