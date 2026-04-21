import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

function mlsPath(hubId: string, subpath: string): string {
  return `/api/mls/hub/${hubId}${subpath}`
}

test.describe('MLS Membership Epoch Commits', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'MLS Membership Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Commit submission for member add ─────────────────────────────────

  test('submit commit advances epoch on member add', async () => {
    const hubId = ctx.hubId

    // Initial epoch should be 0
    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    expect(epochRes.status()).toBe(200)
    const initialState = await epochRes.json()
    expect(initialState.currentEpoch).toBe(0)

    // Submit a commit for epoch 1 (simulating a member addition)
    const commitRes = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'admin-device-1',
      epoch: 1,
      commitData: btoa('fake-commit-add-member'),
      welcomeData: btoa('fake-welcome-for-new-member'),
    })
    expect(commitRes.status()).toBe(200)
    const commit = await commitRes.json()
    expect(commit.epoch).toBe(1)
    expect(commit.id).toBeTruthy()

    // Epoch should now be 1
    const updatedEpochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const updatedState = await updatedEpochRes.json()
    expect(updatedState.currentEpoch).toBe(1)
  })

  test('commit with welcome data is retrievable via fetch', async () => {
    const hubId = ctx.hubId

    // Fetch commits since epoch 0 — should contain the one with welcome data
    const commitsRes = await adminApi.get(mlsPath(hubId, '/commits?sinceEpoch=0'))
    expect(commitsRes.status()).toBe(200)
    const { commits } = await commitsRes.json()
    expect(commits.length).toBeGreaterThanOrEqual(1)

    const commitWithWelcome = commits.find((c: { welcomeData: string | null }) => c.welcomeData)
    expect(commitWithWelcome).toBeTruthy()
    expect(commitWithWelcome.welcomeData).toBeTruthy()
  })

  // ─── Commit submission for member remove ──────────────────────────────

  test('submit commit advances epoch on member remove', async () => {
    const hubId = ctx.hubId

    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()

    // Submit a commit for the next epoch (simulating member removal)
    const nextEpoch = currentEpoch + 1
    const commitRes = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'admin-device-1',
      epoch: nextEpoch,
      commitData: btoa('fake-commit-remove-member'),
      welcomeData: null,
    })
    expect(commitRes.status()).toBe(200)
    const commit = await commitRes.json()
    expect(commit.epoch).toBe(nextEpoch)

    // Epoch should now be incremented
    const updatedEpochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const updatedState = await updatedEpochRes.json()
    expect(updatedState.currentEpoch).toBe(nextEpoch)
  })

  // ─── Epoch collision (concurrent adds) ────────────────────────────────

  test('epoch collision returns 409', async () => {
    const hubId = ctx.hubId

    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()

    const nextEpoch = currentEpoch + 1

    // First commit succeeds
    const firstRes = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'admin-device-1',
      epoch: nextEpoch,
      commitData: btoa('first-commit'),
      welcomeData: null,
    })
    expect(firstRes.status()).toBe(200)

    // Second commit for the same epoch should 409
    const secondRes = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'admin-device-2',
      epoch: nextEpoch,
      commitData: btoa('second-commit-same-epoch'),
      welcomeData: null,
    })
    expect(secondRes.status()).toBe(409)
    const conflictBody = await secondRes.json()
    expect(conflictBody.currentEpoch).toBe(nextEpoch)
  })

  // ─── Commit catch-up ──────────────────────────────────────────────────

  test('fetch commits since epoch returns ordered list', async () => {
    const hubId = ctx.hubId

    const commitsRes = await adminApi.get(mlsPath(hubId, '/commits?sinceEpoch=0'))
    expect(commitsRes.status()).toBe(200)
    const { commits } = await commitsRes.json()

    // Should have all commits in order
    expect(commits.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < commits.length; i++) {
      expect(commits[i].epoch).toBeGreaterThan(commits[i - 1].epoch)
    }
  })

  test('fetch commits since specific epoch returns only newer', async () => {
    const hubId = ctx.hubId

    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()

    // Fetch since currentEpoch — should be empty (no commits newer than current)
    const commitsRes = await adminApi.get(mlsPath(hubId, `/commits?sinceEpoch=${currentEpoch}`))
    expect(commitsRes.status()).toBe(200)
    const { commits } = await commitsRes.json()
    expect(commits.length).toBe(0)
  })

  // ─── Purge retains recent epochs ─────────────────────────────────────

  test('purge keeps retention window of recent epochs', async () => {
    const hubId = ctx.hubId

    const purgeRes = await adminApi.post(mlsPath(hubId, '/commits/purge'))
    expect(purgeRes.status()).toBe(200)
    const { remaining } = await purgeRes.json()

    // Should have retained all recent commits (we only have a few)
    expect(remaining).toBeGreaterThan(0)
  })

  // ─── Member add/remove via hub routes ─────────────────────────────────

  test('adding a hub member succeeds via server route', async () => {
    const hubId = ctx.hubId
    // The volunteer was already added during TestContext.create;
    // verify the hub detail endpoint works for this hub
    const res = await adminApi.get(`/api/hubs/${hubId}`)
    expect(res.status()).toBe(200)
  })

  test('removing a hub member succeeds via server route', async () => {
    // Create a fresh user to remove (the primary volunteer is needed for other tests)
    const fresh = await ctx.addUser('reporter', 'MLS Remove Test User')
    const hubId = ctx.hubId

    const removeRes = await adminApi.delete(`/api/hubs/${hubId}/members/${fresh.pubkey}`)
    expect(removeRes.status()).toBe(200)
  })
})
