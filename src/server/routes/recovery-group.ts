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
 *   POST /enroll          — admin enrolls a 2-of-N Shamir recovery group for a hub
 *   GET  /:hubId          — get recovery group info for a hub
 *   POST /initiate        — user initiates a recovery session (no auth required)
 *   POST /contribute-share — admin contributes their Shamir share
 *   GET  /session/:id     — get recovery session status
 *   POST /complete        — user completes recovery after 24h delay
 *   POST /user-envelope   — user stores their recovery envelope for a hub
 */
import { Hono } from 'hono'
import { createLogger } from '../lib/logger'
import type { RecoveryGroupService } from '../services/recovery-group-service'
import { RecoveryGroupDelayError } from '../services/recovery-group-service'

const log = createLogger('routes.recovery-group')

interface RecoveryGroupEnv {
  Variables: {
    pubkey: string
    recoveryGroupService: RecoveryGroupService
    identityService: { findByIdentifier: (id: string) => Promise<{ pubkey: string } | null> }
  }
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

// --- GET /:hubId ---

recoveryGroupRoutes.get('/:hubId', async (c) => {
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

recoveryGroupRoutes.post('/initiate', async (c) => {
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

// --- GET /session/:id ---

recoveryGroupRoutes.get('/session/:id', async (c) => {
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
