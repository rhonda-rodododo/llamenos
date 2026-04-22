import type {
  AsteriskConfig,
  FreeSwitchConfig,
  PlivoConfig,
  SignalWireConfig,
  TelnyxConfig,
  TwilioConfig,
  VonageConfig,
} from '../../shared/schemas/providers'
import type { TelephonyProviderConfig, TelephonyProviderType } from '../../shared/types'

/**
 * Generate a WebRTC access token for the given provider and identity.
 * Each provider has a different token format:
 * - Twilio/SignalWire: JWT with Voice grant
 * - Vonage: JWT with sub claim
 * - Plivo: JWT with voice endpoint
 */
export async function generateWebRtcToken(
  config: TelephonyProviderConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  switch (config.type) {
    case 'twilio':
      return generateTwilioToken(config, identity)
    case 'signalwire':
      return generateSignalWireToken(config, identity)
    case 'vonage':
      return generateVonageToken(config, identity)
    case 'plivo':
      return generatePlivoToken(config, identity)
    case 'asterisk':
      return generateAsteriskToken(config, identity)
    case 'telnyx':
      return generateTelnyxToken(config, identity)
    case 'bandwidth':
      throw new Error('Bandwidth WebRTC not yet implemented')
    case 'freeswitch':
      return generateFreeSwitchToken(config, identity)
    default: {
      const _exhaustive: never = config
      throw new Error(
        `WebRTC not supported for provider: ${(_exhaustive as TelephonyProviderConfig).type}`
      )
    }
  }
}

/**
 * Check whether a provider config has WebRTC properly configured.
 */
export function isWebRtcConfigured(config: TelephonyProviderConfig | null): boolean {
  if (!config) return false
  switch (config.type) {
    case 'twilio':
      return !!(
        config.webrtcEnabled &&
        config.apiKeySid &&
        config.apiKeySecret &&
        config.twimlAppSid
      )
    case 'signalwire':
      return !!(
        config.webrtcEnabled &&
        config.apiKeySid &&
        config.apiKeySecret &&
        config.twimlAppSid
      )
    case 'vonage':
      return !!(config.applicationId && config.privateKey)
    case 'plivo':
      return !!(config.authId && config.authToken)
    case 'telnyx':
      return !!(config.webrtcEnabled && config.apiKey && config.sipConnectionId)
    case 'asterisk':
      return !!(config.ariUrl && config.bridgeCallbackUrl)
    case 'freeswitch':
      return !!(config.eslUrl && config.bridgeCallbackUrl && config.vertoWssPort)
    default:
      return false
  }
}

// --- Twilio/SignalWire JWT ---
// Twilio Access Tokens use a HS256 JWT with Voice grant

async function generateTwilioToken(
  config: TwilioConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  if (!config.apiKeySid || !config.apiKeySecret || !config.twimlAppSid) {
    throw new Error(
      'Missing Twilio WebRTC config: apiKeySid, apiKeySecret, twimlAppSid, accountSid'
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' }
  const payload = {
    jti: `${config.apiKeySid}-${now}`,
    iss: config.apiKeySid,
    sub: config.accountSid,
    iat: now,
    exp: now + 3600, // 1 hour
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: config.twimlAppSid },
      },
    },
  }

  const token = await signJwtHs256(header, payload, config.apiKeySecret)
  return { token, provider: config.type, ttl: 3600 }
}

// --- SignalWire JWT ---
// SignalWire uses Twilio-compatible access tokens (HS256 with Voice grant).
// The only difference is the project ID is used as the accountSid/sub claim.

async function generateSignalWireToken(
  config: SignalWireConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  if (!config.apiKeySid || !config.apiKeySecret || !config.twimlAppSid) {
    throw new Error('Missing SignalWire WebRTC config: apiKeySid, apiKeySecret, twimlAppSid')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' }
  const payload = {
    jti: `${config.apiKeySid}-${now}`,
    iss: config.apiKeySid,
    sub: config.accountSid,
    iat: now,
    exp: now + 3600,
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: config.twimlAppSid },
      },
    },
  }

  const token = await signJwtHs256(header, payload, config.apiKeySecret)
  return { token, provider: 'signalwire', ttl: 3600 }
}

// --- Vonage JWT ---
// Vonage uses RS256 JWT with application_id and sub claims

async function generateVonageToken(
  config: VonageConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  if (!config.privateKey) {
    throw new Error('Missing Vonage WebRTC config: privateKey')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'RS256' }
  const payload = {
    iat: now,
    exp: now + 3600,
    jti: crypto.randomUUID(),
    application_id: config.applicationId,
    sub: identity,
    acl: {
      paths: {
        '/*/users/**': {},
        '/*/conversations/**': {},
        '/*/sessions/**': {},
        '/*/devices/**': {},
        '/*/image/**': {},
        '/*/media/**': {},
        '/*/knocking/**': {},
        '/*/legs/**': {},
      },
    },
  }

  const token = await signJwtRs256(header, payload, config.privateKey)
  return { token, provider: 'vonage', ttl: 3600 }
}

// --- Plivo JWT ---
// Plivo browser SDK uses an Access Token JWT signed with the auth token secret.
// The SDK parses the JWT to extract per.voice grants and derives the SIP username
// as `${sub}_${iss}` where iss = authId and sub = endpoint identity.

async function generatePlivoToken(
  config: PlivoConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'HS256' }
  const payload = {
    iss: config.authId,
    sub: identity,
    nbf: now,
    exp: now + 3600,
    per: {
      voice: {
        incoming_allow: true,
        outgoing_allow: false,
      },
    },
  }
  const token = await signJwtHs256(header, payload, config.authToken)
  return { token, provider: 'plivo', ttl: 3600 }
}

// --- Telnyx WebRTC login token ---
// Telnyx WebRTC uses an on-demand Telephony Credential bound to a SIP Connection.
// We create a fresh credential per request and mint a short-lived login_token
// (JWT, returned as plain text) which the @telnyx/webrtc SDK passes as
// `new TelnyxRTC({ login_token })`. Credentials are server-managed on Telnyx's
// side — the SIP user/password never leaves their infrastructure.

async function generateTelnyxToken(
  config: TelnyxConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  if (!config.apiKey || !config.sipConnectionId) {
    throw new Error('Missing Telnyx WebRTC config: apiKey, sipConnectionId')
  }

  const base =
    ((config as Record<string, unknown>)._testBaseUrl as string | undefined) ??
    'https://api.telnyx.com'
  const auth = `Bearer ${config.apiKey}`

  const createRes = await fetch(`${base}/v2/telephony_credentials`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      connection_id: config.sipConnectionId,
      name: `llamenos-${identity}-${Math.floor(Date.now() / 1000)}`,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!createRes.ok) {
    throw new Error(`Telnyx create telephony_credential failed: HTTP ${createRes.status}`)
  }
  const createData = (await createRes.json()) as { data?: { id?: string } }
  const credId = createData.data?.id
  if (!credId) {
    throw new Error('Telnyx create telephony_credential: response missing data.id')
  }

  const tokenRes = await fetch(`${base}/v2/telephony_credentials/${credId}/token`, {
    method: 'POST',
    headers: { Authorization: auth, Accept: 'text/plain' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!tokenRes.ok) {
    throw new Error(`Telnyx telephony_credential token fetch failed: HTTP ${tokenRes.status}`)
  }
  const token = (await tokenRes.text()).trim()
  if (!token) {
    throw new Error('Telnyx telephony_credential token fetch returned empty body')
  }

  return { token, provider: 'telnyx', ttl: 3600 }
}

// --- Asterisk SIP/WebRTC token ---
// Asterisk uses JsSIP/SIP.js with direct SIP credentials. The "token" is a base64-encoded
// JSON blob containing SIP URI, password, WebSocket URI, and ICE servers.

async function generateAsteriskToken(
  config: AsteriskConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  const { AsteriskProvisioner } = await import('./asterisk-provisioner')
  const provisioner = new AsteriskProvisioner(
    config.bridgeCallbackUrl!,
    config.bridgeSecret!,
    config.asteriskDomain ?? 'localhost',
    config.wssPort ?? 8089,
    config.stunServer ?? 'stun:stun.l.google.com:19302',
    config.turnServer,
    config.turnSecret
  )
  const endpoint = await provisioner.provisionEndpoint(identity)
  const token = btoa(
    JSON.stringify({
      wsUri: endpoint.wsUri,
      sipUri: endpoint.sipUri,
      password: endpoint.password,
      iceServers: endpoint.iceServers,
    })
  )
  return { token, provider: 'asterisk', ttl: 600 }
}

// --- FreeSWITCH Verto WebRTC token ---
// FreeSWITCH uses Verto protocol for WebRTC. The "token" is a base64-encoded
// JSON blob containing Verto WSS URI, login/password, and ICE servers.

async function generateFreeSwitchToken(
  config: FreeSwitchConfig,
  identity: string
): Promise<{ token: string; provider: TelephonyProviderType; ttl: number }> {
  const domain = config.freeswitchDomain ?? 'localhost'
  const wssPort = config.vertoWssPort ?? 8082
  const wsUri = `wss://${domain}:${wssPort}`
  const sipUri = `sip:${identity}@${domain}`

  const iceServers: Array<{ urls: string; username?: string; credential?: string }> = []
  if (config.stunServer) {
    iceServers.push({ urls: config.stunServer })
  }
  if (config.turnServer && config.turnSecret) {
    // Time-limited TURN credentials (same pattern as Asterisk/coturn)
    const ttl = 86400
    const expiry = Math.floor(Date.now() / 1000) + ttl
    const username = `${expiry}:${identity}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(config.turnSecret) as Uint8Array<ArrayBuffer>,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(username) as Uint8Array<ArrayBuffer>
    )
    const credential = btoa(String.fromCharCode(...new Uint8Array(sig)))
    iceServers.push({ urls: config.turnServer, username, credential })
  }

  const token = btoa(
    JSON.stringify({
      wsUri,
      sipUri,
      login: `${identity}@${domain}`,
      password: config.eslPassword, // Verto login password
      iceServers,
    })
  )
  return { token, provider: 'freeswitch', ttl: 600 }
}

// --- Crypto helpers ---

/** @knipignore — base64url encoding utility; exported for use by WebRTC token tests */
export function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** @knipignore — base64url bytes encoding utility; exported for use by WebRTC token tests */
export function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signJwtHs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const data = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data) as Uint8Array<ArrayBuffer>
  )
  const sigB64 = base64urlEncodeBytes(new Uint8Array(sig))
  return `${data}.${sigB64}`
}

export async function signJwtRs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKeyPem: string
): Promise<string> {
  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const data = `${headerB64}.${payloadB64}`

  // Parse PEM private key
  const pemBody = privateKeyPem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(data) as Uint8Array<ArrayBuffer>
  )
  const sigB64 = base64urlEncodeBytes(new Uint8Array(sig))
  return `${data}.${sigB64}`
}
