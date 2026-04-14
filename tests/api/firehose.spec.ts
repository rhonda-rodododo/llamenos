/**
 * Firehose Connection CRUD API Tests
 *
 * Full lifecycle: create, list, get, status, update, pause/resume, delete.
 * Permission enforcement (firehose:manage and firehose:read required).
 * Uses hub-scoped routes so each test run is isolated.
 *
 * NOTE: POST /firehose returns 503 when FIREHOSE_AGENT_SEAL_KEY is not set.
 * Tests that create connections check for 503 and skip gracefully when the
 * seal key is not configured in the test environment.
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

test.describe('Firehose Connections API', () => {
  test.describe.configure({ mode: 'serial' })

  let connectionId: string
  let reportTypeId: string

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'Firehose Test Hub',
    })
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create a report type for firehose connections to reference
    const rtRes = await adminApi.post(ctx.hubPath('/report-types'), {
      encryptedName: 'encrypted-firehose-test-report-type',
    })
    expect(rtRes.status()).toBe(201)
    const rtData = await rtRes.json()
    const rt = rtData.reportType ?? rtData
    reportTypeId = rt.id

    // Create the shared connection used by read/update/delete tests.
    const createRes = await adminApi.post(ctx.hubPath('/firehose'), {
      reportTypeId,
      displayName: 'probe-connection',
      extractionIntervalSec: 60,
      bufferTtlDays: 7,
    })
    expect(createRes.status()).toBe(201)
    const createData = await createRes.json()
    connectionId = createData.connection.id
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── CRUD ────────────────────────────────────────────────────────────────

  test('POST /firehose - creates a connection', async () => {
    // connectionId was set during beforeAll — verify it was created correctly
    expect(connectionId).toBeTruthy()

    // Fetch the connection to verify fields
    const res = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(res.status()).toBe(200)
    const data = await res.json()
    const conn = data.connection
    expect(conn.id).toBe(connectionId)
    expect(conn.agentPubkey).toBeTruthy()
    expect(conn.status).toBe('pending')
    expect(conn.reportTypeId).toBe(reportTypeId)
    // encryptedAgentNsec must NOT be in the response
    expect(conn).not.toHaveProperty('encryptedAgentNsec')
  })

  test('GET /firehose - lists connections', async () => {
    const res = await adminApi.get(ctx.hubPath('/firehose'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.connections)).toBe(true)
    expect(data.connections.length).toBeGreaterThanOrEqual(1)
    expect(data.connections.some((c: { id: string }) => c.id === connectionId)).toBe(true)
  })

  test('GET /firehose/:id - gets a connection', async () => {
    const res = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(res.status()).toBe(200)
    const data = await res.json()
    const conn = data.connection
    expect(conn.id).toBe(connectionId)
    expect(conn.reportTypeId).toBe(reportTypeId)
    expect(conn.hubId).toBe(ctx.hubId)
    expect(conn.agentPubkey).toBeTruthy()
    expect(typeof conn.extractionIntervalSec).toBe('number')
    expect(typeof conn.bufferTtlDays).toBe('number')
    expect(conn).not.toHaveProperty('encryptedAgentNsec')
  })

  test('GET /firehose/status - returns health for all connections', async () => {
    const res = await adminApi.get(ctx.hubPath('/firehose/status'))
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.statuses)).toBe(true)
    expect(data.statuses.some((s: { id: string }) => s.id === connectionId)).toBe(true)
    const health = data.statuses.find((s: { id: string }) => s.id === connectionId)
    expect(health).toBeDefined()
    expect(typeof health.bufferSize).toBe('number')
    expect(typeof health.extractionCount).toBe('number')
  })

  test('PATCH /firehose/:id - updates extraction interval and geo context', async () => {
    const res = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      extractionIntervalSec: 120,
      geoContext: 'North America',
      geoContextCountryCodes: ['US', 'CA'],
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    const conn = data.connection
    expect(conn.extractionIntervalSec).toBe(120)
    expect(conn.geoContext).toBe('North America')
    expect(conn.geoContextCountryCodes).toEqual(['US', 'CA'])
    expect(conn).not.toHaveProperty('encryptedAgentNsec')
  })

  test('PATCH /firehose/:id - pauses and resumes connection', async () => {
    // Pause
    const pauseRes = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      status: 'paused',
    })
    expect(pauseRes.status()).toBe(200)
    const paused = (await pauseRes.json()).connection
    expect(paused.status).toBe('paused')

    // Resume (set to active)
    const resumeRes = await adminApi.patch(ctx.hubPath(`/firehose/${connectionId}`), {
      status: 'active',
    })
    expect(resumeRes.status()).toBe(200)
    const resumed = (await resumeRes.json()).connection
    expect(resumed.status).toBe('active')
  })

  test('PATCH /firehose/nonexistent-id - returns 404', async () => {
    const res = await adminApi.patch(ctx.hubPath('/firehose/nonexistent-conn-id'), {
      extractionIntervalSec: 60,
    })
    expect(res.status()).toBe(404)
  })

  test('GET /firehose/nonexistent-id - returns 404', async () => {
    const res = await adminApi.get(ctx.hubPath('/firehose/nonexistent-conn-id'))
    expect(res.status()).toBe(404)
  })

  test('DELETE /firehose/:id - deletes a connection', async () => {
    // Delete the connection
    const deleteRes = await adminApi.delete(ctx.hubPath(`/firehose/${connectionId}`))
    expect(deleteRes.status()).toBe(200)
    const deleteData = await deleteRes.json()
    expect(deleteData.ok).toBe(true)

    // Verify it no longer exists
    const getRes = await adminApi.get(ctx.hubPath(`/firehose/${connectionId}`))
    expect(getRes.status()).toBe(404)
  })

  // ─── Permission Enforcement ──────────────────────────────────────────────

  test('volunteer cannot list firehose connections', async () => {
    const res = await ctx.api('volunteer').get(ctx.hubPath('/firehose'))
    expect(res.status()).toBe(403)
  })

  test('volunteer cannot create firehose connections', async () => {
    const res = await ctx.api('volunteer').post(ctx.hubPath('/firehose'), {
      reportTypeId: reportTypeId ?? 'any-id',
      displayName: 'unauthorized-connection',
    })
    expect(res.status()).toBe(403)
  })

  // ─── API validation boundaries ───────────────────────────────────────────

  test.describe('API validation boundaries', () => {
    test('POST /firehose - rejects extractionIntervalSec below 30 with 400', async () => {
      const res = await adminApi.post(ctx.hubPath('/firehose'), {
        reportTypeId: reportTypeId ?? 'any-id',
        extractionIntervalSec: 29,
      })
      expect(res.status()).toBe(400)
    })

    test('POST /firehose - rejects extractionIntervalSec above 300 with 400', async () => {
      const res = await adminApi.post(ctx.hubPath('/firehose'), {
        reportTypeId: reportTypeId ?? 'any-id',
        extractionIntervalSec: 301,
      })
      expect(res.status()).toBe(400)
    })

    test('POST /firehose - rejects bufferTtlDays below 1 with 400', async () => {
      const res = await adminApi.post(ctx.hubPath('/firehose'), {
        reportTypeId: reportTypeId ?? 'any-id',
        bufferTtlDays: 0,
      })
      expect(res.status()).toBe(400)
    })

    test('POST /firehose - rejects bufferTtlDays above 30 with 400', async () => {
      const res = await adminApi.post(ctx.hubPath('/firehose'), {
        reportTypeId: reportTypeId ?? 'any-id',
        bufferTtlDays: 31,
      })
      expect(res.status()).toBe(400)
    })
  })
})
