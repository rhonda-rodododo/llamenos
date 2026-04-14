/**
 * Firehose Extraction Integration Tests
 *
 * Tests the firehose extraction pipeline lifecycle without hitting a real vLLM endpoint:
 * - Connection creation in pending state with correct config fields
 * - Status endpoint returns proper health data (zero buffer for new connection)
 * - Connection can be paused and resumed
 * - Connection config updates (geoContext, extractionIntervalSec, systemPromptSuffix, bufferTtlDays)
 * - Proper cleanup on deletion
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Firehose Extraction Integration', () => {
  test.describe.configure({ mode: 'serial' })

  let connectionId: string
  let reportTypeId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Firehose Extraction Test Hub',
    })
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a SALUTE-style report type with custom fields for extraction tests
    const rtRes = await adminApi.post(ctx.hubPath('/report-types'), {
      encryptedName: 'encrypted-salute-report-type',
      encryptedDescription: 'encrypted-size-activity-location-unit-time-equipment',
    })
    expect(rtRes.status()).toBe(201)
    const rtData = await rtRes.json()
    const rt = rtData.reportType ?? rtData
    reportTypeId = rt.id

    const createRes = await adminApi.post(ctx.hubPath('/firehose'), {
      reportTypeId,
      displayName: 'extraction-test-connection',
      geoContext: 'Eastern Europe',
      geoContextCountryCodes: ['UA', 'PL'],
      extractionIntervalSec: 60,
      bufferTtlDays: 7,
      systemPromptSuffix: 'Focus on SALUTE format fields.',
    })
    expect(createRes.status()).toBe(201)
    const createData = await createRes.json()
    connectionId = createData.connection.id
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async ({ request }) => {
    // Fresh request context — the per-test `request` fixtures used in beforeEach
    // are disposed when each test ends, so adminApi's inner context is stale here.
    const cleanupApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    // Clean up connection if it was created (hub deletion does not cascade to firehose_connections)
    if (connectionId) {
      try {
        await cleanupApi.delete(ctx.hubPath(`/firehose/${connectionId}`))
      } catch {
        /* non-fatal */
      }
    }
    // Clean up report type (hub deletion does not cascade to report_types)
    if (reportTypeId) {
      try {
        await cleanupApi.delete(ctx.hubPath(`/report-types/${reportTypeId}`))
      } catch {
        /* non-fatal */
      }
    }
    await ctx.cleanup()
  })

  // ─── Connection Lifecycle ────────────────────────────────────────────────

  test('connection starts in pending state with correct config', async () => {
    const res = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(res.status()).toBe(200)
    const data = await res.json()
    const conn = data.connection

    // Connection identity
    expect(conn.id).toBe(connectionId)
    expect(conn.hubId).toBe(ctx.hubId)
    expect(conn.reportTypeId).toBe(reportTypeId)

    // Agent pubkey must be a 64-char hex string (32-byte x-only Nostr pubkey)
    expect(conn.agentPubkey).toBeTruthy()
    expect(conn.agentPubkey).toMatch(/^[0-9a-f]{64}$/)

    // Status must be pending until the agent connects to the relay
    expect(conn.status).toBe('pending')

    // Config fields must match what was sent at creation
    expect(conn.geoContext).toBe('Eastern Europe')
    expect(conn.geoContextCountryCodes).toEqual(['UA', 'PL'])
    expect(conn.extractionIntervalSec).toBe(60)
    expect(conn.bufferTtlDays).toBe(7)
    expect(conn.systemPromptSuffix).toBe('Focus on SALUTE format fields.')

    // Private key must never be exposed via API
    expect(conn).not.toHaveProperty('encryptedAgentNsec')
  })

  // ─── Status / Health ─────────────────────────────────────────────────────

  test('status endpoint shows zero buffer for new connection', async () => {
    const res = await adminApi.get(ctx.hubPath('/firehose/status'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.statuses)).toBe(true)

    const health = data.statuses.find((s: { id: string }) => s.id === connectionId)
    expect(health).toBeDefined()

    // A brand-new connection has never received messages
    expect(health.bufferSize).toBe(0)
    expect(health.extractionCount).toBe(0)

    // No inference has run yet — latency metric should be null
    expect(health.inferenceHealthMs).toBeNull()

    // Timestamps not yet populated for idle connection
    expect(health.lastMessageReceived).toBeNull()
    expect(health.lastReportSubmitted).toBeNull()
  })

  // ─── Pause / Resume ──────────────────────────────────────────────────────

  test('connection can be paused and resumed', async () => {
    // Pause the connection
    const pauseRes = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      status: 'paused',
    })
    expect(pauseRes.status()).toBe(200)
    const paused = (await pauseRes.json()).connection
    expect(paused.status).toBe('paused')

    // Verify paused state persists
    const getAfterPause = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(getAfterPause.status()).toBe(200)
    expect((await getAfterPause.json()).connection.status).toBe('paused')

    // Resume the connection
    const resumeRes = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      status: 'active',
    })
    expect(resumeRes.status()).toBe(200)
    const resumed = (await resumeRes.json()).connection
    expect(resumed.status).toBe('active')

    // Verify resumed state persists
    const getAfterResume = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(getAfterResume.status()).toBe(200)
    expect((await getAfterResume.json()).connection.status).toBe('active')
  })

  // ─── Config Updates ──────────────────────────────────────────────────────

  test('connection config can be updated', async () => {
    const res = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      geoContext: 'Central Europe',
      geoContextCountryCodes: ['DE', 'AT', 'CH'],
      extractionIntervalSec: 120,
      systemPromptSuffix: 'Extract SALUTE fields and NATO threat codes.',
      bufferTtlDays: 14,
    })
    expect(res.status()).toBe(200)
    const conn = (await res.json()).connection

    expect(conn.geoContext).toBe('Central Europe')
    expect(conn.geoContextCountryCodes).toEqual(['DE', 'AT', 'CH'])
    expect(conn.extractionIntervalSec).toBe(120)
    expect(conn.systemPromptSuffix).toBe('Extract SALUTE fields and NATO threat codes.')
    expect(conn.bufferTtlDays).toBe(14)

    // Unmodified fields must be preserved
    expect(conn.reportTypeId).toBe(reportTypeId)
    expect(conn.agentPubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(conn).not.toHaveProperty('encryptedAgentNsec')
  })

  // ─── Deletion / Cleanup ──────────────────────────────────────────────────

  test('connection is properly cleaned up on deletion', async () => {
    // Delete the connection
    const deleteRes = await adminApi.delete(ctx.hubPath(`/firehose/${connectionId}`))
    expect(deleteRes.status()).toBe(200)
    const deleteData = await deleteRes.json()
    expect(deleteData.ok).toBe(true)

    // Verify GET returns 404
    const getRes = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(getRes.status()).toBe(404)

    // Verify it no longer appears in the status list
    const statusRes = await adminApi.get(ctx.hubPath('/firehose/status'))
    expect(statusRes.status()).toBe(200)
    const statusData = await statusRes.json()
    const found = statusData.statuses.find((s: { id: string }) => s.id === connectionId)
    expect(found).toBeUndefined()

    // Null out so afterAll cleanup skips the already-deleted connection
    connectionId = ''
  })
})
