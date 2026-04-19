import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

function mlsPath(hubId: string, subpath: string): string {
  return `/api/mls/hub/${hubId}${subpath}`
}

test.describe('MLS Server Routes', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'MLS Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Bootstrap ─────────────────────────────────────────────────────────

  test('hub creation auto-bootstraps MLS group', async () => {
    const hubId = ctx.hubId
    // Hub was created in beforeAll; MLS auto-bootstrap should have occurred
    const res = await adminApi.get(mlsPath(hubId, '/epoch'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.currentEpoch).toBe(0)
    expect(body.ciphersuite).toBe(1)
    expect(body.groupId).toContain(hubId)
  })

  test('bootstrap rejects already-bootstrapped hub (409)', async () => {
    const hubId = ctx.hubId
    const res = await adminApi.post(mlsPath(hubId, '/bootstrap'), {
      deviceId: 'device-integration-1',
      groupId: `llamenos:hub:${hubId}`,
    })
    expect(res.status()).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('already bootstrapped')
  })

  // ─── Epoch ─────────────────────────────────────────────────────────────

  test('get current epoch after bootstrap', async () => {
    const hubId = ctx.hubId
    const res = await adminApi.get(mlsPath(hubId, '/epoch'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.currentEpoch).toBe(0)
    expect(body.ciphersuite).toBe(1)
    expect(body.groupId).toContain(hubId)
  })

  test('epoch 404 for non-bootstrapped hub', async () => {
    const res = await adminApi.get(mlsPath('nonexistent-hub-id', '/epoch'))
    expect(res.status()).toBe(404)
  })

  // ─── Key Packages (no device FK available in test context) ─────────────
  // Full key-package lifecycle integration tests require a registered device
  // in user_devices (FK constraint). These are covered by unit tests; the
  // full lifecycle will be validated in Slice 3 after device enrollment.

  test('key-package fetch returns 404 for unknown device', async () => {
    const hubId = ctx.hubId
    const res = await adminApi.get(mlsPath(hubId, '/key-packages/nonexistent-device'))
    expect(res.status()).toBe(404)
  })

  test('key-package counts returns empty for new hub', async () => {
    const hubId = ctx.hubId
    const res = await adminApi.get(mlsPath(hubId, '/key-packages/counts'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.counts).toEqual([])
  })

  // ─── Commits (read-only) ──────────────────────────────────────────────

  test('fetch commits returns empty when no commits exist', async () => {
    const hubId = ctx.hubId
    const res = await adminApi.get(mlsPath(hubId, '/commits?sinceEpoch=0'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.commits).toEqual([])
  })

  // ─── Purge ─────────────────────────────────────────────────────────────

  test('purge is no-op when no commits exist', async () => {
    const hubId = ctx.hubId
    const res = await adminApi.post(mlsPath(hubId, '/commits/purge'))
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.purged).toBe(0)
    expect(body.remaining).toBe(0)
  })

  test('purge returns 404 for non-bootstrapped hub', async () => {
    const res = await adminApi.post(mlsPath('nonexistent-hub-id', '/commits/purge'))
    expect(res.status()).toBe(404)
  })
})
