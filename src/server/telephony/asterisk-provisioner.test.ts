import type { Mock } from 'bun:test'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { AsteriskProvisioner } from './asterisk-provisioner'

const BRIDGE_URL = 'http://localhost:8088'
const BRIDGE_SECRET = 'test-bridge-secret'
const ASTERISK_DOMAIN = 'pbx.example.com'
const WSS_PORT = 8089
const STUN_SERVER = 'stun:stun.l.google.com:19302'
const TURN_SERVER = 'turn:turn.example.com:3478'
const TURN_SECRET = 'test-turn-secret'

const originalFetch = globalThis.fetch

// biome-ignore lint/suspicious/noExplicitAny: test mock requires broad type
type AnyMock = Mock<(...args: any[]) => any>

describe('AsteriskProvisioner', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetch(responseBody: unknown, status = 200) {
    const fn = mock(
      async () =>
        new Response(JSON.stringify(responseBody), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    globalThis.fetch = fn as unknown as typeof fetch
  }

  test('provisionEndpoint returns correct SipEndpointConfig with STUN only', async () => {
    mockFetch({ ok: true, username: 'vol_abc123', password: 'sip-pass-xyz' })

    const provisioner = new AsteriskProvisioner(
      BRIDGE_URL,
      BRIDGE_SECRET,
      ASTERISK_DOMAIN,
      WSS_PORT,
      STUN_SERVER
    )

    const config = await provisioner.provisionEndpoint('abc123')

    expect(config.sipUri).toBe('sip:vol_abc123@pbx.example.com')
    expect(config.wsUri).toBe('wss://pbx.example.com:8089/ws')
    expect(config.username).toBe('vol_abc123')
    expect(config.password).toBe('sip-pass-xyz')
    expect(config.iceServers).toHaveLength(1)
    expect(config.iceServers[0].urls).toBe(STUN_SERVER)

    // Verify fetch was called with correct path
    const fetchMock = globalThis.fetch as unknown as AnyMock
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(callArgs[0]).toBe(`${BRIDGE_URL}/provision-endpoint`)
    expect(callArgs[1].method).toBe('POST')
  })

  test('provisionEndpoint includes TURN credentials when configured', async () => {
    mockFetch({ ok: true, username: 'vol_def456', password: 'sip-pass-abc' })

    const provisioner = new AsteriskProvisioner(
      BRIDGE_URL,
      BRIDGE_SECRET,
      ASTERISK_DOMAIN,
      WSS_PORT,
      STUN_SERVER,
      TURN_SERVER,
      TURN_SECRET
    )

    const config = await provisioner.provisionEndpoint('def456')

    expect(config.iceServers).toHaveLength(2)

    // STUN server
    expect(config.iceServers[0].urls).toBe(STUN_SERVER)
    expect(config.iceServers[0].username).toBeUndefined()

    // TURN server with time-limited credentials
    const turnEntry = config.iceServers[1]
    expect(turnEntry.urls).toBe(TURN_SERVER)
    expect(turnEntry.username).toMatch(/^\d+:vol_def456$/)
    expect(turnEntry.credential).toBeTruthy()
    expect(typeof turnEntry.credential).toBe('string')

    // Verify username contains a future timestamp (expiry)
    const [expiryStr] = turnEntry.username?.split(':')
    const expiry = Number.parseInt(expiryStr, 10)
    const now = Math.floor(Date.now() / 1000)
    // Expiry should be ~86400 seconds in the future (with some tolerance)
    expect(expiry).toBeGreaterThan(now + 86000)
    expect(expiry).toBeLessThan(now + 87000)
  })

  test('deprovisionEndpoint calls the bridge', async () => {
    mockFetch({ ok: true })

    const provisioner = new AsteriskProvisioner(
      BRIDGE_URL,
      BRIDGE_SECRET,
      ASTERISK_DOMAIN,
      WSS_PORT,
      STUN_SERVER
    )

    await provisioner.deprovisionEndpoint('abc123')

    const fetchMock = globalThis.fetch as unknown as AnyMock
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(callArgs[0]).toBe(`${BRIDGE_URL}/deprovision-endpoint`)
    expect(callArgs[1].method).toBe('POST')
    expect(JSON.parse(callArgs[1].body as string)).toEqual({ pubkey: 'abc123' })
  })

  test('checkEndpoint returns true when endpoint exists', async () => {
    mockFetch({ exists: true })

    const provisioner = new AsteriskProvisioner(
      BRIDGE_URL,
      BRIDGE_SECRET,
      ASTERISK_DOMAIN,
      WSS_PORT,
      STUN_SERVER
    )

    const result = await provisioner.checkEndpoint('abc123')
    expect(result).toBe(true)
  })

  test('checkEndpoint returns false when endpoint does not exist', async () => {
    mockFetch({ exists: false })

    const provisioner = new AsteriskProvisioner(
      BRIDGE_URL,
      BRIDGE_SECRET,
      ASTERISK_DOMAIN,
      WSS_PORT,
      STUN_SERVER
    )

    const result = await provisioner.checkEndpoint('nonexistent')
    expect(result).toBe(false)
  })

  test('checkEndpoint returns false on bridge error', async () => {
    const fn = mock(async () => new Response('Internal Server Error', { status: 500 }))
    globalThis.fetch = fn as unknown as typeof fetch

    const provisioner = new AsteriskProvisioner(
      BRIDGE_URL,
      BRIDGE_SECRET,
      ASTERISK_DOMAIN,
      WSS_PORT,
      STUN_SERVER
    )

    const result = await provisioner.checkEndpoint('abc123')
    expect(result).toBe(false)
  })

  test('bridge requests include HMAC signature headers', async () => {
    mockFetch({ ok: true, username: 'vol_test', password: 'pass' })

    const provisioner = new AsteriskProvisioner(
      BRIDGE_URL,
      BRIDGE_SECRET,
      ASTERISK_DOMAIN,
      WSS_PORT,
      STUN_SERVER
    )

    await provisioner.provisionEndpoint('test')

    const fetchMock = globalThis.fetch as unknown as AnyMock
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = callArgs[1].headers as Record<string, string>
    expect(headers['X-Bridge-Signature']).toBeTruthy()
    expect(headers['X-Bridge-Timestamp']).toBeTruthy()
    // Signature should be hex-encoded
    expect(headers['X-Bridge-Signature']).toMatch(/^[0-9a-f]+$/)
  })
})
