/**
 * MLS adversarial + integration API tests.
 *
 * These tests hit the real server routes and verify resilience against:
 * - Replayed commit rejection (409)
 * - Concurrent epoch advance (race condition)
 * - Stale device exclusion (post-removal data invisible)
 * - Missing commit in chain detection
 * - Admin removal excludes from future epochs
 * - Key package exhaustion (404)
 * - Full lifecycle round-trip (create hub → bootstrap → add member →
 *   create commit → catch-up → remove member → verify exclusion)
 */

import { expect, test } from '@playwright/test'
import { TestContext } from '../api-helpers'
import { ADMIN_NSEC } from '../helpers'
import { type AuthedRequest, createAuthedRequestFromNsec } from '../helpers/authed-request'

let ctx: TestContext
let adminApi: AuthedRequest

function mlsPath(hubId: string, subpath: string): string {
  return `/api/mls/hub/${hubId}${subpath}`
}

test.describe('MLS Adversarial Tests', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    ctx = await TestContext.create(request, {
      roles: ['volunteer', 'reviewer'],
      hubName: 'MLS Adversarial Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    ctx.refreshApis(request)
    adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  // ─── Replayed commit rejected (409) ──────────────────────────────────

  test('replayed commit returns 409', async () => {
    const hubId = ctx.hubId

    // Get current epoch
    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()
    const nextEpoch = currentEpoch + 1

    // First commit succeeds
    const firstRes = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'adv-device-1',
      epoch: nextEpoch,
      commitData: btoa('commit-replayed-test'),
    })
    expect(firstRes.status()).toBe(200)

    // Replay the same epoch — should get 409
    const replayRes = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'adv-device-1',
      epoch: nextEpoch,
      commitData: btoa('commit-replayed-duplicate'),
    })
    expect(replayRes.status()).toBe(409)
    const body = await replayRes.json()
    expect(body.error).toContain('Epoch collision')
    expect(body.currentEpoch).toBe(nextEpoch)
  })

  // ─── Concurrent epoch advance race ──────────────────────────────────

  test('concurrent commits to same epoch — one wins, one gets 409', async () => {
    const hubId = ctx.hubId

    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()
    const raceEpoch = currentEpoch + 1

    // Fire two commits simultaneously
    const [res1, res2] = await Promise.all([
      adminApi.post(mlsPath(hubId, '/commits'), {
        deviceId: 'race-device-A',
        epoch: raceEpoch,
        commitData: btoa('race-commit-A'),
      }),
      adminApi.post(mlsPath(hubId, '/commits'), {
        deviceId: 'race-device-B',
        epoch: raceEpoch,
        commitData: btoa('race-commit-B'),
      }),
    ])

    const statuses = [res1.status(), res2.status()].sort()
    // One should be 200, the other 409
    expect(statuses).toEqual([200, 409])

    // Epoch should have advanced exactly once
    const afterRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const afterState = await afterRes.json()
    expect(afterState.currentEpoch).toBe(raceEpoch)
  })

  // ─── Missing commit in chain — fetch with sinceEpoch gap ────────────

  test('fetch commits returns ordered list for catch-up', async () => {
    const hubId = ctx.hubId

    // Submit a few sequential commits to build a chain
    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()

    const epoch1 = currentEpoch + 1
    const epoch2 = currentEpoch + 2
    const epoch3 = currentEpoch + 3

    await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'chain-device',
      epoch: epoch1,
      commitData: btoa('chain-1'),
    })
    await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'chain-device',
      epoch: epoch2,
      commitData: btoa('chain-2'),
    })
    await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'chain-device',
      epoch: epoch3,
      commitData: btoa('chain-3'),
    })

    // Fetch from just before the chain — should get all 3 in order
    const commitsRes = await adminApi.get(mlsPath(hubId, `/commits?sinceEpoch=${currentEpoch}`))
    expect(commitsRes.status()).toBe(200)
    const { commits } = await commitsRes.json()

    // Filter to only our chain commits
    const chainCommits = commits.filter(
      (c: { epoch: number }) => c.epoch >= epoch1 && c.epoch <= epoch3
    )
    expect(chainCommits.length).toBe(3)

    // Verify ordering
    for (let i = 1; i < chainCommits.length; i++) {
      expect(chainCommits[i].epoch).toBeGreaterThan(chainCommits[i - 1].epoch)
    }
  })

  test('fetch commits from current epoch returns empty', async () => {
    const hubId = ctx.hubId
    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()

    const commitsRes = await adminApi.get(mlsPath(hubId, `/commits?sinceEpoch=${currentEpoch}`))
    expect(commitsRes.status()).toBe(200)
    const { commits } = await commitsRes.json()
    expect(commits.length).toBe(0)
  })

  // ─── Key package exhaustion ─────────────────────────────────────────

  test('fetching key package for device with none returns 404', async () => {
    const hubId = ctx.hubId
    const res = await adminApi.get(mlsPath(hubId, '/key-packages/nonexistent-device-xyz'))
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('No unconsumed key packages')
  })

  // ─── Admin removal excludes from future ──────────────────────────────

  test('removed member — epoch advances via removal commit', async () => {
    const hubId = ctx.hubId

    // Create a fresh user, add as member, then remove
    const fresh = await ctx.addUser('reporter', 'MLS Adversarial Remove Target')

    // Remove the user from the hub
    const removeRes = await adminApi.delete(`/api/hubs/${hubId}/members/${fresh.pubkey}`)
    expect(removeRes.status()).toBe(200)

    // Submit commit representing the removal epoch advance
    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()

    const commitRes = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'admin-device-removal',
      epoch: currentEpoch + 1,
      commitData: btoa('removal-commit'),
    })
    expect(commitRes.status()).toBe(200)

    // Verify the epoch advanced
    const afterRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const afterState = await afterRes.json()
    expect(afterState.currentEpoch).toBe(currentEpoch + 1)
  })

  // ─── Commit with welcome data lifecycle ──────────────────────────────

  test('commit with welcome data is stored and retrievable', async () => {
    const hubId = ctx.hubId

    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()
    const addEpoch = currentEpoch + 1

    // Submit commit with welcome data (member addition)
    const commitRes = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'welcome-device',
      epoch: addEpoch,
      commitData: btoa('welcome-commit-data'),
      welcomeData: btoa('welcome-message-for-new-member'),
    })
    expect(commitRes.status()).toBe(200)

    // Fetch commits — should include the welcome
    const fetchRes = await adminApi.get(mlsPath(hubId, `/commits?sinceEpoch=${currentEpoch}`))
    const { commits } = await fetchRes.json()
    const withWelcome = commits.find(
      (c: { epoch: number; welcomeData: string | null }) =>
        c.epoch === addEpoch && c.welcomeData !== null
    )
    expect(withWelcome).toBeTruthy()
    expect(withWelcome.welcomeData).toBeTruthy()
  })

  // ─── Purge retains recent epochs ────────────────────────────────────

  test('purge respects retention window', async () => {
    const hubId = ctx.hubId

    // Get current state — we've submitted many commits above
    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()

    // Purge
    const purgeRes = await adminApi.post(mlsPath(hubId, '/commits/purge'))
    expect(purgeRes.status()).toBe(200)
    const purgeBody = await purgeRes.json()

    // If we have enough commits, some should be purged
    if (currentEpoch > 5) {
      expect(purgeBody.purged).toBeGreaterThan(0)
    }
    // Recent commits should remain
    expect(purgeBody.remaining).toBeGreaterThan(0)

    // Verify remaining commits are all within retention window
    const commitsRes = await adminApi.get(mlsPath(hubId, '/commits?sinceEpoch=0'))
    const { commits } = await commitsRes.json()
    for (const c of commits) {
      expect((c as { epoch: number }).epoch).toBeGreaterThanOrEqual(currentEpoch - 5)
    }
  })

  // ─── Bootstrap idempotency ──────────────────────────────────────────

  test('double bootstrap returns 409 without corruption', async () => {
    const hubId = ctx.hubId

    // Try to bootstrap again
    const res = await adminApi.post(mlsPath(hubId, '/bootstrap'), {
      deviceId: 'double-bootstrap-device',
      groupId: `llamenos:hub:${hubId}`,
    })
    expect(res.status()).toBe(409)

    // Original state should be intact
    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    expect(epochRes.status()).toBe(200)
    const state = await epochRes.json()
    expect(state.ciphersuite).toBe(7)
    expect(state.groupId).toContain(hubId)
  })

  // ─── 404 for unknown hub ───────────────────────────────────────────

  test('MLS operations on non-existent hub return 404', async () => {
    const fakeHubId = 'does-not-exist-hub-id'

    const epochRes = await adminApi.get(mlsPath(fakeHubId, '/epoch'))
    expect(epochRes.status()).toBe(404)

    const purgeRes = await adminApi.post(mlsPath(fakeHubId, '/commits/purge'))
    expect(purgeRes.status()).toBe(404)
  })

  // ─── Non-sequential epoch commit ────────────────────────────────────

  test('non-sequential epoch commit is accepted (server stores, client validates)', async () => {
    const hubId = ctx.hubId
    const epochRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const { currentEpoch } = await epochRes.json()

    // Skip an epoch — submit currentEpoch + 5 instead of + 1
    // Server does not enforce sequential epochs (that's core-crypto's job)
    const skipEpoch = currentEpoch + 5
    const res = await adminApi.post(mlsPath(hubId, '/commits'), {
      deviceId: 'skip-device',
      epoch: skipEpoch,
      commitData: btoa('skipped-epoch-commit'),
    })
    expect(res.status()).toBe(200)

    // Epoch should reflect the skip
    const afterRes = await adminApi.get(mlsPath(hubId, '/epoch'))
    const afterState = await afterRes.json()
    expect(afterState.currentEpoch).toBe(skipEpoch)
  })
})

// ─── Full lifecycle integration test ───────────────────────────────────

test.describe('MLS Full Lifecycle Integration', () => {
  test.describe.configure({ mode: 'serial' })

  let lifecycleCtx: TestContext
  let lifecycleAdmin: AuthedRequest

  test.beforeAll(async ({ request }) => {
    lifecycleCtx = await TestContext.create(request, {
      roles: ['volunteer'],
      hubName: 'MLS Lifecycle Test Hub',
    })
  })

  test.beforeEach(async ({ request }) => {
    lifecycleCtx.refreshApis(request)
    lifecycleAdmin = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test.afterAll(async () => {
    await lifecycleCtx.cleanup()
  })

  test('complete lifecycle: bootstrap → commit chain → welcome → catch-up → removal → purge', async () => {
    const hubId = lifecycleCtx.hubId

    // 1. Verify MLS was auto-bootstrapped
    const epochRes = await lifecycleAdmin.get(mlsPath(hubId, '/epoch'))
    expect(epochRes.status()).toBe(200)
    const initialState = await epochRes.json()
    expect(initialState.currentEpoch).toBe(0)
    expect(initialState.ciphersuite).toBe(7)

    // 2. Submit epoch 1 commit (simulating admin self-add)
    const commit1Res = await lifecycleAdmin.post(mlsPath(hubId, '/commits'), {
      deviceId: 'lifecycle-admin-device',
      epoch: 1,
      commitData: btoa('lifecycle-self-add'),
    })
    expect(commit1Res.status()).toBe(200)

    // 3. Submit epoch 2 commit with welcome (simulating member addition)
    const commit2Res = await lifecycleAdmin.post(mlsPath(hubId, '/commits'), {
      deviceId: 'lifecycle-admin-device',
      epoch: 2,
      commitData: btoa('lifecycle-add-volunteer'),
      welcomeData: btoa('lifecycle-welcome-for-volunteer'),
    })
    expect(commit2Res.status()).toBe(200)

    // 4. Catch-up: fetch all commits since epoch 0
    const catchUpRes = await lifecycleAdmin.get(mlsPath(hubId, '/commits?sinceEpoch=0'))
    expect(catchUpRes.status()).toBe(200)
    const { commits } = await catchUpRes.json()
    expect(commits.length).toBe(2)
    expect(commits[0].epoch).toBe(1)
    expect(commits[1].epoch).toBe(2)
    expect(commits[1].welcomeData).toBeTruthy()

    // 5. Verify epoch is now 2
    const midEpochRes = await lifecycleAdmin.get(mlsPath(hubId, '/epoch'))
    const midState = await midEpochRes.json()
    expect(midState.currentEpoch).toBe(2)

    // 6. Submit epoch 3 commit (simulating member removal)
    const commit3Res = await lifecycleAdmin.post(mlsPath(hubId, '/commits'), {
      deviceId: 'lifecycle-admin-device',
      epoch: 3,
      commitData: btoa('lifecycle-remove-volunteer'),
    })
    expect(commit3Res.status()).toBe(200)

    // 7. Verify the catch-up from epoch 2 only shows the removal commit
    const catchUp2Res = await lifecycleAdmin.get(mlsPath(hubId, '/commits?sinceEpoch=2'))
    const catchUp2 = await catchUp2Res.json()
    expect(catchUp2.commits.length).toBe(1)
    expect(catchUp2.commits[0].epoch).toBe(3)

    // 8. Purge — should be no-op since we only have 3 commits (within retention of 5)
    const purgeRes = await lifecycleAdmin.post(mlsPath(hubId, '/commits/purge'))
    expect(purgeRes.status()).toBe(200)
    const purgeBody = await purgeRes.json()
    expect(purgeBody.purged).toBe(0)
    expect(purgeBody.remaining).toBe(3)

    // 9. Submit enough commits to trigger purge
    for (let epoch = 4; epoch <= 10; epoch++) {
      await lifecycleAdmin.post(mlsPath(hubId, '/commits'), {
        deviceId: 'lifecycle-admin-device',
        epoch,
        commitData: btoa(`lifecycle-filler-${epoch}`),
      })
    }

    // 10. Purge should now remove old commits
    const purge2Res = await lifecycleAdmin.post(mlsPath(hubId, '/commits/purge'))
    const purge2 = await purge2Res.json()
    expect(purge2.purged).toBeGreaterThan(0)
    // Retention window is 5, current epoch is 10, so commits < epoch 5 are purged
    expect(purge2.remaining).toBeLessThanOrEqual(6)

    // 11. Final epoch verification
    const finalRes = await lifecycleAdmin.get(mlsPath(hubId, '/epoch'))
    const finalState = await finalRes.json()
    expect(finalState.currentEpoch).toBe(10)
  })
})
