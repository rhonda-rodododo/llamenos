import { createRoute, z } from '@hono/zod-openapi'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { LABEL_SESSION_META } from '../../shared/crypto-labels'
import { resolvePermissions } from '../../shared/permissions'
import {
  DemoLoginSchema,
  InviteAcceptSchema,
  WebAuthnLoginVerifySchema,
  WebAuthnRegisterVerifySchema,
} from '../../shared/schemas/auth'
import { AuthEventListQuerySchema } from '../../shared/schemas/auth-events'
import { EnrollRequestSchema } from '../../shared/schemas/enroll'
import { KekProofSchema } from '../../shared/schemas/kek-proof'
import { LockdownRequestSchema } from '../../shared/schemas/lockdown'
import { PasskeyRenameSchema } from '../../shared/schemas/passkeys'
import { PinChangeSchema } from '../../shared/schemas/pin-change'
import { RecoveryRotateSchema } from '../../shared/schemas/recovery-rotate'
import { UpdateSecurityPrefsSchema } from '../../shared/schemas/security-prefs'
import { SignalContactRegisterSchema } from '../../shared/schemas/signal-contact'
import type { IdPAdapter } from '../idp/adapter'
import {
  clearRefreshCookieOptions,
  clearSessionIdCookieOptions,
  refreshCookieOptions,
  sessionIdCookieOptions,
} from '../lib/cookies'
import type { CryptoService } from '../lib/crypto-service'
import { hashIP } from '../lib/crypto-service'
import { lookupIp } from '../lib/geoip'
import { uint8ArrayToBase64URL } from '../lib/helpers'
import { signAccessToken, verifyAccessToken } from '../lib/jwt'
import { createRouter } from '../lib/openapi'
import { generateSessionToken, hashSessionToken } from '../lib/session-tokens'
import {
  generateAuthOptions,
  generateRegOptions,
  verifyAuthResponse,
  verifyRegResponse,
} from '../lib/webauthn'
import type { AuthEventsService } from '../services/auth-events'
import { IdentityService } from '../services/identity'
import type { RecordsService } from '../services/records'
import type { SecurityActionsService } from '../services/security-actions'
import type { SecurityPrefsService } from '../services/security-prefs'
import type { SessionService } from '../services/sessions'
import { formatUserAgent, sessionExpiry } from '../services/sessions'
import type { SettingsService } from '../services/settings'
import type { SignalContactsService } from '../services/signal-contacts'
import type { UserNotificationsService } from '../services/user-notifications'

const GEOIP_DB_PATH = process.env.GEOIP_DB_PATH ?? './data/geoip/dbip-city.mmdb'
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

import type { Ciphertext } from '../../shared/crypto-types'
import type { RecipientEnvelope } from '../../shared/types'
import { createLogger } from '../lib/logger'
import type { WebAuthnCredential } from '../types'

const log = createLogger('routes.auth-facade')

// ---------------------------------------------------------------------------
// Type bindings for Hono context
// ---------------------------------------------------------------------------

interface AuthFacadeEnv {
  Bindings: {
    HMAC_SECRET: string
    JWT_SECRET: string
    HOTLINE_NAME: string
    AUTH_WEBAUTHN_RP_ID: string
    AUTH_WEBAUTHN_RP_NAME: string
    AUTH_WEBAUTHN_ORIGIN: string
    DEMO_MODE?: string
  }
  Variables: {
    identity: IdentityService
    idpAdapter: IdPAdapter
    settings: SettingsService
    sessions: SessionService
    authEvents: AuthEventsService
    records: RecordsService
    crypto: CryptoService
    signalContacts: SignalContactsService
    securityPrefs: SecurityPrefsService
    securityActions: SecurityActionsService
    userNotifications: UserNotificationsService
    /** Set by jwtAuth middleware on authenticated routes */
    pubkey: string
    /** Set by jwtAuth middleware — permissions from the access token */
    permissions: string[]
  }
}

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter (per-IP, sliding window)
// ---------------------------------------------------------------------------

const rateLimitStore = new Map<string, { count: number; expiresAt: number }>()

const LIMIT_PIN_CHANGE_PER_HOUR = 5
const LIMIT_RECOVERY_ROTATE_PER_DAY = 3
const LIMIT_LOCKDOWN_PER_15MIN = 3

function isRateLimited(key: string, maxPerWindow: number, windowMs = 5 * 60 * 1000): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(key)
  if (!entry || entry.expiresAt < now) {
    rateLimitStore.set(key, { count: 1, expiresAt: now + windowMs })
    return false
  }
  entry.count++
  return entry.count > maxPerWindow
}

// Periodic cleanup (prevent unbounded growth)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (entry.expiresAt < now) rateLimitStore.delete(key)
  }
}, 60_000).unref?.()

// ---------------------------------------------------------------------------
// JWT-based auth middleware for protected routes
// ---------------------------------------------------------------------------

const jwtAuth = createMiddleware<AuthFacadeEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const token = header.slice(7)
  let payload: Awaited<ReturnType<typeof verifyAccessToken>>
  try {
    payload = await verifyAccessToken(token, c.env.JWT_SECRET)
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
  c.set('pubkey', payload.sub)
  c.set('permissions', payload.permissions ?? [])
  await next()
})

// ---------------------------------------------------------------------------
// Helper: resolve permissions for a user
// ---------------------------------------------------------------------------

async function resolveUserPermissions(
  pubkey: string,
  identity: IdentityService,
  settings: SettingsService
): Promise<string[]> {
  const user = await identity.getUser(pubkey)
  if (!user?.active) return []
  const allRoles = await settings.listRoles()
  return resolvePermissions(user.roles, allRoles)
}

// ---------------------------------------------------------------------------
// Helper: create a new opaque-token session and set refresh + session cookies.
// Returns the session id + opaque token.
// Used by login-verify, invite-accept, and dev bootstrap.
// ---------------------------------------------------------------------------

/** @knipignore — session creation params interface; used by internal route handlers and tests */
export interface CreateSessionParams {
  pubkey: string
  credentialId: string | null
  clientIp: string
  userAgent: string
  ipHash: string
  hmacSecret: string
  sessions: SessionService
  crypto: CryptoService
  geoipDbPath?: string
}

export async function createUserSession(
  params: CreateSessionParams
): Promise<{ sessionId: string; token: string }> {
  const geo = await lookupIp(params.clientIp, params.geoipDbPath ?? GEOIP_DB_PATH)

  const metaPlain = JSON.stringify({
    ip: params.clientIp,
    userAgent: params.userAgent,
    city: geo.city,
    region: geo.region,
    country: geo.country,
    lat: geo.lat,
    lon: geo.lon,
  })
  const { encrypted, envelopes } = await params.crypto.envelopeEncrypt(
    metaPlain,
    [params.pubkey],
    LABEL_SESSION_META
  )

  const token = generateSessionToken()
  const tokenHash = hashSessionToken(token, params.hmacSecret)
  const sessionId = crypto.randomUUID()

  await params.sessions.create({
    id: sessionId,
    userPubkey: params.pubkey,
    tokenHash,
    ipHash: params.ipHash,
    credentialId: params.credentialId,
    encryptedMeta: encrypted,
    metaEnvelope: envelopes,
    expiresAt: sessionExpiry(),
  })

  return { sessionId, token }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const authFacade = createRouter<AuthFacadeEnv>()

// ===== Public routes (no auth) =====

const webauthnLoginOptionsRoute = createRoute({
  method: 'post',
  path: '/webauthn/login-options',
  tags: ['Auth'],
  summary: 'Get WebAuthn login options',
  responses: {
    200: {
      description: 'WebAuthn options',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(webauthnLoginOptionsRoute, async (c) => {
  const identity = c.get('identity')

  // Rate limit
  const clientIp =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('CF-Connecting-IP') ||
    'unknown'
  const ipHash = hashIP(clientIp, c.env.HMAC_SECRET)
  if (isRateLimited(`auth-login-opts:${ipHash}`, 10)) {
    return c.json({ error: 'Too many requests. Try again later.' }, 429)
  }

  const rpID = c.env.AUTH_WEBAUTHN_RP_ID
  const credentials = await identity.getAllWebAuthnCredentials()
  const options = await generateAuthOptions(credentials, rpID)
  const challengeId = crypto.randomUUID()
  await identity.storeWebAuthnChallenge({ id: challengeId, challenge: options.challenge })
  return c.json({ ...options, challengeId }, 200)
})

const webauthnLoginVerifyRoute = createRoute({
  method: 'post',
  path: '/webauthn/login-verify',
  tags: ['Auth'],
  summary: 'Verify WebAuthn login assertion',
  request: {
    body: { content: { 'application/json': { schema: WebAuthnLoginVerifySchema } } },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: {
        'application/json': { schema: z.object({ accessToken: z.string(), pubkey: z.string() }) },
      },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    401: {
      description: 'Verification failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(webauthnLoginVerifyRoute, async (c) => {
  const identity = c.get('identity')

  // Rate limit
  const clientIp =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('CF-Connecting-IP') ||
    'unknown'
  const ipHash = hashIP(clientIp, c.env.HMAC_SECRET)
  if (isRateLimited(`auth-login-verify:${ipHash}`, 10)) {
    return c.json({ error: 'Too many requests. Try again later.' }, 429)
  }

  const parseResult = WebAuthnLoginVerifySchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parseResult.data
  const origin = c.env.AUTH_WEBAUTHN_ORIGIN
  const rpID = c.env.AUTH_WEBAUTHN_RP_ID

  let challenge: string
  try {
    challenge = await identity.getWebAuthnChallenge(body.challengeId)
  } catch {
    return c.json({ error: 'Invalid or expired challenge' }, 400)
  }

  const credentials = await identity.getAllWebAuthnCredentials()
  const assertion = body.assertion as { id: string }
  const matched = credentials.find((cr) => cr.id === assertion.id)
  if (!matched) return c.json({ error: 'Unknown credential' }, 401)

  // WebAuthn verification — failure here is a 401
  let verification: Awaited<ReturnType<typeof verifyAuthResponse>>
  try {
    verification = await verifyAuthResponse(assertion, matched, challenge, origin, rpID)
  } catch {
    try {
      await c.get('authEvents').record({
        userPubkey: matched.ownerPubkey,
        eventType: 'login_failed',
        payload: { ipHash, credentialId: matched.id },
      })
    } catch (err) {
      log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
    }
    return c.json({ error: 'Verification failed' }, 401)
  }
  if (!verification.verified) {
    try {
      await c.get('authEvents').record({
        userPubkey: matched.ownerPubkey,
        eventType: 'login_failed',
        payload: { ipHash, credentialId: matched.id },
      })
    } catch (err) {
      log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
    }
    return c.json({ error: 'Verification failed' }, 401)
  }

  // Post-verification infrastructure — errors here are 500s, not auth failures
  await identity.updateWebAuthnCounter({
    pubkey: matched.ownerPubkey,
    credId: matched.id,
    counter: verification.authenticationInfo.newCounter,
    lastUsedAt: new Date().toISOString(),
  })

  const settings = c.get('settings')
  const permissions = await resolveUserPermissions(matched.ownerPubkey, identity, settings)
  const accessToken = await signAccessToken(
    { pubkey: matched.ownerPubkey, permissions },
    c.env.JWT_SECRET
  )

  const userAgent = c.req.header('User-Agent') || ''
  const seenBefore = await c.get('sessions').hasSeenIpHash(matched.ownerPubkey, ipHash)
  const { sessionId, token } = await createUserSession({
    pubkey: matched.ownerPubkey,
    credentialId: matched.id,
    clientIp,
    userAgent,
    ipHash,
    hmacSecret: c.env.HMAC_SECRET,
    sessions: c.get('sessions'),
    crypto: c.get('crypto'),
  })

  // Emit login auth event (non-fatal on failure)
  let geoCity = ''
  let geoCountry = ''
  try {
    const geo = await lookupIp(clientIp, GEOIP_DB_PATH)
    geoCity = geo.city
    geoCountry = geo.country
    await c.get('authEvents').record({
      userPubkey: matched.ownerPubkey,
      eventType: 'login',
      payload: {
        sessionId,
        ipHash,
        city: geo.city,
        country: geo.country,
        userAgent,
        credentialId: matched.id,
        credentialLabel: matched.label,
      },
    })
  } catch (err) {
    log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
  }

  // Fire new-device alert on first sighting of this IP hash (non-fatal, fire-and-forget)
  if (!seenBefore) {
    const notifications = c.get('userNotifications')
    if (notifications) {
      void notifications
        .sendAlert(matched.ownerPubkey, {
          type: 'new_device',
          city: geoCity,
          country: geoCountry,
          userAgent: formatUserAgent(userAgent),
        })
        .catch((err) =>
          log.error('notification failed', err instanceof Error ? err : new Error(String(err)))
        )
    }
  }

  setCookie(c, 'llamenos-refresh', token, refreshCookieOptions(SESSION_COOKIE_MAX_AGE))
  setCookie(c, 'llamenos-session-id', sessionId, sessionIdCookieOptions(SESSION_COOKIE_MAX_AGE))

  return c.json({ accessToken, pubkey: matched.ownerPubkey }, 200)
})

const inviteAcceptRoute = createRoute({
  method: 'post',
  path: '/invite/accept',
  tags: ['Auth'],
  summary: 'Accept an invite code',
  request: {
    body: { content: { 'application/json': { schema: InviteAcceptSchema } } },
  },
  responses: {
    200: {
      description: 'Invite valid',
      content: {
        'application/json': {
          schema: z.object({ valid: z.boolean(), roles: z.array(z.string()) }),
        },
      },
    },
    400: {
      description: 'Invalid invite',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(inviteAcceptRoute, async (c) => {
  const identity = c.get('identity')
  const parseResult = InviteAcceptSchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parseResult.data

  const result = await identity.validateInvite(body.code)
  if (!result.valid) {
    return c.json({ error: result.error ?? 'Invalid invite' }, 400)
  }
  return c.json({ valid: true, roles: result.roleIds ?? [] }, 200)
})

const demoLoginRoute = createRoute({
  method: 'post',
  path: '/demo-login',
  tags: ['Auth'],
  summary: 'Demo login',
  request: {
    body: { content: { 'application/json': { schema: DemoLoginSchema } } },
  },
  responses: {
    200: {
      description: 'Demo token',
      content: { 'application/json': { schema: z.object({ token: z.string() }) } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    403: {
      description: 'Demo mode not enabled',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Demo account not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(demoLoginRoute, async (c) => {
  // Demo mode can be enabled via env var or via setup wizard (database setting)
  const envDemo = c.env.DEMO_MODE === 'true'
  let dbDemo = false
  if (!envDemo) {
    try {
      const settings = c.get('settings')
      const setupState = await settings.getSetupState()
      dbDemo = !!(setupState as unknown as Record<string, unknown>)?.demoMode
    } catch {
      /* settings not available yet */
    }
  }
  if (!envDemo && !dbDemo) {
    return c.json({ error: 'Demo mode is not enabled' }, 403)
  }
  const parseResult = DemoLoginSchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parseResult.data

  const identity = c.get('identity')
  const user = await identity.getUser(body.pubkey)
  if (!user) return c.json({ error: 'Demo account not found' }, 404)

  // Resolve permissions from roles
  const settings = c.get('settings')
  const allRoles = await settings.listRoles()
  const permissions = resolvePermissions(user.roles, allRoles)

  const token = await signAccessToken(
    { pubkey: body.pubkey, permissions: [...new Set(permissions)] },
    c.env.JWT_SECRET
  )

  return c.json({ token }, 200)
})

// ===== Authenticated routes =====
// All routes below include middleware: [jwtAuth] in their createRoute() definition,
// so no blanket .use() auth guards are needed here.

const webauthnRegisterOptionsRoute = createRoute({
  method: 'post',
  path: '/webauthn/register-options',
  tags: ['Auth'],
  summary: 'Get WebAuthn registration options',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'WebAuthn options',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(webauthnRegisterOptionsRoute, async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const user = await identity.getUser(pubkey)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const rpID = c.env.AUTH_WEBAUTHN_RP_ID
  const rpName = c.env.AUTH_WEBAUTHN_RP_NAME || c.env.HOTLINE_NAME || 'Hotline'
  const existing: WebAuthnCredential[] = await identity.getWebAuthnCredentials(pubkey)
  const options = await generateRegOptions({ pubkey, name: user.name }, existing, rpID, rpName)
  const challengeId = crypto.randomUUID()
  await identity.storeWebAuthnChallenge({ id: challengeId, challenge: options.challenge })
  return c.json({ ...options, challengeId }, 200)
})

const webauthnRegisterVerifyRoute = createRoute({
  method: 'post',
  path: '/webauthn/register-verify',
  tags: ['Auth'],
  summary: 'Verify WebAuthn registration attestation',
  middleware: [jwtAuth],
  request: {
    body: { content: { 'application/json': { schema: WebAuthnRegisterVerifySchema } } },
  },
  responses: {
    200: {
      description: 'Registration successful',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid request or verification failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(webauthnRegisterVerifyRoute, async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')

  const parseResult = WebAuthnRegisterVerifySchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parseResult.data
  const origin = c.env.AUTH_WEBAUTHN_ORIGIN
  const rpID = c.env.AUTH_WEBAUTHN_RP_ID

  let challenge: string
  try {
    challenge = await identity.getWebAuthnChallenge(body.challengeId)
  } catch {
    return c.json({ error: 'Invalid or expired challenge' }, 400)
  }

  try {
    const attestation = body.attestation as { response?: { transports?: string[] } }
    const verification = await verifyRegResponse(attestation, challenge, origin, rpID)
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'Verification failed' }, 400)
    }

    const { credential: regCred, credentialBackedUp } = verification.registrationInfo
    const newCred: WebAuthnCredential = {
      id: regCred.id,
      publicKey: uint8ArrayToBase64URL(regCred.publicKey),
      counter: regCred.counter,
      transports: attestation.response?.transports || [],
      backedUp: credentialBackedUp,
      label: body.label || 'Passkey',
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    }

    await identity.addWebAuthnCredential({ pubkey, credential: newCred })

    try {
      await c.get('authEvents').record({
        userPubkey: pubkey,
        eventType: 'passkey_added',
        payload: { credentialId: regCred.id, credentialLabel: newCred.label },
      })
    } catch (err) {
      log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
    }

    const notifications = c.get('userNotifications')
    if (notifications) {
      void notifications
        .sendAlert(pubkey, { type: 'passkey_added', credentialLabel: newCred.label })
        .catch((err) =>
          log.error('notification failed', err instanceof Error ? err : new Error(String(err)))
        )
    }

    return c.json({ ok: true }, 200)
  } catch {
    return c.json({ error: 'Verification failed' }, 400)
  }
})

const tokenRefreshRoute = createRoute({
  method: 'post',
  path: '/token/refresh',
  tags: ['Auth'],
  summary: 'Refresh access token',
  responses: {
    200: {
      description: 'New access token',
      content: { 'application/json': { schema: z.object({ accessToken: z.string() }) } },
    },
    401: {
      description: 'Invalid or expired session',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    415: {
      description: 'Invalid Content-Type',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(tokenRefreshRoute, async (c) => {
  const contentType = c.req.header('Content-Type')
  if (!contentType?.includes('application/json')) {
    return c.json({ error: 'Content-Type must be application/json' }, 415)
  }

  const refreshCookie = getCookie(c, 'llamenos-refresh')
  if (!refreshCookie) {
    return c.json({ error: 'Missing refresh token' }, 401)
  }

  const sessions = c.get('sessions')
  const tokenHash = hashSessionToken(refreshCookie, c.env.HMAC_SECRET)
  const found = await sessions.findByTokenHash(tokenHash)
  if (!found) {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }
  const { session, viaPrev } = found
  if (session.revokedAt) {
    return c.json({ error: 'Session revoked' }, 401)
  }
  if (session.expiresAt < new Date()) {
    await sessions.revoke(session.id, 'expired')
    return c.json({ error: 'Session expired' }, 401)
  }

  // Replay detection: the token matched the previous hash (viaPrev=true) AND
  // rotation happened more than 60s ago → treat as token theft. Revoke the
  // session, record an auth event, notify the user, and reject.
  const REPLAY_GRACE_MS = 60 * 1000
  if (viaPrev) {
    const lastSeen = session.lastSeenAt?.getTime() ?? 0
    if (Date.now() - lastSeen > REPLAY_GRACE_MS) {
      await sessions.revoke(session.id, 'replay')
      try {
        await c.get('authEvents').record({
          userPubkey: session.userPubkey,
          eventType: 'session_revoked',
          payload: { sessionId: session.id, meta: { reason: 'replay' } },
        })
      } catch (err) {
        log.error(
          'auth event recording failed',
          err instanceof Error ? err : new Error(String(err))
        )
      }
      const notifications = c.get('userNotifications')
      if (notifications) {
        void notifications
          .sendAlert(session.userPubkey, {
            type: 'session_revoked_remote',
            city: 'unknown',
            country: 'unknown',
          })
          .catch((err) =>
            log.error(
              'replay notification failed',
              err instanceof Error ? err : new Error(String(err))
            )
          )
      }
      return c.json({ error: 'Session revoked' }, 401)
    }
    log.warn('refresh via prev_token_hash (grace window)', { sessionId: session.id })
  }

  // Rotate token (skip in test mode where storage-state fixtures reuse cookies).
  // Rotation is always enabled outside test mode; replay detection is still
  // covered by unit/integration tests.
  const skipRotation = process.env.DISABLE_TOKEN_ROTATION === 'true'
  let cookieToken = refreshCookie
  if (!skipRotation) {
    const newToken = generateSessionToken()
    const newHash = hashSessionToken(newToken, c.env.HMAC_SECRET)
    await sessions.touch(session.id, newHash)
    cookieToken = newToken
  } else {
    // Still update lastSeenAt without rotating the hash
    await sessions.touch(session.id, session.tokenHash)
  }

  const pubkey = session.userPubkey
  const idpAdapter = c.get('idpAdapter')
  const identity = c.get('identity')

  // Confirm user is still active in IdP
  const idpSession = await idpAdapter.refreshSession(pubkey)
  if (!idpSession.valid) {
    await sessions.revoke(session.id, 'admin')
    return c.json({ error: 'Session no longer valid' }, 401)
  }

  const settings = c.get('settings')
  const permissions = await resolveUserPermissions(pubkey, identity, settings)
  const accessToken = await signAccessToken({ pubkey, permissions }, c.env.JWT_SECRET)

  setCookie(c, 'llamenos-refresh', cookieToken, refreshCookieOptions(SESSION_COOKIE_MAX_AGE))

  return c.json({ accessToken }, 200)
})

const kekProofStatusRoute = createRoute({
  method: 'get',
  path: '/kek-proof/status',
  tags: ['Auth'],
  summary: 'Get KEK proof status',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'KEK proof status',
      content: { 'application/json': { schema: z.object({ hasProof: z.boolean() }) } },
    },
  },
})

authFacade.openapi(kekProofStatusRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const identity = c.get('identity')
  const stored = await identity.getKekProofHash(pubkey)
  return c.json({ hasProof: stored !== null }, 200)
})

const kekProofRoute = createRoute({
  method: 'post',
  path: '/kek-proof',
  tags: ['Auth'],
  summary: 'Set KEK proof hash',
  middleware: [jwtAuth],
  request: {
    body: { content: { 'application/json': { schema: KekProofSchema } } },
  },
  responses: {
    200: {
      description: 'Proof set or verified',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    409: {
      description: 'Proof already set',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(kekProofRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const parsed = KekProofSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const body = parsed.data
  const identity = c.get('identity')
  const existing = await identity.getKekProofHash(pubkey)
  if (existing) {
    // Already set — require caller to prove they know the current KEK by
    // matching it. This prevents a stolen JWT from overwriting the hash.
    if (!(await identity.verifyKekProof(pubkey, body.proof))) {
      return c.json({ error: 'Proof already set' }, 409)
    }
    return c.json({ ok: true }, 200)
  }
  await identity.setKekProofHash(pubkey, IdentityService.hashKekProof(body.proof))
  return c.json({ ok: true }, 200)
})

const userinfoRoute = createRoute({
  method: 'get',
  path: '/userinfo',
  tags: ['Auth'],
  summary: 'Get user info',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'User info',
      content: {
        'application/json': {
          schema: z.object({ pubkey: z.string(), nsecSecret: z.string().nullable() }),
        },
      },
    },
  },
})

authFacade.openapi(userinfoRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const idpAdapter = c.get('idpAdapter')

  let nsecSecret: string | null = null
  try {
    const nsecBytes = await idpAdapter.getNsecSecret(pubkey)
    nsecSecret = bytesToHex(nsecBytes)
  } catch {
    // User not enrolled in IdP yet (e.g., during initial registration or test setup).
    // Return null — the client will use a synthetic IdP value for KEK derivation.
  }

  return c.json({ pubkey, nsecSecret }, 200)
})

const rotationConfirmRoute = createRoute({
  method: 'post',
  path: '/rotation/confirm',
  tags: ['Auth'],
  summary: 'Confirm key rotation',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Rotation confirmed',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

authFacade.openapi(rotationConfirmRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const idpAdapter = c.get('idpAdapter')
  await idpAdapter.confirmRotation(pubkey)
  return c.json({ ok: true }, 200)
})

const sessionRevokeRoute = createRoute({
  method: 'post',
  path: '/session/revoke',
  tags: ['Auth'],
  summary: 'Revoke current session',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Session revoked',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

authFacade.openapi(sessionRevokeRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const sessions = c.get('sessions')
  const idpAdapter = c.get('idpAdapter')

  const sessionIdCookie = getCookie(c, 'llamenos-session-id')
  // In test mode (DISABLE_TOKEN_ROTATION), skip DB-level session revocation so
  // shared storage-state fixtures (admin.json etc.) stay usable across tests.
  // Cookies are still cleared client-side. Security: rotation + revocation
  // semantics are covered by unit/integration tests.
  const skipRevocation = process.env.DISABLE_TOKEN_ROTATION === 'true'
  if (sessionIdCookie && !skipRevocation) {
    const session = await sessions.findByIdForUser(sessionIdCookie, pubkey)
    if (session) {
      await sessions.revoke(session.id, 'user')
    }
  }

  try {
    await c.get('authEvents').record({
      userPubkey: pubkey,
      eventType: 'logout',
      payload: { sessionId: sessionIdCookie ?? undefined },
    })
  } catch (err) {
    log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
  }

  // Also revoke IdP session if still applicable (skipped in test mode).
  if (!skipRevocation) {
    try {
      await idpAdapter.revokeSession(pubkey)
    } catch {
      // IdP may have already expired; ignore.
    }
  }

  setCookie(c, 'llamenos-refresh', '', clearRefreshCookieOptions())
  setCookie(c, 'llamenos-session-id', '', clearSessionIdCookieOptions())

  return c.json({ ok: true }, 200)
})

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/sessions',
  tags: ['Auth'],
  summary: 'List active sessions',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Active sessions',
      content: {
        'application/json': { schema: z.object({ sessions: z.array(z.object({}).passthrough()) }) },
      },
    },
  },
})

authFacade.openapi(listSessionsRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const sessions = c.get('sessions')
  const sessionIdCookie = getCookie(c, 'llamenos-session-id')
  const rows = await sessions.listForUser(pubkey)
  return c.json(
    {
      sessions: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        isCurrent: r.id === sessionIdCookie,
        encryptedMeta: r.encryptedMeta,
        metaEnvelope: r.metaEnvelope,
        credentialId: r.credentialId,
      })),
    },
    200
  )
})

const deleteSessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/{id}',
  tags: ['Auth'],
  summary: 'Revoke a specific session',
  middleware: [jwtAuth],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'sess-abc123' }),
    }),
  },
  responses: {
    200: {
      description: 'Session revoked',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    404: {
      description: 'Session not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(deleteSessionRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const sessions = c.get('sessions')
  const id = c.req.param('id')
  const session = await sessions.findByIdForUser(id, pubkey)
  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }
  await sessions.revoke(id, 'user')
  try {
    await c.get('authEvents').record({
      userPubkey: pubkey,
      eventType: 'session_revoked',
      payload: { sessionId: id },
    })
  } catch (err) {
    log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
  }
  return c.json({ ok: true }, 200)
})

const revokeOthersRoute = createRoute({
  method: 'post',
  path: '/sessions/revoke-others',
  tags: ['Auth'],
  summary: 'Revoke all other sessions',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Other sessions revoked',
      content: { 'application/json': { schema: z.object({ revokedCount: z.number() }) } },
    },
  },
})

authFacade.openapi(revokeOthersRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const sessions = c.get('sessions')
  const sessionIdCookie = getCookie(c, 'llamenos-session-id')
  const count = await sessions.revokeAllForUser(pubkey, 'user', sessionIdCookie ?? undefined)
  try {
    await c.get('authEvents').record({
      userPubkey: pubkey,
      eventType: 'sessions_revoked_others',
      payload: { meta: { count } },
    })
  } catch (err) {
    log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
  }
  return c.json({ revokedCount: count }, 200)
})

const lockdownRoute = createRoute({
  method: 'post',
  path: '/sessions/lockdown',
  tags: ['Auth'],
  summary: 'Emergency session lockdown',
  middleware: [jwtAuth],
  request: {
    body: { content: { 'application/json': { schema: LockdownRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Lockdown result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), details: z.any().optional() }),
        },
      },
    },
    401: {
      description: 'Invalid PIN proof',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    409: {
      description: 'Unlock required first',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(lockdownRoute, async (c) => {
  const pubkey = c.get('pubkey')
  if (isRateLimited(`lockdown:${pubkey}`, LIMIT_LOCKDOWN_PER_15MIN, 15 * 60 * 1000)) {
    return c.json({ error: 'Too many lockdown attempts' }, 429)
  }
  const parsed = LockdownRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400)
  }
  const identity = c.get('identity')
  const storedHash = await identity.getKekProofHash(pubkey)
  if (!storedHash) {
    return c.json({ error: 'Unlock with PIN first to enable lockdown' }, 409)
  }
  if (!(await identity.verifyKekProof(pubkey, parsed.data.pinProof))) {
    return c.json({ error: 'Invalid PIN proof' }, 401)
  }
  const securityActions = c.get('securityActions')
  const sessionIdCookie = getCookie(c, 'llamenos-session-id')
  const result = await securityActions.runLockdown(
    pubkey,
    parsed.data.tier,
    sessionIdCookie ?? null
  )
  if (parsed.data.tier === 'C') {
    setCookie(c, 'llamenos-refresh', '', clearRefreshCookieOptions())
    setCookie(c, 'llamenos-session-id', '', clearSessionIdCookieOptions())
  }
  return c.json(result, 200)
})

const pinChangeRoute = createRoute({
  method: 'post',
  path: '/pin/change',
  tags: ['Auth'],
  summary: 'Change PIN',
  middleware: [jwtAuth],
  request: {
    body: { content: { 'application/json': { schema: PinChangeSchema } } },
  },
  responses: {
    200: {
      description: 'PIN changed',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    401: {
      description: 'Invalid current PIN proof',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    409: {
      description: 'Unlock required first',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(pinChangeRoute, async (c) => {
  const pubkey = c.get('pubkey')
  if (isRateLimited(`pin-change:${pubkey}`, LIMIT_PIN_CHANGE_PER_HOUR, 60 * 60 * 1000)) {
    return c.json({ error: 'Too many PIN change attempts' }, 429)
  }
  const parsed = PinChangeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const identity = c.get('identity')
  // Verify the caller's current KEK proof against the stored hash to prevent
  // JWT-only account hijack. If no proof hash is stored (pre-migration user),
  // reject and require a PIN unlock first.
  const currentHash = await identity.getKekProofHash(pubkey)
  if (!currentHash) {
    return c.json({ error: 'Unlock with PIN first to enable PIN change' }, 409)
  }
  if (!(await identity.verifyKekProof(pubkey, parsed.data.currentPinProof))) {
    return c.json({ error: 'Invalid current PIN proof' }, 401)
  }
  await identity.updateEncryptedSecretKey(pubkey, parsed.data.newEncryptedSecretKey)
  // Rotate the stored proof hash to match the new PIN.
  await identity.setKekProofHash(pubkey, IdentityService.hashKekProof(parsed.data.newKekProof))
  try {
    await c.get('authEvents').record({
      userPubkey: pubkey,
      eventType: 'pin_changed',
      payload: {},
    })
  } catch (err) {
    log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
  }
  const notifications = c.get('userNotifications')
  if (notifications) {
    void notifications
      .sendAlert(pubkey, { type: 'pin_changed' })
      .catch((err) =>
        log.error('notification failed', err instanceof Error ? err : new Error(String(err)))
      )
  }
  return c.json({ ok: true }, 200)
})

const recoveryRotateRoute = createRoute({
  method: 'post',
  path: '/recovery/rotate',
  tags: ['Auth'],
  summary: 'Rotate recovery key',
  middleware: [jwtAuth],
  request: {
    body: { content: { 'application/json': { schema: RecoveryRotateSchema } } },
  },
  responses: {
    200: {
      description: 'Recovery key rotated',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    401: {
      description: 'Invalid current PIN proof',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    409: {
      description: 'Unlock required first',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(recoveryRotateRoute, async (c) => {
  const pubkey = c.get('pubkey')
  if (
    isRateLimited(`recovery-rotate:${pubkey}`, LIMIT_RECOVERY_ROTATE_PER_DAY, 24 * 60 * 60 * 1000)
  ) {
    return c.json({ error: 'Too many rotation attempts' }, 429)
  }
  const parsed = RecoveryRotateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  const identity = c.get('identity')
  // Verify caller's current KEK proof before storing the re-wrapped secret.
  const currentHash = await identity.getKekProofHash(pubkey)
  if (!currentHash) {
    return c.json({ error: 'Unlock with PIN first to enable recovery rotation' }, 409)
  }
  if (!(await identity.verifyKekProof(pubkey, parsed.data.currentPinProof))) {
    return c.json({ error: 'Invalid current PIN proof' }, 401)
  }
  // Recovery rotation doesn't change the PIN, so the stored proof hash remains valid.
  await identity.updateEncryptedSecretKey(pubkey, parsed.data.newEncryptedSecretKey)
  try {
    await c.get('authEvents').record({
      userPubkey: pubkey,
      eventType: 'recovery_rotated',
      payload: {},
    })
  } catch (err) {
    log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
  }
  const notifications = c.get('userNotifications')
  if (notifications) {
    void notifications
      .sendAlert(pubkey, { type: 'recovery_rotated' })
      .catch((err) =>
        log.error('notification failed', err instanceof Error ? err : new Error(String(err)))
      )
  }
  return c.json({ ok: true }, 200)
})

const listDevicesRoute = createRoute({
  method: 'get',
  path: '/devices',
  tags: ['Auth'],
  summary: 'List WebAuthn credentials (devices)',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Credentials list',
      content: {
        'application/json': {
          schema: z.object({
            credentials: z.array(z.object({}).passthrough()),
            warning: z.string().optional(),
          }),
        },
      },
    },
  },
})

authFacade.openapi(listDevicesRoute, async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credentials = await identity.getWebAuthnCredentials(pubkey)
  return c.json(
    {
      credentials: credentials.map((cr) => ({
        id: cr.id,
        label: cr.label,
        backedUp: cr.backedUp,
        createdAt: cr.createdAt,
        lastUsedAt: cr.lastUsedAt,
        // E2EE envelope fields for client-side label decryption
        ...(cr.encryptedLabel && cr.labelEnvelopes
          ? { encryptedLabel: cr.encryptedLabel, labelEnvelopes: cr.labelEnvelopes }
          : {}),
      })),
      warning: credentials.length === 1 ? 'Register a backup device to prevent lockout' : undefined,
    },
    200
  )
})

const adminReEnrollRoute = createRoute({
  method: 'post',
  path: '/admin/re-enroll/{pubkey}',
  tags: ['Auth'],
  summary: 'Admin re-enroll user',
  middleware: [jwtAuth],
  request: {
    params: z.object({
      pubkey: z.string().openapi({ param: { name: 'pubkey', in: 'path' }, example: 'npub1...' }),
    }),
  },
  responses: {
    200: {
      description: 'Re-enrollment successful',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(adminReEnrollRoute, async (c) => {
  const permissions = c.get('permissions')
  if (!permissions.includes('users:update') && !permissions.includes('*')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const targetPubkey = c.req.param('pubkey')
  const idpAdapter = c.get('idpAdapter')
  const identity = c.get('identity')

  const user = await identity.getUser(targetPubkey)
  if (!user) return c.json({ error: 'User not found' }, 404)

  await idpAdapter.revokeAllSessions(targetPubkey)

  const creds = await identity.getWebAuthnCredentials(targetPubkey)
  for (const cred of creds) {
    await identity.deleteWebAuthnCredential(targetPubkey, cred.id)
  }

  return c.json({ success: true }, 200)
})

const enrollRoute = createRoute({
  method: 'post',
  path: '/enroll',
  tags: ['Auth'],
  summary: 'Enroll user in IdP',
  middleware: [jwtAuth],
  request: {
    body: { content: { 'application/json': { schema: EnrollRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Enrollment successful',
      content: { 'application/json': { schema: z.object({ nsecSecret: z.string() }) } },
    },
    400: {
      description: 'Invalid pubkey',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(enrollRoute, async (c) => {
  const permissions = c.get('permissions')
  if (!permissions.includes('users:create') && !permissions.includes('*')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const parsed = EnrollRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid pubkey' }, 400)
  }
  const { pubkey } = parsed.data

  const idpAdapter = c.get('idpAdapter')

  // Idempotent: if user already exists, just return their nsecSecret
  const existing = await idpAdapter.getUser(pubkey)
  if (existing) {
    const nsecSecret = await idpAdapter.getNsecSecret(pubkey)
    return c.json({ nsecSecret: Buffer.from(nsecSecret).toString('hex') }, 200)
  }

  try {
    await idpAdapter.createUser(pubkey)
  } catch {
    // Race condition: concurrent createUser for same pubkey — check if it was created
    const raceCheck = await idpAdapter.getUser(pubkey)
    if (!raceCheck) throw new Error(`Failed to create IdP user for ${pubkey}`)
  }
  const nsecSecret = await idpAdapter.getNsecSecret(pubkey)
  return c.json({ nsecSecret: Buffer.from(nsecSecret).toString('hex') }, 200)
})

const listPasskeysRoute = createRoute({
  method: 'get',
  path: '/passkeys',
  tags: ['Auth'],
  summary: 'List passkeys',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Passkeys list',
      content: {
        'application/json': {
          schema: z.object({
            credentials: z.array(z.object({}).passthrough()),
            warning: z.string().optional(),
          }),
        },
      },
    },
  },
})

authFacade.openapi(listPasskeysRoute, async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credentials = await identity.getWebAuthnCredentials(pubkey)
  return c.json(
    {
      credentials: credentials.map((cr) => ({
        id: cr.id,
        label: cr.label,
        transports: cr.transports,
        backedUp: cr.backedUp,
        createdAt: cr.createdAt,
        lastUsedAt: cr.lastUsedAt,
        ...(cr.encryptedLabel && cr.labelEnvelopes
          ? { encryptedLabel: cr.encryptedLabel, labelEnvelopes: cr.labelEnvelopes }
          : {}),
      })),
      warning: credentials.length === 1 ? 'Register a backup device to prevent lockout' : undefined,
    },
    200
  )
})

const renamePasskeyRoute = createRoute({
  method: 'patch',
  path: '/passkeys/{id}',
  tags: ['Auth'],
  summary: 'Rename a passkey',
  middleware: [jwtAuth],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'cred-abc123' }),
    }),
    body: { content: { 'application/json': { schema: PasskeyRenameSchema } } },
  },
  responses: {
    200: {
      description: 'Passkey renamed',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), details: z.any().optional() }),
        },
      },
    },
    404: {
      description: 'Credential not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(renamePasskeyRoute, async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credId = decodeURIComponent(c.req.param('id'))

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const parsed = PasskeyRenameSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
  }

  try {
    await identity.renameWebAuthnCredential(pubkey, credId, {
      label: parsed.data.label,
      encryptedLabel: parsed.data.encryptedLabel as Ciphertext | undefined,
      labelEnvelopes: parsed.data.labelEnvelopes as RecipientEnvelope[] | undefined,
    })
    try {
      await c.get('authEvents').record({
        userPubkey: pubkey,
        eventType: 'passkey_renamed',
        payload: { credentialId: credId },
      })
    } catch (err) {
      log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
    }
    return c.json({ ok: true }, 200)
  } catch {
    return c.json({ error: 'Credential not found' }, 404)
  }
})

const deletePasskeyRoute = createRoute({
  method: 'delete',
  path: '/passkeys/{id}',
  tags: ['Auth'],
  summary: 'Delete a passkey',
  middleware: [jwtAuth],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'cred-abc123' }),
    }),
  },
  responses: {
    200: {
      description: 'Passkey deleted',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid credential ID',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Credential not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(deletePasskeyRoute, async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credId = decodeURIComponent(c.req.param('id'))
  if (!credId) return c.json({ error: 'Invalid credential ID' }, 400)
  const existing = await identity
    .getWebAuthnCredentials(pubkey)
    .then((creds) => creds?.find((cr) => cr.id === credId))
    .catch(() => undefined)
  try {
    await identity.deleteWebAuthnCredential(pubkey, credId)
  } catch {
    return c.json({ error: 'Credential not found' }, 404)
  }
  try {
    await c.get('authEvents').record({
      userPubkey: pubkey,
      eventType: 'passkey_removed',
      payload: { credentialId: credId, credentialLabel: existing?.label },
    })
  } catch (err) {
    log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
  }
  if (existing) {
    const notifications = c.get('userNotifications')
    if (notifications) {
      void notifications
        .sendAlert(pubkey, { type: 'passkey_removed', credentialLabel: existing.label })
        .catch((err) =>
          log.error('notification failed', err instanceof Error ? err : new Error(String(err)))
        )
    }
  }
  return c.json({ ok: true }, 200)
})

const deleteDeviceRoute = createRoute({
  method: 'delete',
  path: '/devices/{id}',
  tags: ['Auth'],
  summary: 'Delete a device (WebAuthn credential)',
  middleware: [jwtAuth],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'cred-abc123' }),
    }),
  },
  responses: {
    200: {
      description: 'Device deleted',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid credential ID',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Credential not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(deleteDeviceRoute, async (c) => {
  const identity = c.get('identity')
  const pubkey = c.get('pubkey')
  const credId = decodeURIComponent(c.req.param('id'))
  if (!credId) return c.json({ error: 'Invalid credential ID' }, 400)

  const existing = await identity
    .getWebAuthnCredentials(pubkey)
    .then((creds) => creds?.find((cr) => cr.id === credId))
    .catch(() => undefined)
  try {
    await identity.deleteWebAuthnCredential(pubkey, credId)
  } catch {
    return c.json({ error: 'Credential not found' }, 404)
  }
  try {
    await c.get('authEvents').record({
      userPubkey: pubkey,
      eventType: 'passkey_removed',
      payload: { credentialId: credId, credentialLabel: existing?.label },
    })
  } catch (err) {
    log.error('auth event recording failed', err instanceof Error ? err : new Error(String(err)))
  }
  if (existing) {
    const notifications = c.get('userNotifications')
    if (notifications) {
      void notifications
        .sendAlert(pubkey, { type: 'passkey_removed', credentialLabel: existing.label })
        .catch((err) =>
          log.error('notification failed', err instanceof Error ? err : new Error(String(err)))
        )
    }
  }
  return c.json({ ok: true }, 200)
})

// ---------------------------------------------------------------------------
// Auth Event History endpoints
// ---------------------------------------------------------------------------

function serializeAuthEvent(r: {
  id: string
  eventType: string
  encryptedPayload: string
  payloadEnvelope: RecipientEnvelope[]
  createdAt: Date
  reportedSuspiciousAt: Date | null
}) {
  return {
    id: r.id,
    eventType: r.eventType,
    encryptedPayload: r.encryptedPayload,
    payloadEnvelope: r.payloadEnvelope,
    createdAt: r.createdAt.toISOString(),
    reportedSuspiciousAt: r.reportedSuspiciousAt?.toISOString() ?? null,
  }
}

const listEventsRoute = createRoute({
  method: 'get',
  path: '/events',
  tags: ['Auth'],
  summary: 'List auth events',
  middleware: [jwtAuth],
  request: {
    query: AuthEventListQuerySchema,
  },
  responses: {
    200: {
      description: 'Auth events',
      content: {
        'application/json': { schema: z.object({ events: z.array(z.object({}).passthrough()) }) },
      },
    },
    400: {
      description: 'Invalid query params',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(listEventsRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const authEvents = c.get('authEvents')
  const parsed = AuthEventListQuerySchema.safeParse({
    limit: c.req.query('limit'),
    since: c.req.query('since'),
  })
  if (!parsed.success) {
    return c.json({ error: 'Invalid query params' }, 400)
  }
  const rows = await authEvents.listForUser(pubkey, {
    limit: parsed.data.limit,
    since: parsed.data.since ? new Date(parsed.data.since) : undefined,
  })
  return c.json({ events: rows.map(serializeAuthEvent) }, 200)
})

const exportEventsRoute = createRoute({
  method: 'get',
  path: '/events/export',
  tags: ['Auth'],
  summary: 'Export auth events',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Exported events',
      content: {
        'application/json': {
          schema: z.object({
            userPubkey: z.string(),
            exportedAt: z.string(),
            events: z.array(z.object({}).passthrough()),
          }),
        },
      },
    },
  },
})

authFacade.openapi(exportEventsRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const authEvents = c.get('authEvents')
  const rows = await authEvents.listForUser(pubkey, { limit: 200 })
  return c.json(
    {
      userPubkey: pubkey,
      exportedAt: new Date().toISOString(),
      events: rows.map(serializeAuthEvent),
    },
    200
  )
})

const reportEventRoute = createRoute({
  method: 'post',
  path: '/events/{id}/report',
  tags: ['Auth'],
  summary: 'Report suspicious auth event',
  middleware: [jwtAuth],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'evt-abc123' }),
    }),
  },
  responses: {
    200: {
      description: 'Event reported',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    404: {
      description: 'Event not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(reportEventRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const authEvents = c.get('authEvents')
  const id = c.req.param('id')
  const updated = await authEvents.markSuspicious(id, pubkey)
  if (!updated) {
    return c.json({ error: 'Event not found' }, 404)
  }
  // Raise an admin audit entry so admins can investigate. Non-fatal.
  try {
    const records = c.get('records')
    await records.addAuditEntry('global', 'user_reported_suspicious_event', pubkey, {
      reportedEventId: id,
      reportedEventType: updated.eventType,
    })
  } catch (err) {
    log.error('audit entry recording failed', err instanceof Error ? err : new Error(String(err)))
  }
  return c.json({ ok: true }, 200)
})

// ---------------------------------------------------------------------------
// Signal contact endpoints
// ---------------------------------------------------------------------------

const getSignalContactRoute = createRoute({
  method: 'get',
  path: '/signal-contact',
  tags: ['Auth'],
  summary: 'Get Signal contact',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Signal contact',
      content: { 'application/json': { schema: z.object({ contact: z.any() }) } },
    },
  },
})

authFacade.openapi(getSignalContactRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const svc = c.get('signalContacts')
  const contact = await svc.findByUser(pubkey)
  if (!contact) return c.json({ contact: null }, 200)
  return c.json(
    {
      contact: {
        identifierHash: contact.identifierHash,
        identifierCiphertext: contact.identifierCiphertext,
        identifierEnvelope: contact.identifierEnvelope,
        identifierType: contact.identifierType,
        verifiedAt: contact.verifiedAt?.toISOString() ?? null,
        updatedAt: contact.updatedAt.toISOString(),
      },
    },
    200
  )
})

const getSignalHmacKeyRoute = createRoute({
  method: 'get',
  path: '/signal-contact/hmac-key',
  tags: ['Auth'],
  summary: 'Get Signal contact HMAC key',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'HMAC key',
      content: { 'application/json': { schema: z.object({ key: z.string() }) } },
    },
  },
})

authFacade.openapi(getSignalHmacKeyRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const key = bytesToHex(
    hmac(sha256, utf8ToBytes(c.env.HMAC_SECRET), utf8ToBytes(`signal-contact:${pubkey}`))
  )
  return c.json({ key }, 200)
})

const registerSignalContactRoute = createRoute({
  method: 'post',
  path: '/signal-contact',
  tags: ['Auth'],
  summary: 'Register Signal contact',
  middleware: [jwtAuth],
  request: {
    body: { content: { 'application/json': { schema: SignalContactRegisterSchema } } },
  },
  responses: {
    200: {
      description: 'Contact registered',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    502: {
      description: 'Notifier error',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    503: {
      description: 'Signal notifier not configured',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(registerSignalContactRoute, async (c) => {
  const pubkey = c.get('pubkey')
  if (isRateLimited(`signal-contact:${pubkey}`, 5, 60 * 60 * 1000)) {
    return c.json({ error: 'Too many contact updates' }, 429)
  }
  const parsed = SignalContactRegisterSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'Invalid body' }, 400)
  }

  // Proxy registration to the notifier sidecar using the app server's API key.
  // The notifier will not accept registrations from unauthenticated clients.
  const notifierUrl = (process.env.SIGNAL_NOTIFIER_URL ?? '').replace(/\/+$/, '')
  const notifierApiKey = process.env.SIGNAL_NOTIFIER_API_KEY ?? ''
  if (!notifierUrl || !notifierApiKey) {
    return c.json({ error: 'Signal notifier not configured' }, 503)
  }
  try {
    const res = await fetch(`${notifierUrl}/identities/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${notifierApiKey}`,
      },
      body: JSON.stringify({
        identifierHash: parsed.data.identifierHash,
        plaintextIdentifier: parsed.data.plaintextIdentifier,
        identifierType: parsed.data.identifierType,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return c.json({ error: 'Notifier rejected registration' }, 502)
    }
  } catch {
    return c.json({ error: 'Notifier unreachable' }, 502)
  }

  const svc = c.get('signalContacts')
  await svc.upsert({
    userPubkey: pubkey,
    identifierHash: parsed.data.identifierHash,
    identifierCiphertext: parsed.data.identifierCiphertext as Ciphertext,
    identifierEnvelope: parsed.data.identifierEnvelope as RecipientEnvelope[],
    identifierType: parsed.data.identifierType,
  })

  const authEvents = c.get('authEvents')
  await authEvents.record({
    userPubkey: pubkey,
    eventType: 'signal_contact_changed',
    payload: { meta: { identifierType: parsed.data.identifierType } },
  })

  return c.json({ ok: true }, 200)
})

const deleteSignalContactRoute = createRoute({
  method: 'delete',
  path: '/signal-contact',
  tags: ['Auth'],
  summary: 'Delete Signal contact',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Contact deleted',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

authFacade.openapi(deleteSignalContactRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const svc = c.get('signalContacts')
  const contact = await svc.findByUser(pubkey)
  if (contact) {
    try {
      await fetch(
        `${(process.env.SIGNAL_NOTIFIER_URL ?? '').replace(/\/+$/, '')}/identities/${contact.identifierHash}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${process.env.SIGNAL_NOTIFIER_API_KEY}` },
          signal: AbortSignal.timeout(5000),
        }
      )
    } catch (err) {
      log.error(
        'signal notifier cleanup failed',
        err instanceof Error ? err : new Error(String(err))
      )
    }
    await svc.deleteByUser(pubkey)
  }
  return c.json({ ok: true }, 200)
})

// ---------------------------------------------------------------------------
// Security prefs endpoints
// ---------------------------------------------------------------------------

const getSecurityPrefsRoute = createRoute({
  method: 'get',
  path: '/security-prefs',
  tags: ['Auth'],
  summary: 'Get security preferences',
  middleware: [jwtAuth],
  responses: {
    200: {
      description: 'Security preferences',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

authFacade.openapi(getSecurityPrefsRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const svc = c.get('securityPrefs')
  const row = await svc.get(pubkey)
  return c.json(
    {
      autoLockMs: row.autoLockMs,
      disappearingTimerDays: row.disappearingTimerDays,
      digestCadence: row.digestCadence,
      alertOnNewDevice: row.alertOnNewDevice,
      alertOnPasskeyChange: row.alertOnPasskeyChange,
      alertOnPinChange: row.alertOnPinChange,
      notificationChannel: row.notificationChannel,
    },
    200
  )
})

const updateSecurityPrefsRoute = createRoute({
  method: 'patch',
  path: '/security-prefs',
  tags: ['Auth'],
  summary: 'Update security preferences',
  middleware: [jwtAuth],
  request: {
    body: { content: { 'application/json': { schema: UpdateSecurityPrefsSchema } } },
  },
  responses: {
    200: {
      description: 'Updated preferences',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

authFacade.openapi(updateSecurityPrefsRoute, async (c) => {
  const pubkey = c.get('pubkey')
  const parsed = UpdateSecurityPrefsSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const svc = c.get('securityPrefs')
  const row = await svc.update(pubkey, parsed.data)
  return c.json(
    {
      autoLockMs: row.autoLockMs,
      disappearingTimerDays: row.disappearingTimerDays,
      digestCadence: row.digestCadence,
      alertOnNewDevice: row.alertOnNewDevice,
      alertOnPasskeyChange: row.alertOnPasskeyChange,
      alertOnPinChange: row.alertOnPinChange,
      notificationChannel: row.notificationChannel,
    },
    200
  )
})

// --- Recovery Group routes ---
import { recoveryGroupRoutes } from './recovery-group'

authFacade.route('/recovery-group', recoveryGroupRoutes)

export default authFacade

// Export for testing
/** @knipignore — exported for API test suite rate-limit testing */
export { type AuthFacadeEnv, isRateLimited, rateLimitStore }
