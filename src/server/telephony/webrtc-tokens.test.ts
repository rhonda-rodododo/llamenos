import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type {
  AsteriskConfig,
  PlivoConfig,
  SignalWireConfig,
  TelephonyProviderConfig,
  TelnyxConfig,
  TwilioConfig,
  VonageConfig,
} from '../../shared/schemas/providers'
import { generateWebRtcToken, isWebRtcConfigured } from './webrtc-tokens'

// ── Helpers ──

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error(`Expected 3 JWT parts, got ${parts.length}`)
  // base64url → base64 → decode
  const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return JSON.parse(atob(padded))
}

function decodeJwtHeader(token: string): Record<string, unknown> {
  const parts = token.split('.')
  const b64 = parts[0]!.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return JSON.parse(atob(padded))
}

// ── Test fixtures ──

const twilioConfig: TwilioConfig = {
  type: 'twilio',
  phoneNumber: '+15551234567',
  accountSid: 'AC00000000000000000000000000000000',
  authToken: 'a'.repeat(32),
  webrtcEnabled: true,
  apiKeySid: 'SK00000000000000000000000000000000',
  apiKeySecret: 'test-api-key-secret-value-here-xx',
  twimlAppSid: 'AP00000000000000000000000000000000',
}

const signalwireConfig: SignalWireConfig = {
  type: 'signalwire',
  phoneNumber: '+15559876543',
  accountSid: 'sw-project-id-12345',
  authToken: 'x'.repeat(32),
  signalwireSpace: 'myspace',
  webrtcEnabled: true,
  apiKeySid: 'SW00000000000000000000000000000000',
  apiKeySecret: 'sw-api-key-secret-value-here-xxxx',
  twimlAppSid: 'SWAP0000000000000000000000000000',
}

const plivoConfig: PlivoConfig = {
  type: 'plivo',
  phoneNumber: '+15551112222',
  authId: 'PLIVO_AUTH_ID_TEST',
  authToken: 'plivo-auth-token-secret-value-test',
}

const vonageConfig: VonageConfig = {
  type: 'vonage',
  phoneNumber: '+15553334444',
  apiKey: 'vonage-api-key',
  apiSecret: 'vonage-api-secret',
  applicationId: '550e8400-e29b-41d4-a716-446655440000',
  privateKey: undefined,
}

const identity = 'user-abc-123'

// ── generateWebRtcToken: Twilio ──

describe('generateWebRtcToken — Twilio', () => {
  test('produces a valid JWT with Voice grant', async () => {
    const result = await generateWebRtcToken(twilioConfig, identity)

    expect(result.provider).toBe('twilio')
    expect(result.ttl).toBe(3600)
    expect(result.token).toContain('.')

    const header = decodeJwtHeader(result.token)
    expect(header.alg).toBe('HS256')
    expect(header.cty).toBe('twilio-fpa;v=1')
    expect(header.typ).toBe('JWT')

    const payload = decodeJwtPayload(result.token)
    expect(payload.iss).toBe(twilioConfig.apiKeySid)
    expect(payload.sub).toBe(twilioConfig.accountSid)
    expect(payload.jti).toStartWith(`${twilioConfig.apiKeySid}-`)
    expect(typeof payload.iat).toBe('number')
    expect(typeof payload.exp).toBe('number')
    expect((payload.exp as number) - (payload.iat as number)).toBe(3600)

    const grants = payload.grants as Record<string, unknown>
    expect(grants.identity).toBe(identity)
    const voice = grants.voice as Record<string, unknown>
    expect((voice.incoming as Record<string, unknown>).allow).toBe(true)
    expect((voice.outgoing as Record<string, unknown>).application_sid).toBe(
      twilioConfig.twimlAppSid
    )
  })

  test('throws when apiKeySid is missing', async () => {
    const config: TwilioConfig = { ...twilioConfig, apiKeySid: undefined }
    await expect(generateWebRtcToken(config, identity)).rejects.toThrow('Missing Twilio WebRTC')
  })

  test('throws when apiKeySecret is missing', async () => {
    const config: TwilioConfig = { ...twilioConfig, apiKeySecret: undefined }
    await expect(generateWebRtcToken(config, identity)).rejects.toThrow('Missing Twilio WebRTC')
  })

  test('throws when twimlAppSid is missing', async () => {
    const config: TwilioConfig = { ...twilioConfig, twimlAppSid: undefined }
    await expect(generateWebRtcToken(config, identity)).rejects.toThrow('Missing Twilio WebRTC')
  })
})

// ── generateWebRtcToken: SignalWire ──

describe('generateWebRtcToken — SignalWire', () => {
  test('produces a valid JWT in Twilio-compatible format', async () => {
    const result = await generateWebRtcToken(signalwireConfig, identity)

    expect(result.provider).toBe('signalwire')
    expect(result.ttl).toBe(3600)

    const header = decodeJwtHeader(result.token)
    expect(header.alg).toBe('HS256')
    expect(header.cty).toBe('twilio-fpa;v=1')

    const payload = decodeJwtPayload(result.token)
    expect(payload.iss).toBe(signalwireConfig.apiKeySid)
    expect(payload.sub).toBe(signalwireConfig.accountSid)
    expect((payload.exp as number) - (payload.iat as number)).toBe(3600)

    const grants = payload.grants as Record<string, unknown>
    expect(grants.identity).toBe(identity)
    const voice = grants.voice as Record<string, unknown>
    expect((voice.incoming as Record<string, unknown>).allow).toBe(true)
    expect((voice.outgoing as Record<string, unknown>).application_sid).toBe(
      signalwireConfig.twimlAppSid
    )
  })

  test('throws when apiKeySid is missing', async () => {
    const config: SignalWireConfig = { ...signalwireConfig, apiKeySid: undefined }
    await expect(generateWebRtcToken(config, identity)).rejects.toThrow('Missing SignalWire WebRTC')
  })

  test('throws when apiKeySecret is missing', async () => {
    const config: SignalWireConfig = { ...signalwireConfig, apiKeySecret: undefined }
    await expect(generateWebRtcToken(config, identity)).rejects.toThrow('Missing SignalWire WebRTC')
  })

  test('throws when twimlAppSid is missing', async () => {
    const config: SignalWireConfig = { ...signalwireConfig, twimlAppSid: undefined }
    await expect(generateWebRtcToken(config, identity)).rejects.toThrow('Missing SignalWire WebRTC')
  })
})

// ── generateWebRtcToken: Plivo ──

describe('generateWebRtcToken — Plivo', () => {
  test('produces JWT with per.voice grants', async () => {
    const result = await generateWebRtcToken(plivoConfig, identity)

    expect(result.provider).toBe('plivo')
    expect(result.ttl).toBe(3600)

    const header = decodeJwtHeader(result.token)
    expect(header.alg).toBe('HS256')
    expect(header.typ).toBe('JWT')

    const payload = decodeJwtPayload(result.token)
    expect(payload.iss).toBe(plivoConfig.authId)
    expect(payload.sub).toBe(identity)
    expect(typeof payload.nbf).toBe('number')
    expect((payload.exp as number) - (payload.nbf as number)).toBe(3600)

    const per = payload.per as Record<string, unknown>
    const voice = per.voice as Record<string, unknown>
    expect(voice.incoming_allow).toBe(true)
    expect(voice.outgoing_allow).toBe(false)
  })
})

// ── generateWebRtcToken: Vonage ──

describe('generateWebRtcToken — Vonage', () => {
  test('throws when privateKey is missing', async () => {
    await expect(generateWebRtcToken(vonageConfig, identity)).rejects.toThrow(
      'Missing Vonage WebRTC'
    )
  })
})

// ── generateWebRtcToken: Telnyx ──

type FetchCall = { url: string; init?: RequestInit }

/**
 * Install a scoped fetch stub for the duration of a test.
 * Returns the captured call list so assertions can inspect URLs + headers + bodies.
 */
function installFetchStub(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    calls.push({ url, init })
    return Promise.resolve(handler(url, init))
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

// `_testBaseUrl` is a convention used by the server-side Telnyx adapter (see
// telnyx-capabilities.ts) to let tests redirect Telnyx API calls. It is read
// via a Record<string, unknown> cast at runtime, so we only need to attach it
// to the object — the TelnyxConfig type itself doesn't know about it.
const telnyxConfig: TelnyxConfig = {
  type: 'telnyx',
  phoneNumber: '+15550000000',
  apiKey: 'telnyx-api-key-test',
  sipConnectionId: '1234567890',
  webrtcEnabled: true,
}
;(telnyxConfig as unknown as Record<string, unknown>)._testBaseUrl = 'https://telnyx.test'

describe('generateWebRtcToken — Telnyx', () => {
  let stub: { calls: FetchCall[]; restore: () => void }

  afterEach(() => {
    stub?.restore()
  })

  test('creates telephony credential then mints login token', async () => {
    stub = installFetchStub((url) => {
      if (url === 'https://telnyx.test/v2/telephony_credentials') {
        return new Response(JSON.stringify({ data: { id: 'cred-abc-123' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === 'https://telnyx.test/v2/telephony_credentials/cred-abc-123/token') {
        return new Response('eyJhbGciOi.telnyx.jwt-body\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
      return new Response('unexpected', { status: 500 })
    })

    const result = await generateWebRtcToken(telnyxConfig, identity)

    expect(result.provider).toBe('telnyx')
    expect(result.ttl).toBe(3600)
    expect(result.token).toBe('eyJhbGciOi.telnyx.jwt-body')

    expect(stub.calls).toHaveLength(2)
    const [create, token] = stub.calls
    expect(create!.url).toBe('https://telnyx.test/v2/telephony_credentials')
    expect(create!.init?.method).toBe('POST')
    const createAuth = new Headers(create!.init?.headers).get('Authorization')
    expect(createAuth).toBe(`Bearer ${telnyxConfig.apiKey}`)
    const body = JSON.parse(String(create!.init?.body)) as {
      connection_id: string
      name: string
    }
    expect(body.connection_id).toBe('1234567890')
    expect(body.name).toContain(identity)

    expect(token!.url).toBe('https://telnyx.test/v2/telephony_credentials/cred-abc-123/token')
    expect(token!.init?.method).toBe('POST')
    const tokenAuth = new Headers(token!.init?.headers).get('Authorization')
    expect(tokenAuth).toBe(`Bearer ${telnyxConfig.apiKey}`)
  })

  test('throws when apiKey is missing', async () => {
    const config: TelnyxConfig = { ...telnyxConfig, apiKey: '' as string }
    await expect(generateWebRtcToken(config, identity)).rejects.toThrow(
      'Missing Telnyx WebRTC config'
    )
  })

  test('throws when sipConnectionId is missing', async () => {
    const config: TelnyxConfig = { ...telnyxConfig, sipConnectionId: undefined }
    await expect(generateWebRtcToken(config, identity)).rejects.toThrow(
      'Missing Telnyx WebRTC config'
    )
  })

  test('throws when create credential returns non-2xx', async () => {
    stub = installFetchStub(() => new Response('unauthorized', { status: 401 }))
    await expect(generateWebRtcToken(telnyxConfig, identity)).rejects.toThrow(
      'Telnyx create telephony_credential failed: HTTP 401'
    )
  })

  test('throws when create credential response has no id', async () => {
    stub = installFetchStub(
      () =>
        new Response(JSON.stringify({ data: {} }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    await expect(generateWebRtcToken(telnyxConfig, identity)).rejects.toThrow(
      'response missing data.id'
    )
  })

  test('throws when token endpoint returns non-2xx', async () => {
    stub = installFetchStub((url) => {
      if (url.endsWith('/telephony_credentials')) {
        return new Response(JSON.stringify({ data: { id: 'cred-xyz' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('boom', { status: 500 })
    })
    await expect(generateWebRtcToken(telnyxConfig, identity)).rejects.toThrow(
      'Telnyx telephony_credential token fetch failed: HTTP 500'
    )
  })

  test('throws when token endpoint returns empty body', async () => {
    stub = installFetchStub((url) => {
      if (url.endsWith('/telephony_credentials')) {
        return new Response(JSON.stringify({ data: { id: 'cred-xyz' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('   \n  ', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    })
    await expect(generateWebRtcToken(telnyxConfig, identity)).rejects.toThrow('returned empty body')
  })
})

// ── isWebRtcConfigured ──

describe('isWebRtcConfigured', () => {
  test('returns false for null config', () => {
    expect(isWebRtcConfigured(null)).toBe(false)
  })

  // Twilio
  test('returns true for fully configured Twilio', () => {
    expect(isWebRtcConfigured(twilioConfig)).toBe(true)
  })

  test('returns false for Twilio missing webrtcEnabled', () => {
    expect(isWebRtcConfigured({ ...twilioConfig, webrtcEnabled: false })).toBe(false)
  })

  test('returns false for Twilio missing apiKeySid', () => {
    expect(isWebRtcConfigured({ ...twilioConfig, apiKeySid: undefined })).toBe(false)
  })

  test('returns false for Twilio missing apiKeySecret', () => {
    expect(isWebRtcConfigured({ ...twilioConfig, apiKeySecret: undefined })).toBe(false)
  })

  test('returns false for Twilio missing twimlAppSid', () => {
    expect(isWebRtcConfigured({ ...twilioConfig, twimlAppSid: undefined })).toBe(false)
  })

  // SignalWire
  test('returns true for fully configured SignalWire', () => {
    expect(isWebRtcConfigured(signalwireConfig)).toBe(true)
  })

  test('returns false for SignalWire missing webrtcEnabled', () => {
    expect(isWebRtcConfigured({ ...signalwireConfig, webrtcEnabled: false })).toBe(false)
  })

  test('returns false for SignalWire missing apiKeySid', () => {
    expect(isWebRtcConfigured({ ...signalwireConfig, apiKeySid: undefined })).toBe(false)
  })

  // Vonage
  test('returns true for Vonage with applicationId and privateKey', () => {
    expect(isWebRtcConfigured({ ...vonageConfig, privateKey: 'some-key' })).toBe(true)
  })

  test('returns false for Vonage missing privateKey', () => {
    expect(isWebRtcConfigured(vonageConfig)).toBe(false)
  })

  // Plivo
  test('returns true for Plivo with authId and authToken', () => {
    expect(isWebRtcConfigured(plivoConfig)).toBe(true)
  })

  test('returns false for Plivo with empty authId', () => {
    // Use type assertion since schema requires min(1) but runtime check uses !!
    const config = { ...plivoConfig, authId: '' } as unknown as TelephonyProviderConfig
    expect(isWebRtcConfigured(config)).toBe(false)
  })

  // Telnyx
  test('returns true for fully configured Telnyx', () => {
    expect(isWebRtcConfigured(telnyxConfig)).toBe(true)
  })

  test('returns false for Telnyx missing webrtcEnabled', () => {
    expect(isWebRtcConfigured({ ...telnyxConfig, webrtcEnabled: false })).toBe(false)
  })

  test('returns false for Telnyx missing sipConnectionId', () => {
    expect(isWebRtcConfigured({ ...telnyxConfig, sipConnectionId: undefined })).toBe(false)
  })

  test('returns false for Telnyx with empty apiKey', () => {
    const config = { ...telnyxConfig, apiKey: '' } as unknown as TelephonyProviderConfig
    expect(isWebRtcConfigured(config)).toBe(false)
  })

  // Asterisk
  test('returns true for Asterisk with ariUrl and bridgeCallbackUrl', () => {
    const config: AsteriskConfig = {
      type: 'asterisk',
      phoneNumber: '+15550001111',
      ariUrl: 'http://localhost:8088/ari',
      ariUsername: 'admin',
      ariPassword: 'secret',
      bridgeCallbackUrl: 'http://localhost:3000/telephony/asterisk/bridge',
    }
    expect(isWebRtcConfigured(config)).toBe(true)
  })

  test('returns false for Asterisk missing bridgeCallbackUrl', () => {
    const config: AsteriskConfig = {
      type: 'asterisk',
      phoneNumber: '+15550001111',
      ariUrl: 'http://localhost:8088/ari',
      ariUsername: 'admin',
      ariPassword: 'secret',
    }
    expect(isWebRtcConfigured(config)).toBe(false)
  })

  test('returns false for Asterisk missing ariUrl', () => {
    // ariUrl is required by schema, but test the runtime !! check
    const config = {
      type: 'asterisk' as const,
      phoneNumber: '+15550001111',
      ariUrl: '',
      ariUsername: 'admin',
      ariPassword: 'secret',
      bridgeCallbackUrl: 'http://localhost:3000/telephony/asterisk/bridge',
    } as unknown as TelephonyProviderConfig
    expect(isWebRtcConfigured(config)).toBe(false)
  })
})

// ── Token TTL ──

describe('Token TTL', () => {
  test('Twilio token has 3600s TTL', async () => {
    const result = await generateWebRtcToken(twilioConfig, identity)
    expect(result.ttl).toBe(3600)
    const payload = decodeJwtPayload(result.token)
    expect((payload.exp as number) - (payload.iat as number)).toBe(3600)
  })

  test('SignalWire token has 3600s TTL', async () => {
    const result = await generateWebRtcToken(signalwireConfig, identity)
    expect(result.ttl).toBe(3600)
    const payload = decodeJwtPayload(result.token)
    expect((payload.exp as number) - (payload.iat as number)).toBe(3600)
  })

  test('Plivo token has 3600s TTL', async () => {
    const result = await generateWebRtcToken(plivoConfig, identity)
    expect(result.ttl).toBe(3600)
    const payload = decodeJwtPayload(result.token)
    expect((payload.exp as number) - (payload.nbf as number)).toBe(3600)
  })
})
