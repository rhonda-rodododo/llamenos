import { createRoute, z } from '@hono/zod-openapi'
import { HMAC_IP_PREFIX } from '@shared/crypto-labels'
import { resolvePermissions } from '@shared/permissions'
import { setCookie } from 'hono/cookie'
import { getIdPAdapter } from '../app'
import { hashIP } from '../lib/crypto-service'
import { isValidE164 } from '../lib/helpers'
import { signAccessToken } from '../lib/jwt'
import { createRouter } from '../lib/openapi'
import { auth as authMiddleware } from '../middleware/auth'
import { requirePermission } from '../middleware/permission-guard'
import {
  type InviteDeliveryChannel,
  InviteDeliveryService,
} from '../services/invite-delivery-service'
import type { AppEnv } from '../types'

const invites = createRouter()

// --- Public routes (no auth) ---

// ── GET /validate/{code} — Validate invite code ──

const validateRoute = createRoute({
  method: 'get',
  path: '/validate/{code}',
  tags: ['Invites'],
  summary: 'Validate an invite code',
  request: {
    params: z.object({
      code: z.string().openapi({ param: { name: 'code', in: 'path' }, example: 'abc123' }),
    }),
  },
  responses: {
    200: {
      description: 'Validation result',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

invites.openapi(validateRoute, async (c) => {
  const services = c.get('services')
  const { code } = c.req.valid('param')
  // Rate limit invite validation to prevent enumeration
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const limited = await services.settings.checkRateLimit(
    `invite-validate:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
    5
  )
  if (limited) return c.json({ error: 'Too many requests' }, 429)
  const result = await services.identity.validateInvite(code)
  return c.json(result, 200)
})

// ── POST /redeem — Redeem invite code ──

const redeemRoute = createRoute({
  method: 'post',
  path: '/redeem',
  tags: ['Invites'],
  summary: 'Redeem an invite code',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            code: z.string(),
            pubkey: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invite redeemed',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
    400: {
      description: 'Missing fields',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    429: {
      description: 'Rate limited',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

invites.openapi(redeemRoute, async (c) => {
  const services = c.get('services')
  const body = c.req.valid('json')

  if (!body.pubkey || !body.code) {
    return c.json({ error: 'Missing code or pubkey' }, 400)
  }

  // Rate limit redemption attempts (relaxed in dev for parallel test runs)
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const maxAttempts = c.env.ENVIRONMENT === 'development' ? 50 : 5
  const limited = await services.settings.checkRateLimit(
    `invite-redeem:${services.crypto.hmac(clientIp, HMAC_IP_PREFIX).slice(0, 24)}`,
    maxAttempts
  )
  if (limited) return c.json({ error: 'Too many requests' }, 429)

  const user = await services.identity.redeemInvite({ code: body.code, pubkey: body.pubkey })

  // Auto-assign new user to the default hub (single-hub deployment) and distribute hub key
  try {
    const allHubs = await services.settings.getHubs()
    const activeHubs = allHubs.filter((h) => h.status === 'active')
    if (activeHubs.length >= 1) {
      const defaultHub = activeHubs[0]
      // Assign user to the hub with the same roles from the invite
      await services.identity.setHubRole({
        pubkey: body.pubkey,
        hubId: defaultHub.id,
        roleIds: user.roles,
      })
      // Distribute hub key envelope: unwrap server's copy, re-wrap for new member
      const existingEnvelopes = await services.settings.getHubKeyEnvelopes(defaultHub.id)
      if (existingEnvelopes.length > 0) {
        const newEnvelope = services.crypto.wrapHubKeyForNewMember(existingEnvelopes, body.pubkey)
        await services.settings.setHubKeyEnvelopes(defaultHub.id, [
          ...existingEnvelopes,
          newEnvelope,
        ])
      }
    }
  } catch {
    // Non-fatal — hub assignment or key distribution failure shouldn't block invite redemption
  }

  // Enroll the new user in the IdP and return their nsecSecret for KEK derivation
  let nsecSecret: string | null = null
  const idpAdapter = getIdPAdapter()
  if (idpAdapter) {
    try {
      const existing = await idpAdapter.getUser(body.pubkey)
      if (!existing) {
        await idpAdapter.createUser(body.pubkey)
      }
      const secret = await idpAdapter.getNsecSecret(body.pubkey)
      nsecSecret = Buffer.from(secret).toString('hex')
    } catch {
      // IdP enrollment failed — client will use synthetic value and rotate on first unlock
    }
  }

  // Issue a JWT so the client can call authenticated endpoints (e.g. getMe) immediately
  const allRoles = await services.settings.listRoles()
  const permissions = resolvePermissions(user.roles, allRoles)
  const accessToken = await signAccessToken(
    { pubkey: body.pubkey, permissions: [...new Set(permissions)] },
    c.env.JWT_SECRET
  )

  // Set refresh cookie so PIN unlock works after page reload (matches bootstrap pattern)
  const { createUserSession } = await import('./auth-facade')
  const sessionIp =
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('CF-Connecting-IP') ||
    'unknown'
  const { sessionId, token: refreshToken } = await createUserSession({
    pubkey: body.pubkey,
    credentialId: null,
    clientIp: sessionIp,
    userAgent: c.req.header('User-Agent') || '',
    ipHash: hashIP(sessionIp, c.env.HMAC_SECRET),
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

  return c.json({ ...user, nsecSecret, accessToken }, 200)
})

// --- Authenticated routes (require invites permissions) ---

// ── GET / — List invites ──

const listInvitesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Invites'],
  summary: 'List all invites',
  middleware: [authMiddleware, requirePermission('invites:read')],
  responses: {
    200: {
      description: 'Invite list',
      content: {
        'application/json': {
          schema: z.object({ invites: z.array(z.object({}).passthrough()) }),
        },
      },
    },
  },
})

invites.openapi(listInvitesRoute, async (c) => {
  const services = c.get('services')
  const inviteList = await services.identity.getInvites()
  return c.json({ invites: inviteList }, 200)
})

// ── GET /available-channels — Check configured messaging channels for delivery ──

const availableChannelsRoute = createRoute({
  method: 'get',
  path: '/available-channels',
  tags: ['Invites'],
  summary: 'Get available invite delivery channels',
  middleware: [authMiddleware, requirePermission('invites:create')],
  responses: {
    200: {
      description: 'Available channels',
      content: {
        'application/json': {
          schema: z.object({
            signal: z.boolean(),
            whatsapp: z.boolean(),
            sms: z.boolean(),
          }),
        },
      },
    },
  },
})

invites.openapi(availableChannelsRoute, async (c) => {
  const services = c.get('services')
  const config = await services.settings.getMessagingConfig()
  return c.json(
    {
      signal: config.enabledChannels.includes('signal') && !!config.signal,
      whatsapp: config.enabledChannels.includes('whatsapp') && !!config.whatsapp,
      sms: config.enabledChannels.includes('sms') && !!config.sms?.enabled,
    },
    200
  )
})

// ── POST / — Create invite ──

const createInviteRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Invites'],
  summary: 'Create a new invite',
  middleware: [authMiddleware, requirePermission('invites:create')],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string(),
            phone: z.string().optional(),
            roleIds: z.array(z.string()),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Invite created',
      content: {
        'application/json': {
          schema: z.object({ invite: z.object({}).passthrough() }),
        },
      },
    },
    400: {
      description: 'Invalid phone number',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

invites.openapi(createInviteRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const body = c.req.valid('json')
  if (body.phone && !isValidE164(body.phone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 400)
  }
  const invite = await services.identity.createInvite({
    name: body.name,
    phone: body.phone ?? '',
    roleIds: body.roleIds,
    createdBy: pubkey,
  })
  await services.records.addAuditEntry('global', 'inviteCreated', pubkey, { name: body.name })
  return c.json({ invite }, 201)
})

// ── POST /{code}/send — Deliver invite via secure messaging channel ──

const sendInviteRoute = createRoute({
  method: 'post',
  path: '/{code}/send',
  tags: ['Invites'],
  summary: 'Send invite via messaging channel',
  middleware: [authMiddleware, requirePermission('invites:create')],
  request: {
    params: z.object({
      code: z.string().openapi({ param: { name: 'code', in: 'path' } }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            recipientPhone: z.string(),
            channel: z.enum(['signal']),
            acknowledgedInsecure: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invite sent',
      content: {
        'application/json': {
          schema: z.object({ sent: z.boolean(), channel: z.string() }),
        },
      },
    },
    400: {
      description: 'Invalid request (e.g. non-Signal channel)',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: 'Invite not found',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    410: {
      description: 'Invite expired',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: z.object({ error: z.string() }).passthrough() } },
    },
    502: {
      description: 'Delivery failed',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

invites.openapi(sendInviteRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const { code } = c.req.valid('param')

  const body = c.req.valid('json')

  // User invites are Signal-only (encrypted, zero-knowledge notification path)
  if (body.channel !== 'signal') {
    return c.json({ error: 'User invites can only be delivered via Signal.' }, 400)
  }

  // Validate phone format
  if (!body.recipientPhone || !isValidE164(body.recipientPhone)) {
    return c.json({ error: 'Invalid phone number. Use E.164 format (e.g. +12125551234)' }, 422)
  }

  // User invites are Signal-only. Kept for historical fallback, unreachable in practice.
  if ((body.channel as string) === 'sms' && !body.acknowledgedInsecure) {
    return c.json(
      {
        error: 'SMS is not end-to-end encrypted. Set acknowledgedInsecure: true to proceed.',
        requiresAcknowledgment: true,
      },
      422
    )
  }

  // Validate invite exists and is not expired or already used
  const validation = await services.identity.validateInvite(code)
  if (!validation.valid) {
    if (validation.error === 'expired') {
      return c.json({ error: 'expired' }, 410)
    }
    return c.json({ error: validation.error ?? 'Invalid invite' }, 404)
  }

  // Look up full invite to get expiresAt
  const inviteList = await services.identity.getInvites()
  const invite = inviteList.find((i) => i.code === code)
  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404)
  }

  const appUrl = c.env.APP_URL || `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`

  const deliveryService = new InviteDeliveryService(services.settings)

  let deliveryResult: Awaited<ReturnType<typeof deliveryService.sendInvite>>
  try {
    deliveryResult = await deliveryService.sendInvite({
      recipientPhone: body.recipientPhone,
      inviteCode: code,
      channel: body.channel,
      expiresAt: new Date(invite.expiresAt),
      appUrl,
      crypto: services.crypto,
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to send invite' }, 502)
  }

  // Record delivery metadata — phone as HMAC hash, never plaintext
  await services.identity.updateInviteDelivery(code, {
    recipientPhoneHash: deliveryResult.recipientPhoneHash,
    deliveryChannel: deliveryResult.channel,
    deliverySentAt: new Date(),
  })

  await services.records.addAuditEntry('global', 'inviteSent', pubkey, {
    code,
    channel: deliveryResult.channel,
  })

  return c.json({ sent: true, channel: deliveryResult.channel }, 200)
})

// ── DELETE /{code} — Revoke invite ──

const revokeInviteRoute = createRoute({
  method: 'delete',
  path: '/{code}',
  tags: ['Invites'],
  summary: 'Revoke an invite',
  middleware: [authMiddleware, requirePermission('invites:revoke')],
  request: {
    params: z.object({
      code: z.string().openapi({ param: { name: 'code', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      description: 'Invite revoked',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
})

invites.openapi(revokeInviteRoute, async (c) => {
  const services = c.get('services')
  const pubkey = c.get('pubkey')
  const { code } = c.req.valid('param')
  await services.identity.revokeInvite(code)
  await services.records.addAuditEntry('global', 'inviteRevoked', pubkey, { code })
  return c.json({ ok: true }, 200)
})

export default invites
