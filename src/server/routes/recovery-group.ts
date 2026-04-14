/**
 * Recovery Group API routes — mounted under `/api/auth/recovery-group/*`.
 *
 * Endpoints:
 *   POST /enroll          — admin enrolls a 2-of-N Shamir recovery group (auth required)
 *   GET  /:hubId          — get recovery group info for a hub           (auth required)
 *   POST /initiate        — user initiates a recovery session            (no auth, per-IP rate limited)
 *   POST /contribute-share — admin contributes their Shamir share        (auth required)
 *   GET  /session/:id     — get recovery session status                  (auth required)
 *   POST /complete        — user completes recovery after 24h delay      (no auth)
 *   POST /user-envelope   — user stores their recovery envelope          (auth required)
 *
 * Auth rationale: GET /:hubId and GET /session/:id leak the recovery-group
 *   configuration (threshold, total shares, group public key) and ongoing
 *   session state — that is admin/user-visible metadata, never anonymous.
 *
 * Rate-limit rationale: POST /initiate is anonymous because the recovering
 *   user has no credentials. Without a per-IP cap an attacker could spray
 *   initiation attempts to enumerate user identifiers, exhaust session rows
 *   in the DB, or grief the threshold ceremony.
 *
 * This router is an `OpenAPIHono` instance: every endpoint is declared via
 * `createRoute()` with zod request/response schemas, so the OpenAPI spec at
 * `/api/openapi.json` documents the full recovery surface and Scalar picks
 * it up automatically.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  RecoveryCompleteResponseSchema,
  RecoveryCompleteSchema,
  RecoveryContributeShareResponseSchema,
  RecoveryContributeShareSchema,
  RecoveryGroupEnrollResponseSchema,
  RecoveryGroupEnrollSchema,
  RecoveryGroupInfoSchema,
  RecoveryInitiateResponseSchema,
  RecoveryInitiateSchema,
  RecoverySessionStatusSchema,
  UserRecoveryEnvelopeResponseSchema,
  UserRecoveryEnvelopeSchema,
} from '@shared/schemas/recovery-group'
import { createMiddleware } from 'hono/factory'
import { verifyAccessToken } from '../lib/jwt'
import { createLogger } from '../lib/logger'
import type { RecoveryGroupService } from '../services/recovery-group-service'
import { RecoveryGroupDelayError } from '../services/recovery-group-service'

const log = createLogger('routes.recovery-group')

interface RecoveryGroupEnv {
  Bindings: {
    JWT_SECRET: string
  }
  Variables: {
    pubkey: string
    permissions: string[]
    recoveryGroupService: RecoveryGroupService
    identityService: { findByIdentifier: (id: string) => Promise<{ pubkey: string } | null> }
  }
}

// ---------------------------------------------------------------------------
// Shared error response schema
// ---------------------------------------------------------------------------
const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
  delayRemainingMs: z.number().int().optional(),
})

// ---------------------------------------------------------------------------
// Path param schemas
// ---------------------------------------------------------------------------
const HubIdParamSchema = z.object({
  hubId: z
    .string()
    .uuid()
    .openapi({
      param: { name: 'hubId', in: 'path' },
      example: '11111111-2222-4333-8444-555555555555',
    }),
})

const SessionIdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: 'id', in: 'path' },
      example: '22222222-3333-4444-8555-666666666666',
    }),
})

// ---------------------------------------------------------------------------
// JWT middleware — mirrors auth-facade.ts jwtAuth, typed for this sub-router.
// Used on the two GET endpoints that must remain authenticated even though
// the parent router does not apply auth to them at mount level.
// ---------------------------------------------------------------------------
const jwtAuth = createMiddleware<RecoveryGroupEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const token = header.slice(7)
  try {
    const payload = await verifyAccessToken(token, c.env.JWT_SECRET)
    c.set('pubkey', payload.sub)
    c.set('permissions', payload.permissions ?? [])
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
})

// ---------------------------------------------------------------------------
// Per-IP rate limiter for POST /initiate.
//
// Sliding 5-minute window, 10 requests per IP. At 10 attempts / 5 min an
// attacker cannot practically enumerate user identifiers or DoS the
// recovery-session table without triggering the 429 wall. The table is
// bounded at MAX_IP_ENTRIES to prevent unbounded memory growth under
// IP-spraying; we evict the oldest (insertion-order) entry once the cap
// is hit, which is safe since window entries are short-lived anyway.
// ---------------------------------------------------------------------------
const INITIATE_WINDOW_MS = 5 * 60 * 1000
const INITIATE_MAX_PER_WINDOW = 10
const MAX_INITIATE_IP_ENTRIES = 10_000
const initiateRate = new Map<string, { count: number; resetAt: number }>()

function pruneExpiredInitiate(now: number): void {
  for (const [ip, entry] of initiateRate) {
    if (now >= entry.resetAt) initiateRate.delete(ip)
  }
}

function isInitiateRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = initiateRate.get(ip)
  if (!entry || now >= entry.resetAt) {
    if (initiateRate.size >= MAX_INITIATE_IP_ENTRIES) {
      pruneExpiredInitiate(now)
      if (initiateRate.size >= MAX_INITIATE_IP_ENTRIES) {
        const oldest = initiateRate.keys().next().value
        if (oldest !== undefined) initiateRate.delete(oldest)
      }
    }
    initiateRate.set(ip, { count: 1, resetAt: now + INITIATE_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > INITIATE_MAX_PER_WINDOW
}

/** Test-only hook to reset the in-process rate-limit state between suites. */
export function __resetInitiateRateLimitForTests(): void {
  initiateRate.clear()
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown'
  )
}

// ---------------------------------------------------------------------------
// Router instance with standard zod-validation-failure hook (mirrors
// `createRouter()` in ../lib/openapi.ts, but bound to the route-local
// `RecoveryGroupEnv` context instead of the global `AppEnv`).
// ---------------------------------------------------------------------------
export const recoveryGroupRoutes = new OpenAPIHono<RecoveryGroupEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      return c.json({ error: `Validation failed: ${issues.join('; ')}` }, 400)
    }
  },
})

// ---------------------------------------------------------------------------
// POST /enroll (admin only — auth enforced at mount point by auth-facade)
// ---------------------------------------------------------------------------
const enrollRoute = createRoute({
  method: 'post',
  path: '/enroll',
  tags: ['recovery-group'],
  summary: 'Enroll a 2-of-N Shamir recovery group for a hub',
  request: {
    body: {
      content: { 'application/json': { schema: RecoveryGroupEnrollSchema } },
    },
  },
  responses: {
    200: {
      description: 'Recovery group enrolled',
      content: { 'application/json': { schema: RecoveryGroupEnrollResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
      description: 'Enrollment failed',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

recoveryGroupRoutes.openapi(enrollRoute, async (c) => {
  const body = c.req.valid('json')
  const service = c.get('recoveryGroupService')
  try {
    await service.enrollHub({
      hubId: body.hubId,
      threshold: body.threshold,
      totalShares: body.totalShares,
      groupPublicKey: body.groupPublicKey,
      shareEnvelopes: body.shareEnvelopes,
      shareCommitments: body.shareCommitments,
    })
    return c.json({ ok: true as const }, 200)
  } catch (err) {
    log.error('enrollHub error', err instanceof Error ? err : new Error(String(err)))
    return c.json({ error: (err as Error).message }, 500)
  }
})

// ---------------------------------------------------------------------------
// GET /:hubId (auth required — leaks group config if anonymous)
// ---------------------------------------------------------------------------
const getGroupRoute = createRoute({
  method: 'get',
  path: '/{hubId}',
  tags: ['recovery-group'],
  summary: 'Get recovery group config for a hub',
  middleware: [jwtAuth] as const,
  request: { params: HubIdParamSchema },
  responses: {
    200: {
      description: 'Recovery group info',
      content: { 'application/json': { schema: RecoveryGroupInfoSchema } },
    },
    401: {
      description: 'Missing or invalid bearer token',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'No recovery group for this hub',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

recoveryGroupRoutes.openapi(getGroupRoute, async (c) => {
  const { hubId } = c.req.valid('param')
  const service = c.get('recoveryGroupService')
  const group = await service.getGroup(hubId)
  if (!group) return c.json({ error: 'no recovery group for this hub' }, 404)
  return c.json(
    {
      hubId: group.hubId,
      groupPublicKey: group.groupPublicKey,
      threshold: group.threshold,
      totalShares: group.totalShares,
      shareCommitments: group.shareCommitments,
      createdAt: group.createdAt.toISOString(),
      rotatedAt: group.rotatedAt?.toISOString() ?? null,
    },
    200
  )
})

// ---------------------------------------------------------------------------
// POST /initiate (no auth — recovering user has no credentials)
// Per-IP rate limited: 10 req/5min to block enumeration + DB DoS.
// ---------------------------------------------------------------------------
const initiateRoute = createRoute({
  method: 'post',
  path: '/initiate',
  tags: ['recovery-group'],
  summary: 'Initiate a recovery session (unauthenticated, rate-limited)',
  request: {
    body: {
      content: { 'application/json': { schema: RecoveryInitiateSchema } },
    },
  },
  responses: {
    200: {
      description: 'Recovery session opened',
      content: { 'application/json': { schema: RecoveryInitiateResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'User or recovery group not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    429: {
      description: 'Too many recovery attempts from this IP',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

recoveryGroupRoutes.openapi(initiateRoute, async (c) => {
  const ip = clientIp(c)
  if (isInitiateRateLimited(ip)) {
    return c.json({ error: 'Too many recovery attempts. Try again later.' }, 429)
  }
  const body = c.req.valid('json')
  const service = c.get('recoveryGroupService')

  // Look up user by identifier (email, pubkey, etc.)
  const identity = c.get('identityService')
  const user = await identity.findByIdentifier(body.userIdentifier)
  if (!user) return c.json({ error: 'user not found' }, 404)

  // Verify hub has a recovery group
  const group = await service.getGroup(body.hubId)
  if (!group) return c.json({ error: 'no recovery group for this hub' }, 404)

  const session = await service.initiateRecovery({
    hubId: body.hubId,
    userPubkey: user.pubkey,
    newDevicePubkey: body.newDevicePubkey,
    coordinatorPubkey: body.newDevicePubkey,
  })

  return c.json(
    {
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      coordinatorPubkey: session.coordinatorPubkey,
    },
    200
  )
})

// ---------------------------------------------------------------------------
// POST /contribute-share (admin only — auth enforced at mount point)
// ---------------------------------------------------------------------------
const contributeShareRoute = createRoute({
  method: 'post',
  path: '/contribute-share',
  tags: ['recovery-group'],
  summary: 'Contribute an admin Shamir share to a recovery session',
  request: {
    body: {
      content: { 'application/json': { schema: RecoveryContributeShareSchema } },
    },
  },
  responses: {
    200: {
      description: 'Share accepted',
      content: { 'application/json': { schema: RecoveryContributeShareResponseSchema } },
    },
    400: {
      description: 'Validation error or share rejected',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

recoveryGroupRoutes.openapi(contributeShareRoute, async (c) => {
  const body = c.req.valid('json')
  const service = c.get('recoveryGroupService')
  const adminPubkey = c.get('pubkey')
  try {
    const result = await service.contributeShare({
      sessionId: body.sessionId,
      byAdminPubkey: adminPubkey,
      encryptedShare: body.encryptedShare,
    })
    return c.json(
      {
        ok: true as const,
        status: result.status as 'pending' | 'ready',
        contributionCount: result.contributionCount,
      },
      200
    )
  } catch (err) {
    log.error('contributeShare error', err instanceof Error ? err : new Error(String(err)))
    return c.json({ error: (err as Error).message }, 400)
  }
})

// ---------------------------------------------------------------------------
// GET /session/:id (auth required — leaks session state if anonymous)
// ---------------------------------------------------------------------------
const getSessionRoute = createRoute({
  method: 'get',
  path: '/session/{id}',
  tags: ['recovery-group'],
  summary: 'Get recovery session status',
  middleware: [jwtAuth] as const,
  request: { params: SessionIdParamSchema },
  responses: {
    200: {
      description: 'Recovery session status',
      content: { 'application/json': { schema: RecoverySessionStatusSchema } },
    },
    401: {
      description: 'Missing or invalid bearer token',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'Session not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

recoveryGroupRoutes.openapi(getSessionRoute, async (c) => {
  const { id: sessionId } = c.req.valid('param')
  const service = c.get('recoveryGroupService')
  const session = await service.getSession(sessionId)
  if (!session) return c.json({ error: 'session not found' }, 404)

  const group = await service.getGroup(session.hubId)
  const contributions = session.contributions as { byAdminPubkey: string; encryptedShare: string }[]
  const delayRemainingMs = Math.max(
    0,
    24 * 60 * 60 * 1000 - (Date.now() - session.createdAt.getTime())
  )

  return c.json(
    {
      sessionId: session.sessionId,
      hubId: session.hubId,
      status: session.status as 'pending' | 'ready' | 'completed' | 'expired' | 'cancelled',
      contributionCount: contributions.length,
      threshold: group?.threshold ?? 2,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      delayRemainingMs,
    },
    200
  )
})

// ---------------------------------------------------------------------------
// POST /complete (no auth — recovering user has no credentials)
// ---------------------------------------------------------------------------
const completeRoute = createRoute({
  method: 'post',
  path: '/complete',
  tags: ['recovery-group'],
  summary: 'Complete recovery (after 24h delay or emergency override)',
  request: {
    body: {
      content: { 'application/json': { schema: RecoveryCompleteSchema } },
    },
  },
  responses: {
    200: {
      description: 'Recovery completed',
      content: { 'application/json': { schema: RecoveryCompleteResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    403: {
      description: 'Delay not yet elapsed or ceremony rejected',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

recoveryGroupRoutes.openapi(completeRoute, async (c) => {
  const body = c.req.valid('json')
  const service = c.get('recoveryGroupService')
  try {
    await service.completeRecovery({
      sessionId: body.sessionId,
      emergencyOverride: body.emergencyOverride,
    })
    return c.json({ ok: true as const }, 200)
  } catch (err) {
    if (err instanceof RecoveryGroupDelayError) {
      return c.json({ error: err.message, delayRemainingMs: err.remainingMs }, 403)
    }
    log.error('completeRecovery error', err instanceof Error ? err : new Error(String(err)))
    return c.json({ error: (err as Error).message }, 403)
  }
})

// ---------------------------------------------------------------------------
// POST /user-envelope (authenticated user stores their recovery envelope)
// ---------------------------------------------------------------------------
const userEnvelopeRoute = createRoute({
  method: 'post',
  path: '/user-envelope',
  tags: ['recovery-group'],
  summary: 'Store the user-side recovery envelope for a hub',
  request: {
    body: {
      content: { 'application/json': { schema: UserRecoveryEnvelopeSchema } },
    },
  },
  responses: {
    200: {
      description: 'Envelope stored',
      content: { 'application/json': { schema: UserRecoveryEnvelopeResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

recoveryGroupRoutes.openapi(userEnvelopeRoute, async (c) => {
  const body = c.req.valid('json')
  const service = c.get('recoveryGroupService')
  const pubkey = c.get('pubkey')
  await service.putUserRecoveryEnvelope(pubkey, body.hubId, body.envelope)
  return c.json({ ok: true as const }, 200)
})
