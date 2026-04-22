import { Hono } from 'hono'
import { getIdPAdapter } from '../app'
import type { AppEnv } from '../types'

const dev = new Hono<AppEnv>()

dev.post('/test-reset', async (c) => {
  // Full reset: development and demo only — too destructive for staging
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  // HIGH-W4: When secret is not configured, return 404 (hide endpoint existence).
  // When secret IS configured but header is wrong, return 403 (endpoint known, access denied).
  const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
  if (!secret) return c.json({ error: 'Not Found' }, 404)
  if (c.req.header('X-Test-Secret') !== secret) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const services = c.get('services')
  await services.tags.resetForTest('default-hub')
  await services.tags.resetForTest('global')
  await services.teams.resetForTest('default-hub')
  await services.intakes.resetForTest('default-hub')
  await services.blasts.resetForTest()
  await services.reportTypes.resetForTest()
  await services.contacts.resetForTest('default-hub')
  await services.identity.resetForTest()
  await services.records.resetForTest()
  await services.shifts.resetForTest()
  await services.calls.resetForTest()
  await services.conversations.resetForTest()
  await services.files.resetForTest('global')
  await services.settings.resetForTest()
  // Re-seed default roles before bootstrapping admin — resetForTest deletes all roles,
  // and bootstrapAdmin assigns role-super-admin which must exist for permission resolution
  await services.settings.listRoles()
  // Re-bootstrap admin and default hub so tests can log in immediately after reset
  if (c.env.ADMIN_PUBKEY) {
    try {
      await services.identity.bootstrapAdmin(c.env.ADMIN_PUBKEY)
      await services.identity.updateUser(c.env.ADMIN_PUBKEY, { profileCompleted: true })
    } catch {
      // Admin may already exist
    }
    // Enroll admin in IdP (Authentik) so JWT auth + userinfo work in tests
    const idp = getIdPAdapter()
    if (idp) {
      try {
        const existing = await idp.getUser(c.env.ADMIN_PUBKEY)
        if (!existing) await idp.createUser(c.env.ADMIN_PUBKEY)
      } catch {
        // IdP enrollment may fail or user may already exist
      }
    }
    // Create default hub with hub key envelopes so pages requiring hub context work
    try {
      const hub = await services.settings.createHub({
        id: 'default-hub',
        name: 'Default Hub',
        createdBy: c.env.ADMIN_PUBKEY,
      })
      // Assign admin to the hub
      await services.identity.setHubRole({
        pubkey: c.env.ADMIN_PUBKEY,
        hubId: hub.id,
        roleIds: ['role-super-admin'],
      })
      // Generate and distribute hub key — HPKE-wrap for admin so hub key cache works
      const { envelopes: hubKeyEnvelopes } = await services.hpke.generateAndWrapHubKey([
        new Uint8Array(32), // admin placeholder — real pubkey comes from client bootstrap
      ])
      await services.settings.setHubKeyEnvelopes(
        hub.id,
        hubKeyEnvelopes.map((e) => ({ pubkeyHex: e.pubkeyHex, envelope: e.envelope }))
      )
      // Mark setup as completed so the setup wizard doesn't intercept navigation
      await services.settings.updateSetupState({ setupCompleted: true })
    } catch {
      // Hub may already exist
    }
  }
  return c.json({ ok: true })
})

// Reset to a truly fresh state — no admin, no ADMIN_PUBKEY effect
// Used for testing in-browser admin bootstrap
dev.post('/test-reset-no-admin', async (c) => {
  // Full reset without admin: development and demo only
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
  if (!secret) return c.json({ error: 'Not Found' }, 404)
  if (c.req.header('X-Test-Secret') !== secret) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const services = c.get('services')
  await services.tags.resetForTest('default-hub')
  await services.tags.resetForTest('global')
  await services.teams.resetForTest('default-hub')
  await services.intakes.resetForTest('default-hub')
  await services.blasts.resetForTest()
  await services.reportTypes.resetForTest()
  await services.contacts.resetForTest('default-hub')
  await services.identity.resetForTest()
  await services.records.resetForTest()
  await services.shifts.resetForTest()
  await services.calls.resetForTest()
  await services.conversations.resetForTest()
  await services.files.resetForTest('global')
  await services.settings.resetForTest()
  // Delete the admin user so bootstrap tests see needsBootstrap=true
  if (c.env.ADMIN_PUBKEY) {
    try {
      await services.identity.deleteUser(c.env.ADMIN_PUBKEY)
    } catch {
      // May not exist
    }
  }
  return c.json({ ok: true })
})

// Light reset: only clears records, calls, conversations, and shifts
// Preserves identity (admin account) and settings (setup state)
// Used by live telephony E2E tests against staging
dev.post('/test-reset-records', async (c) => {
  const isDev = c.env.ENVIRONMENT === 'development'
  const isStaging =
    c.env.ENVIRONMENT === 'staging' &&
    c.env.E2E_TEST_SECRET &&
    c.req.header('X-Test-Secret') === c.env.E2E_TEST_SECRET
  if (!isDev && !isStaging) {
    return c.json({ error: 'Not Found' }, 404)
  }
  if (isDev) {
    const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
    if (!secret) return c.json({ error: 'Not Found' }, 404)
    if (c.req.header('X-Test-Secret') !== secret) {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }
  const services = c.get('services')
  await services.records.resetForTest()
  await services.shifts.resetForTest()
  await services.calls.resetForTest()
  await services.conversations.resetForTest()
  await services.files.resetForTest('global')
  return c.json({ ok: true })
})

// Light reset: only clears setup completion state
// Used by setup wizard E2E tests that need setupCompleted=false
dev.post('/test-reset-setup', async (c) => {
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
  if (!secret) return c.json({ error: 'Not Found' }, 404)
  if (c.req.header('X-Test-Secret') !== secret) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const services = c.get('services')
  await services.settings.updateSetupState({ setupCompleted: false })
  return c.json({ ok: true })
})

// Seed a call record directly for UI-facing tests. Parallel-worker races
// on /telephony/incoming hub resolution make the webhook simulation
// unreliable (a concurrent multi-hub test creating and archiving a hub
// briefly breaks the sole-active-hub fallback), so UI tests that just
// want to assert "a voicemail-flagged call shows the badge" seed the
// call deterministically against the bootstrap hub via this endpoint.
dev.post('/test-seed-call', async (c) => {
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
  if (!secret) return c.json({ error: 'Not Found' }, 404)
  if (c.req.header('X-Test-Secret') !== secret) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    callSid?: string
    hubId?: string
    hasVoicemail?: boolean
    status?: string
    callerLast4?: string
  }
  if (!body.callSid) return c.json({ error: 'callSid is required' }, 400)
  if (!body.hubId) return c.json({ error: 'hubId is required' }, 400)
  const services = c.get('services')
  await services.records.upsertCallRecord(body.callSid, body.hubId, {
    status: body.status ?? 'voicemail',
    hasVoicemail: body.hasVoicemail ?? true,
    callerLast4: body.callerLast4 ?? '4444',
  })
  return c.json({ ok: true })
})

export default dev
