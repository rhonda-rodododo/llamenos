import {
  RecoveryCompleteSchema,
  RecoveryContributeShareSchema,
  RecoveryGroupEnrollSchema,
  RecoveryInitiateSchema,
  UserRecoveryEnvelopeSchema,
} from '@shared/schemas/recovery-group'
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
 */
import { Hono } from 'hono'
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
// JWT middleware — mirrors auth-facade.ts jwtAuth, typed for this sub-router.
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

export const recoveryGroupRoutes = new Hono<RecoveryGroupEnv>()

// --- POST /enroll (admin only, jwtAuth middleware applied at mount point) ---

recoveryGroupRoutes.post('/enroll', async (c) => {
  const body = await c.req.json()
  const parsed = RecoveryGroupEnrollSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  }
  const service = c.get('recoveryGroupService')
  try {
    await service.enrollHub({
      hubId: parsed.data.hubId,
      threshold: parsed.data.threshold,
      totalShares: parsed.data.totalShares,
      groupPublicKey: parsed.data.groupPublicKey,
      shareEnvelopes: parsed.data.shareEnvelopes,
      shareCommitments: parsed.data.shareCommitments,
    })
    return c.json({ ok: true }, 200)
  } catch (err) {
    log.error('enrollHub error', err instanceof Error ? err : new Error(String(err)))
    return c.json({ error: (err as Error).message }, 500)
  }
})

// --- GET /:hubId (auth required) ---

recoveryGroupRoutes.get('/:hubId', jwtAuth, async (c) => {
  const hubId = c.req.param('hubId')
  const service = c.get('recoveryGroupService')
  const group = await service.getGroup(hubId)
  if (!group) return c.json({ error: 'no recovery group for this hub' }, 404)
  return c.json({
    hubId: group.hubId,
    groupPublicKey: group.groupPublicKey,
    threshold: group.threshold,
    totalShares: group.totalShares,
    shareCommitments: group.shareCommitments,
    createdAt: group.createdAt.toISOString(),
    rotatedAt: group.rotatedAt?.toISOString() ?? null,
  })
})

// --- POST /initiate (no auth required — recovering user has no credentials) ---
// Per-IP rate limited: 10 req/5min to block enumeration + DB DoS.

recoveryGroupRoutes.post('/initiate', async (c) => {
  const ip = clientIp(c)
  if (isInitiateRateLimited(ip)) {
    return c.json({ error: 'Too many recovery attempts. Try again later.' }, 429)
  }
  const body = await c.req.json()
  const parsed = RecoveryInitiateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  }
  const service = c.get('recoveryGroupService')

  // Look up user by identifier (email, pubkey, etc.)
  const identity = c.get('identityService')
  const user = await identity.findByIdentifier(parsed.data.userIdentifier)
  if (!user) return c.json({ error: 'user not found' }, 404)

  // Verify hub has a recovery group
  const group = await service.getGroup(parsed.data.hubId)
  if (!group) return c.json({ error: 'no recovery group for this hub' }, 404)

  const session = await service.initiateRecovery({
    hubId: parsed.data.hubId,
    userPubkey: user.pubkey,
    newDevicePubkey: parsed.data.newDevicePubkey,
    coordinatorPubkey: parsed.data.newDevicePubkey,
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

// --- POST /contribute-share (admin only) ---

recoveryGroupRoutes.post('/contribute-share', async (c) => {
  const body = await c.req.json()
  const parsed = RecoveryContributeShareSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  }
  const service = c.get('recoveryGroupService')
  const adminPubkey = c.get('pubkey')
  try {
    const result = await service.contributeShare({
      sessionId: parsed.data.sessionId,
      byAdminPubkey: adminPubkey,
      encryptedShare: parsed.data.encryptedShare,
    })
    return c.json(
      { ok: true, status: result.status, contributionCount: result.contributionCount },
      200
    )
  } catch (err) {
    log.error('contributeShare error', err instanceof Error ? err : new Error(String(err)))
    return c.json({ error: (err as Error).message }, 400)
  }
})

// --- GET /session/:id (auth required) ---

recoveryGroupRoutes.get('/session/:id', jwtAuth, async (c) => {
  const sessionId = c.req.param('id')
  const service = c.get('recoveryGroupService')
  const session = await service.getSession(sessionId)
  if (!session) return c.json({ error: 'session not found' }, 404)

  const group = await service.getGroup(session.hubId)
  const contributions = session.contributions as { byAdminPubkey: string; encryptedShare: string }[]
  const delayRemainingMs = Math.max(
    0,
    24 * 60 * 60 * 1000 - (Date.now() - session.createdAt.getTime())
  )

  return c.json({
    sessionId: session.sessionId,
    hubId: session.hubId,
    status: session.status,
    contributionCount: contributions.length,
    threshold: group?.threshold ?? 2,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    delayRemainingMs,
  })
})

// --- POST /complete ---

recoveryGroupRoutes.post('/complete', async (c) => {
  const body = await c.req.json()
  const parsed = RecoveryCompleteSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  }
  const service = c.get('recoveryGroupService')
  try {
    await service.completeRecovery({
      sessionId: parsed.data.sessionId,
      emergencyOverride: parsed.data.emergencyOverride,
    })
    return c.json({ ok: true }, 200)
  } catch (err) {
    if (err instanceof RecoveryGroupDelayError) {
      return c.json({ error: err.message, delayRemainingMs: err.remainingMs }, 403)
    }
    log.error('completeRecovery error', err instanceof Error ? err : new Error(String(err)))
    return c.json({ error: (err as Error).message }, 403)
  }
})

// --- POST /user-envelope (authenticated user stores their recovery envelope) ---

recoveryGroupRoutes.post('/user-envelope', async (c) => {
  const body = await c.req.json()
  const parsed = UserRecoveryEnvelopeSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  }
  const service = c.get('recoveryGroupService')
  const pubkey = c.get('pubkey')
  await service.putUserRecoveryEnvelope(pubkey, parsed.data.hubId, parsed.data.envelope)
  return c.json({ ok: true }, 200)
})
