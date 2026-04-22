import type { Mock } from 'bun:test'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { SipTrunkProvisionConfig } from './sip-trunk-provisioner'
import { SIP_TRUNK_PRESETS, SipTrunkProvisioner } from './sip-trunk-provisioner'

const BRIDGE_URL = 'http://localhost:8088'
const BRIDGE_SECRET = 'test-bridge-secret'

const originalFetch = globalThis.fetch

// biome-ignore lint/suspicious/noExplicitAny: test mock requires broad type
type AnyMock = Mock<(...args: any[]) => any>

function mockFetch(responseBody: unknown, status = 200) {
  const fn = mock(
    async () =>
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  globalThis.fetch = fn as unknown as typeof fetch
  return fn as unknown as AnyMock
}

function mockFetchError(status = 500) {
  const fn = mock(
    async () =>
      new Response('Internal Server Error', {
        status,
        headers: { 'Content-Type': 'text/plain' },
      })
  )
  globalThis.fetch = fn as unknown as typeof fetch
  return fn as unknown as AnyMock
}

function parseBridgeBody(fetchMock: AnyMock, callIndex: number): Record<string, unknown> {
  const [, opts] = fetchMock.mock.calls[callIndex] as [string, RequestInit]
  return JSON.parse(opts.body as string)
}

describe('SipTrunkProvisioner', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ─── provisionTrunk() with registration auth ────────────────

  describe('provisionTrunk() with registration auth', () => {
    const registrationConfig: SipTrunkProvisionConfig = {
      trunkId: 'trunk-voipms',
      trunkDomain: 'sip.voip.ms',
      trunkPort: 5060,
      transport: 'udp',
      authType: 'registration',
      username: 'myuser',
      password: 'mypass',
      codecs: ['ulaw', 'alaw'],
      dtmfMode: 'rfc2833',
      didNumber: '+15551234567',
    }

    test('creates auth, aor, registration, and endpoint objects', async () => {
      const fetchMock = mockFetch({ ok: true })
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      const result = await provisioner.provisionTrunk(registrationConfig)

      expect(result).toEqual({ success: true })
      expect(fetchMock).toHaveBeenCalledTimes(4)

      // 1. Auth object
      const authBody = parseBridgeBody(fetchMock, 0)
      expect(authBody.configClass).toBe('res_pjsip')
      expect(authBody.objectType).toBe('auth')
      expect(authBody.id).toBe('trunk-voipms')
      expect((authBody.fields as Record<string, string>).auth_type).toBe('userpass')
      expect((authBody.fields as Record<string, string>).username).toBe('myuser')
      expect((authBody.fields as Record<string, string>).password).toBe('mypass')

      // 2. AOR object
      const aorBody = parseBridgeBody(fetchMock, 1)
      expect(aorBody.objectType).toBe('aor')
      expect((aorBody.fields as Record<string, string>).contact).toBe('sip:sip.voip.ms:5060')
      expect((aorBody.fields as Record<string, string>).outbound_auth).toBe('trunk-voipms')

      // 3. Registration object
      const regBody = parseBridgeBody(fetchMock, 2)
      expect(regBody.objectType).toBe('registration')
      expect((regBody.fields as Record<string, string>).server_uri).toBe('sip:sip.voip.ms:5060')
      expect((regBody.fields as Record<string, string>).client_uri).toBe('sip:myuser@sip.voip.ms')
      expect((regBody.fields as Record<string, string>).outbound_auth).toBe('trunk-voipms')

      // 4. Endpoint object
      const endpointBody = parseBridgeBody(fetchMock, 3)
      expect(endpointBody.objectType).toBe('endpoint')
      expect((endpointBody.fields as Record<string, string>).transport).toBe('transport-udp')
      expect((endpointBody.fields as Record<string, string>).allow).toBe('ulaw,alaw')
      expect((endpointBody.fields as Record<string, string>).dtmf_mode).toBe('rfc2833')
      expect((endpointBody.fields as Record<string, string>).from_user).toBe('15551234567')
      expect((endpointBody.fields as Record<string, string>).outbound_auth).toBe('trunk-voipms')
    })

    test('uses authUsername when provided', async () => {
      const fetchMock = mockFetch({ ok: true })
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      await provisioner.provisionTrunk({
        ...registrationConfig,
        authUsername: 'auth-user',
      })

      const authBody = parseBridgeBody(fetchMock, 0)
      expect((authBody.fields as Record<string, string>).username).toBe('auth-user')
    })

    test('uses default port, transport, codecs, and dtmf when not specified', async () => {
      const fetchMock = mockFetch({ ok: true })
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      await provisioner.provisionTrunk({
        trunkId: 'trunk-defaults',
        trunkDomain: 'sip.example.com',
        authType: 'registration',
        username: 'user',
        password: 'pass',
        didNumber: '+15559999999',
      })

      // AOR uses default port 5060
      const aorBody = parseBridgeBody(fetchMock, 1)
      expect((aorBody.fields as Record<string, string>).contact).toBe('sip:sip.example.com:5060')

      // Endpoint uses default transport, codecs, dtmf
      const endpointBody = parseBridgeBody(fetchMock, 3)
      expect((endpointBody.fields as Record<string, string>).transport).toBe('transport-udp')
      expect((endpointBody.fields as Record<string, string>).allow).toBe('!all,ulaw,alaw')
      expect((endpointBody.fields as Record<string, string>).dtmf_mode).toBe('rfc2833')
    })
  })

  // ─── provisionTrunk() with IP-based auth ────────────────────

  describe('provisionTrunk() with IP-based auth', () => {
    const ipConfig: SipTrunkProvisionConfig = {
      trunkId: 'trunk-flowroute',
      trunkDomain: 'us-west-or.sip.flowroute.com',
      trunkPort: 5060,
      transport: 'udp',
      authType: 'ip-based',
      didNumber: '+15557654321',
    }

    test('skips auth and registration objects, creates only aor and endpoint', async () => {
      const fetchMock = mockFetch({ ok: true })
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      const result = await provisioner.provisionTrunk(ipConfig)

      expect(result).toEqual({ success: true })
      // IP-based: only AOR + Endpoint = 2 calls
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // 1. AOR
      const aorBody = parseBridgeBody(fetchMock, 0)
      expect(aorBody.objectType).toBe('aor')
      expect((aorBody.fields as Record<string, string>).outbound_auth).toBeUndefined()

      // 2. Endpoint
      const endpointBody = parseBridgeBody(fetchMock, 1)
      expect(endpointBody.objectType).toBe('endpoint')
      expect((endpointBody.fields as Record<string, string>).outbound_auth).toBeUndefined()
    })
  })

  // ─── provisionTrunk() error handling ─────────────────────────

  describe('provisionTrunk() error handling', () => {
    test('returns error on bridge failure', async () => {
      mockFetchError(500)
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      const result = await provisioner.provisionTrunk({
        trunkId: 'trunk-fail',
        trunkDomain: 'sip.fail.com',
        authType: 'ip-based',
        didNumber: '+15550000000',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  // ─── deprovisionTrunk() ─────────────────────────────────────

  describe('deprovisionTrunk()', () => {
    test('calls delete for each object type in reverse order', async () => {
      const fetchMock = mockFetch({ ok: true })
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      await provisioner.deprovisionTrunk('trunk-voipms')

      expect(fetchMock).toHaveBeenCalledTimes(4)

      const objectTypes = [0, 1, 2, 3].map((i) => {
        const body = parseBridgeBody(fetchMock, i)
        return body.objectType
      })
      expect(objectTypes).toEqual(['endpoint', 'registration', 'aor', 'auth'])

      // All should use /delete-dynamic
      for (let i = 0; i < 4; i++) {
        const [url] = fetchMock.mock.calls[i] as [string, RequestInit]
        expect(url).toBe(`${BRIDGE_URL}/delete-dynamic`)
        const body = parseBridgeBody(fetchMock, i)
        expect(body.id).toBe('trunk-voipms')
        expect(body.configClass).toBe('res_pjsip')
      }
    })

    test('continues on error for missing objects', async () => {
      // Simulate: first call fails (endpoint doesn't exist), rest succeed
      let callCount = 0
      const fn = mock(async () => {
        callCount++
        if (callCount === 1) {
          return new Response('Not Found', { status: 404 })
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      globalThis.fetch = fn as unknown as typeof fetch

      // Should not throw — errors are caught silently
      await expect(
        new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET).deprovisionTrunk('trunk-partial')
      ).resolves.toBeUndefined()
    })
  })

  // ─── testTrunkConnectivity() ─────────────────────────────────

  describe('testTrunkConnectivity()', () => {
    test('returns connected when registered', async () => {
      mockFetch({ registered: true, status: 'Registered' })
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      const result = await provisioner.testTrunkConnectivity('trunk-voipms')

      expect(result).toEqual({ connected: true, status: 'Registered' })
    })

    test('returns disconnected when not registered', async () => {
      mockFetch({ registered: false, status: 'Unregistered' })
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      const result = await provisioner.testTrunkConnectivity('trunk-voipms')

      expect(result).toEqual({ connected: false, status: 'Unregistered' })
    })

    test('returns disconnected on bridge error', async () => {
      mockFetchError(500)
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      const result = await provisioner.testTrunkConnectivity('trunk-unreachable')

      expect(result).toEqual({ connected: false, status: 'Bridge unreachable' })
    })

    test('sends POST to /check-registration with trunk ID', async () => {
      const fetchMock = mockFetch({ registered: true, status: 'Registered' })
      const provisioner = new SipTrunkProvisioner(BRIDGE_URL, BRIDGE_SECRET)

      await provisioner.testTrunkConnectivity('trunk-test')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${BRIDGE_URL}/check-registration`)
      const body = parseBridgeBody(fetchMock, 0)
      expect(body.id).toBe('trunk-test')
    })
  })

  // ─── SIP_TRUNK_PRESETS ──────────────────────────────────────

  describe('SIP_TRUNK_PRESETS', () => {
    test('has expected provider entries', () => {
      const expectedProviders = [
        'voip.ms',
        'flowroute',
        'sipgate',
        'callcentric',
        'twilio-sip',
        'telnyx-sip',
      ]
      for (const provider of expectedProviders) {
        expect(SIP_TRUNK_PRESETS[provider]).toBeDefined()
      }
    })

    test('all presets have required fields', () => {
      for (const [_name, preset] of Object.entries(SIP_TRUNK_PRESETS)) {
        expect(preset.domain).toBeTruthy()
        expect(preset.authType).toMatch(/^(registration|ip-based)$/)
        expect(preset.notes).toBeTruthy()
      }
    })

    test('flowroute uses ip-based auth', () => {
      expect(SIP_TRUNK_PRESETS.flowroute.authType).toBe('ip-based')
    })

    test('voip.ms uses registration auth', () => {
      expect(SIP_TRUNK_PRESETS['voip.ms'].authType).toBe('registration')
    })

    test('sipgate uses TLS transport', () => {
      expect(SIP_TRUNK_PRESETS.sipgate.transport).toBe('tls')
    })
  })
})
