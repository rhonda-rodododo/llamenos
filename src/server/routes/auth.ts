import { createRoute, z } from '@hono/zod-openapi'
import { HMAC_IP_PREFIX } from '@shared/crypto-labels'
import { setCookie } from 'hono/cookie'
import { getPrimaryRole } from '../../shared/permissions'
import { getIdPAdapter } from '../app'
import { hashIP } from '../lib/crypto-service'
import { isValidE164 } from '../lib/helpers'
import { signAccessToken } from '../lib/jwt'
import { createRouter } from '../lib/openapi'
import { maskPhone } from '../lib/user-projector'
import { auth as authMiddleware } from '../middleware/auth'
import { checkPermission } from '../middleware/permission-guard'
import type { AppEnv, WebAuthnCredential } from '../types'

const auth = createRouter()

// ── POST /bootstrap — One-shot admin registration (no auth) ──

const bootstrapRoute = createRoute({
  method: 'post',
  path: '/bootstrap',
  tags: ['Auth'],
  summary: 'Bootstrap first admin',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ pubkey: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Admin bootstrapped',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    403: {
      description: 'Admin already exists',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    500: {
      description: 'Bootstrap failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    503: {
      description: 'IdP not available',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

auth.openapi(bootstrapRoute, async (c) => {
  const services = c.get('services')

  // Rate limit by IP
  if (c.env.ENVIRONMENT !== 'development') {
    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
    const limited = await services.settings.checkRateLimit(
      `bootstrap:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
      5
    )
    if (limited) {
      return c.json({ error: 'Too many attempts. Try again later.' }, 429)
    }
  }

  const body = c.req.valid('json')
  if (!body.pubkey) {
    return c.json({ error: 'Invalid request' }, 400)
  }

  // Check if admin already exists
  const hasAdmin = await services.identity.hasAdmin()
  if (hasAdmin) {
    return c.json({ error: 'Admin already exists' }, 403)
  }

  // Create the admin
  try {
    await services.identity.bootstrapAdmin(body.pubkey)
  } catch {
    return c.json({ error: 'Bootstrap failed' }, 500)
  }

  // Create user in IdP and retrieve nsecSecret
  const idpAdapter = getIdPAdapter()
  if (!idpAdapter) {
    return c.json({ error: 'IdP service not available' }, 503)
  }
  await idpAdapter.createUser(body.pubkey)
  const nsecSecret = await idpAdapter.getNsecSecret(body.pubkey)
  const nsecSecretHex = Buffer.from(nsecSecret).toString('hex')

  // Sign access + refresh tokens so the client has a full session after bootstrap
  const accessToken = await signAccessToken(
    { pubkey: body.pubkey, permissions: ['*'] },
    c.env.JWT_SECRET
  )
  const { createUserSession } = await import('./auth-facade')
  const clientIp =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('CF-Connecting-IP') ||
    'unknown'
  const { sessionId, token: refreshToken } = await createUserSession({
    pubkey: body.pubkey,
    credentialId: null,
    clientIp,
    userAgent: c.req.header('User-Agent') || '',
    ipHash: hashIP(clientIp, c.env.HMAC_SECRET),
    hmacSecret: c.env.HMAC_SECRET,
    sessions: services.sessions,
    crypto: services.crypto,
  })
  const isSecure = c.env.ENVIRONMENT !== 'development'
  setCookie(c, 'llamenos-refresh', refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Strict',
    path: '/api/auth/token',
    maxAge: 30 * 24 * 60 * 60,
  })
  setCookie(c, 'llamenos-session-id', sessionId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Strict',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  })

  return c.json(
    {
      ok: true,
      roles: ['role-super-admin'],
      nsecSecret: nsecSecretHex,
      accessToken,
    },
    200
  )
})

// --- Authenticated routes ---
auth.use('/me', authMiddleware)
auth.use('/me/*', authMiddleware)

// ── GET /me — Get current user profile ──

const getMeRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Auth'],
  summary: 'Get current user profile',
  responses: {
    200: {
      description: 'User profile',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
})

auth.openapi(getMeRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const user = c.get('user')
  const permissions = c.get('permissions')
  const allRoles = c.get('allRoles')

  const webauthnCreds: WebAuthnCredential[] = await services.identity.getWebAuthnCredentials(pubkey)
  const webauthnSettings = await services.identity.getWebAuthnSettings()

  const isAdmin = checkPermission(permissions, 'settings:manage')
  const webauthnRequired = isAdmin
    ? webauthnSettings.requireForAdmins
    : webauthnSettings.requireForUsers

  const primaryRole = getPrimaryRole(user.roles, allRoles)

  // Resolve admin decryption pubkey from DB (actual super-admin) instead of stale env var.
  const superAdminPubkeys = await services.identity.getSuperAdminPubkeys()
  const adminDecryptionPubkey =
    c.env.ADMIN_DECRYPTION_PUBKEY || superAdminPubkeys[0] || c.env.ADMIN_PUBKEY

  const meResponse: Record<string, unknown> = {
    pubkey: user.pubkey,
    roles: user.roles,
    hubRoles: user.hubRoles ?? [],
    permissions,
    primaryRole: primaryRole ? { id: primaryRole.id, name: primaryRole.name } : null,
    name: user.name,
    phone: maskPhone(user.phone),
    transcriptionEnabled: user.transcriptionEnabled,
    spokenLanguages: user.spokenLanguages || ['en'],
    uiLanguage: user.uiLanguage || 'en',
    profileCompleted: user.profileCompleted ?? true,
    onBreak: user.onBreak ?? false,
    callPreference: user.callPreference ?? 'phone',
    webauthnRequired,
    webauthnRegistered: webauthnCreds.length > 0,
    adminDecryptionPubkey,
  }
  if (user.encryptedName !== undefined) meResponse.encryptedName = user.encryptedName
  if (user.nameEnvelopes !== undefined) meResponse.nameEnvelopes = user.nameEnvelopes

  return c.json(meResponse, 200)
})

// ── POST /me/logout ──

const logoutRoute = createRoute({
  method: 'post',
  path: '/me/logout',
  tags: ['Auth'],
  summary: 'Log out',
  responses: {
    200: {
      description: 'Logged out',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

auth.openapi(logoutRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  await services.records.addAuditEntry('global', 'logout', pubkey)
  return c.json({ ok: true }, 200)
})

// ── PATCH /me/profile ──

const updateProfileRoute = createRoute({
  method: 'patch',
  path: '/me/profile',
  tags: ['Auth'],
  summary: 'Update own profile',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().optional(),
            phone: z.string().optional(),
            spokenLanguages: z.array(z.string()).optional(),
            uiLanguage: z.string().optional(),
            profileCompleted: z.boolean().optional(),
            callPreference: z.enum(['phone', 'browser', 'both']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Profile updated',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    400: {
      description: 'Invalid phone number',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

auth.openapi(updateProfileRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  if (body.phone && !isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 400)
  }
  await services.identity.updateUser(pubkey, body)
  return c.json({ ok: true }, 200)
})

// ── PATCH /me/availability ──

const updateAvailabilityRoute = createRoute({
  method: 'patch',
  path: '/me/availability',
  tags: ['Auth'],
  summary: 'Toggle break status',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ onBreak: z.boolean() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Availability updated',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

auth.openapi(updateAvailabilityRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  await services.identity.updateUser(pubkey, { onBreak: body.onBreak })
  await services.records.addAuditEntry(
    'global',
    body.onBreak ? 'userOnBreak' : 'userAvailable',
    pubkey
  )
  return c.json({ ok: true }, 200)
})

// ── PATCH /me/transcription ──

const updateTranscriptionRoute = createRoute({
  method: 'patch',
  path: '/me/transcription',
  tags: ['Auth'],
  summary: 'Toggle transcription',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ enabled: z.boolean() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Transcription preference updated',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    403: {
      description: 'Opt-out not allowed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

auth.openapi(updateTranscriptionRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const permissions = c.get('permissions')
  const body = c.req.valid('json')
  // If user is trying to disable, check if admin allows opt-out
  if (!body.enabled && !checkPermission(permissions, 'settings:manage-transcription')) {
    const transSettings = await services.settings.getTranscriptionSettings()
    if (!transSettings.allowUserOptOut) {
      return c.json({ error: 'Transcription opt-out is not allowed' }, 403)
    }
  }
  await services.identity.updateUser(pubkey, { transcriptionEnabled: body.enabled })
  await services.records.addAuditEntry('global', 'transcriptionToggled', pubkey, {
    enabled: body.enabled,
  })
  return c.json({ ok: true }, 200)
})

export default auth
