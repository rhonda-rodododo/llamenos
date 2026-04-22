import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { TelegramBotClient } from './client'

const TEST_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'
const BASE_URL = `https://api.telegram.org/bot${TEST_TOKEN}`

describe('TelegramBotClient', () => {
  let client: TelegramBotClient
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    client = new TelegramBotClient(TEST_TOKEN)
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // ─── sendMessage ─────────────────────────────────────────────

  describe('sendMessage', () => {
    it('sends POST to /sendMessage with correct body and returns message_id', async () => {
      const fakeMessage = {
        message_id: 42,
        chat: { id: 100, type: 'private' as const },
        date: 1700000000,
      }
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: fakeMessage }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.sendMessage(100, 'Hello')

      expect(result.ok).toBe(true)
      expect(result.result?.message_id).toBe(42)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE_URL}/sendMessage`)
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ chat_id: 100, text: 'Hello' })
    })

    it('returns error when API responds with ok: false', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            description: 'Bad Request: chat not found',
            error_code: 400,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      )

      const result = await client.sendMessage(999, 'fail')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Bad Request: chat not found')
      expect(result.result).toBeUndefined()
    })

    it('falls back to HTTP status when description is missing', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.sendMessage(100, 'fail')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('HTTP 500')
    })
  })

  // ─── sendPhoto ───────────────────────────────────────────────

  describe('sendPhoto', () => {
    it('sends photo URL with optional caption', async () => {
      const fakeMessage = {
        message_id: 43,
        chat: { id: 100, type: 'private' as const },
        date: 1700000000,
      }
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: fakeMessage }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.sendPhoto(100, 'https://example.com/photo.jpg', 'A caption')

      expect(result.ok).toBe(true)
      expect(result.result?.message_id).toBe(43)

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE_URL}/sendPhoto`)
      const body = JSON.parse(init.body as string)
      expect(body.chat_id).toBe(100)
      expect(body.photo).toBe('https://example.com/photo.jpg')
      expect(body.caption).toBe('A caption')
    })

    it('omits caption when not provided', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: 1, chat: { id: 1, type: 'private' }, date: 0 },
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )

      await client.sendPhoto(100, 'https://example.com/photo.jpg')

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string)
      expect(body.caption).toBeUndefined()
    })

    it('returns error on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.sendPhoto(100, 'bad')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Forbidden')
    })
  })

  // ─── sendVoice ───────────────────────────────────────────────

  describe('sendVoice', () => {
    it('sends voice URL as OGG to /sendVoice', async () => {
      const fakeMessage = {
        message_id: 44,
        chat: { id: 200, type: 'private' as const },
        date: 1700000000,
      }
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: fakeMessage }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.sendVoice(200, 'https://example.com/voice.ogg')

      expect(result.ok).toBe(true)

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE_URL}/sendVoice`)
      const body = JSON.parse(init.body as string)
      expect(body.chat_id).toBe(200)
      expect(body.voice).toBe('https://example.com/voice.ogg')
    })
  })

  // ─── getMe ───────────────────────────────────────────────────

  describe('getMe', () => {
    it('returns bot info on success', async () => {
      const botUser = {
        id: 123456,
        is_bot: true,
        first_name: 'TestBot',
        username: 'test_crisis_bot',
      }
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: botUser }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.getMe()

      expect(result.ok).toBe(true)
      expect(result.result?.id).toBe(123456)
      expect(result.result?.username).toBe('test_crisis_bot')
      expect(result.result?.is_bot).toBe(true)

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE_URL}/getMe`)
      expect(init.method).toBe('GET')
    })

    it('returns error on unauthorized', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.getMe()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Unauthorized')
    })
  })

  // ─── setWebhook ──────────────────────────────────────────────

  describe('setWebhook', () => {
    it('sends webhook URL with secret token', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.setWebhook('https://example.com/webhook', 'my-secret')

      expect(result.ok).toBe(true)

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE_URL}/setWebhook`)
      const body = JSON.parse(init.body as string)
      expect(body.url).toBe('https://example.com/webhook')
      expect(body.secret_token).toBe('my-secret')
    })

    it('omits secret_token when not provided', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      await client.setWebhook('https://example.com/webhook')

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string)
      expect(body.secret_token).toBeUndefined()
    })

    it('returns error on API failure', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: 'Bad webhook URL' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.setWebhook('http://not-https.com')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Bad webhook URL')
    })
  })

  // ─── getFile ─────────────────────────────────────────────────

  describe('getFile', () => {
    it('returns file info with file_path', async () => {
      const fileInfo = {
        file_id: 'AgACAgIAAxkBAAI',
        file_unique_id: 'AQADAgATunique',
        file_size: 12345,
        file_path: 'voice/file_0.ogg',
      }
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: fileInfo }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.getFile('AgACAgIAAxkBAAI')

      expect(result.ok).toBe(true)
      expect(result.result?.file_path).toBe('voice/file_0.ogg')
      expect(result.result?.file_id).toBe('AgACAgIAAxkBAAI')

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BASE_URL}/getFile`)
      expect(init.method).toBe('POST')
      const body = JSON.parse(init.body as string)
      expect(body.file_id).toBe('AgACAgIAAxkBAAI')
    })

    it('returns error when file not found', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: 'Bad Request: file not found' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await client.getFile('invalid')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Bad Request: file not found')
    })
  })

  // ─── downloadFile ────────────────────────────────────────────

  describe('downloadFile', () => {
    it('fetches binary content from file download URL', async () => {
      const binaryData = new Uint8Array([0x4f, 0x67, 0x67, 0x53]) // OGG magic bytes
      fetchSpy.mockResolvedValueOnce(new Response(binaryData, { status: 200 }))

      const result = await client.downloadFile('voice/file_0.ogg')

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://api.telegram.org/file/bot${TEST_TOKEN}/voice/file_0.ogg`)

      const resultBytes = new Uint8Array(result)
      expect(resultBytes).toEqual(binaryData)
    })

    it('throws on HTTP error', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))

      await expect(client.downloadFile('invalid/path')).rejects.toThrow(
        'Failed to download Telegram file: HTTP 404'
      )
    })
  })
})
