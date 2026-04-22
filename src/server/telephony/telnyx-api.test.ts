import type { Mock } from 'bun:test'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { TelnyxCallControlClient } from './telnyx-api'

const TEST_API_KEY = 'KEY_test_abc123'

const originalFetch = globalThis.fetch

// biome-ignore lint/suspicious/noExplicitAny: test mock requires broad type
type AnyMock = Mock<(...args: any[]) => any>

function mockFetch(responseBody: unknown, status = 200, contentType = 'application/json') {
  const fn = mock(
    async () =>
      new Response(typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody), {
        status,
        headers: { 'Content-Type': contentType },
      })
  )
  globalThis.fetch = fn as unknown as typeof fetch
  return fn as unknown as AnyMock
}

function mockFetchArrayBuffer(buffer: ArrayBuffer, status = 200) {
  const fn = mock(
    async () =>
      new Response(buffer, {
        status,
        headers: { 'Content-Type': 'audio/wav' },
      })
  )
  globalThis.fetch = fn as unknown as typeof fetch
  return fn as unknown as AnyMock
}

describe('TelnyxCallControlClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ─── command() ───────────────────────────────────────────────

  describe('command()', () => {
    test('sends POST to correct URL with Bearer auth and JSON body', async () => {
      const fetchMock = mockFetch({ data: {} })
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await client.command('ctrl-id-123', 'answer', { client_state: 'abc' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.telnyx.com/v2/calls/ctrl-id-123/actions/answer')
      expect(opts.method).toBe('POST')
      const headers = opts.headers as Record<string, string>
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`)
      expect(headers['Content-Type']).toBe('application/json')
      expect(JSON.parse(opts.body as string)).toEqual({ client_state: 'abc' })
    })

    test('sends empty JSON body when no body provided', async () => {
      const fetchMock = mockFetch({ data: {} })
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await client.command('ctrl-id-123', 'hangup')

      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(opts.body).toBe('{}')
    })

    test('URL-encodes call_control_id', async () => {
      const fetchMock = mockFetch({ data: {} })
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await client.command('id/with special&chars', 'answer')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('id%2Fwith%20special%26chars')
    })

    test('throws AppError on non-200 response', async () => {
      mockFetch('Unauthorized', 401)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await expect(client.command('ctrl-id', 'answer')).rejects.toThrow(
        /Telnyx API error \(answer\): 401/
      )
    })
  })

  // ─── createCall() ────────────────────────────────────────────

  describe('createCall()', () => {
    test('sends correct payload and returns call IDs', async () => {
      const responseData = {
        data: {
          call_control_id: 'cc-id-1',
          call_leg_id: 'leg-1',
          call_session_id: 'session-1',
        },
      }
      const fetchMock = mockFetch(responseData)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      const result = await client.createCall({
        to: '+15551234567',
        from: '+15559876543',
        connection_id: 'conn-123',
        webhook_url: 'https://example.com/webhook',
        timeout_secs: 30,
      })

      expect(result).toEqual({
        call_control_id: 'cc-id-1',
        call_leg_id: 'leg-1',
        call_session_id: 'session-1',
      })

      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.telnyx.com/v2/calls')
      expect(opts.method).toBe('POST')
      const body = JSON.parse(opts.body as string)
      expect(body.to).toBe('+15551234567')
      expect(body.from).toBe('+15559876543')
      expect(body.connection_id).toBe('conn-123')
      expect(body.webhook_url).toBe('https://example.com/webhook')
      expect(body.timeout_secs).toBe(30)
    })

    test('omits optional fields when not provided', async () => {
      mockFetch({
        data: { call_control_id: 'cc-1', call_leg_id: 'leg-1', call_session_id: 'sess-1' },
      })
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await client.createCall({
        to: '+15551234567',
        from: '+15559876543',
        connection_id: 'conn-123',
      })

      const fetchMock = globalThis.fetch as unknown as AnyMock
      const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(opts.body as string)
      expect(body.webhook_url).toBeUndefined()
      expect(body.client_state).toBeUndefined()
      expect(body.timeout_secs).toBeUndefined()
    })

    test('throws AppError on non-200 response', async () => {
      mockFetch('Bad Request', 400)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await expect(client.createCall({ to: '+1', from: '+2', connection_id: 'c' })).rejects.toThrow(
        /Telnyx API error \(createCall\): 400/
      )
    })
  })

  // ─── getRecording() ──────────────────────────────────────────

  describe('getRecording()', () => {
    test('fetches audio with Bearer auth and returns ArrayBuffer', async () => {
      const audioData = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer // "RIFF" header
      const fetchMock = mockFetchArrayBuffer(audioData)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      const result = await client.getRecording('https://api.telnyx.com/v2/recordings/rec-1/audio')

      expect(result.byteLength).toBe(4)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.telnyx.com/v2/recordings/rec-1/audio')
      const headers = opts.headers as Record<string, string>
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`)
    })

    test('throws AppError on non-200 response', async () => {
      mockFetch('Not Found', 404)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await expect(
        client.getRecording('https://api.telnyx.com/v2/recordings/bad/audio')
      ).rejects.toThrow(/Telnyx API error \(getRecording\): 404/)
    })
  })

  // ─── deleteRecording() ───────────────────────────────────────

  describe('deleteRecording()', () => {
    test('sends DELETE to correct URL with Bearer auth', async () => {
      const fetchMock = mockFetch('', 200)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await client.deleteRecording('rec-456')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.telnyx.com/v2/recordings/rec-456')
      expect(opts.method).toBe('DELETE')
      const headers = opts.headers as Record<string, string>
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`)
    })

    test('URL-encodes recording ID', async () => {
      const fetchMock = mockFetch('', 200)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await client.deleteRecording('rec/special&id')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('rec%2Fspecial%26id')
    })

    test('throws AppError on non-200 response', async () => {
      mockFetch('Server Error', 500)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await expect(client.deleteRecording('rec-bad')).rejects.toThrow(
        /Telnyx API error \(deleteRecording\): 500/
      )
    })
  })

  // ─── testConnection() ───────────────────────────────────────

  describe('testConnection()', () => {
    test('returns true on 200 response', async () => {
      mockFetch({ data: [] })
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      const result = await client.testConnection()
      expect(result).toBe(true)
    })

    test('returns false on non-200 response', async () => {
      mockFetch('Unauthorized', 401)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      const result = await client.testConnection()
      expect(result).toBe(false)
    })
  })

  // ─── getPublicKey() ──────────────────────────────────────────

  describe('getPublicKey()', () => {
    test('returns public key string', async () => {
      mockFetch({ data: { public_key: 'base64-ed25519-pubkey' } })
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      const key = await client.getPublicKey()
      expect(key).toBe('base64-ed25519-pubkey')
    })

    test('throws on non-200 response', async () => {
      mockFetch('Unauthorized', 401)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      await expect(client.getPublicKey()).rejects.toThrow(/Telnyx API error \(getPublicKey\): 401/)
    })
  })

  // ─── getCallControlApp() ────────────────────────────────────

  describe('getCallControlApp()', () => {
    test('returns app config on success', async () => {
      mockFetch({
        data: {
          webhook_event_url: 'https://example.com/webhook',
          webhook_event_failover_url: 'https://example.com/failover',
        },
      })
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      const result = await client.getCallControlApp('app-123')
      expect(result).toEqual({
        webhook_event_url: 'https://example.com/webhook',
        webhook_event_failover_url: 'https://example.com/failover',
      })
    })

    test('returns null on non-200 response', async () => {
      mockFetch('Not Found', 404)
      const client = new TelnyxCallControlClient(TEST_API_KEY)

      const result = await client.getCallControlApp('bad-app')
      expect(result).toBeNull()
    })
  })
})
