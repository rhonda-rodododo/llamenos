import { expect, test } from '../fixtures/auth'
import { TEST_PIN, clearSessionCapsule, enterPin } from '../helpers'

test.describe('session capsule', () => {
  test('reload preserves unlocked state — no PIN prompt', async ({ adminPage }) => {
    // Precondition: adminPage fixture is already logged in and unlocked
    await expect(adminPage.getByTestId('dashboard-heading')).toBeVisible({
      timeout: 10000,
    })

    // Reload — the capsule should auto-restore the worker
    await adminPage.reload()

    // Dashboard renders without a PIN prompt
    await expect(adminPage.getByTestId('dashboard-heading')).toBeVisible({
      timeout: 10000,
    })
    const pinInput = adminPage.locator('input[aria-label="PIN digit 1"]')
    await expect(pinInput).toBeHidden()
  })

  test('reload re-populates the hub key cache via restoreSession', async ({ adminPage }) => {
    // Commit 247e9cae added loadHubKeysForUser() inside restoreSession so
    // hub-key-encrypted fields (Twilio SID, report type names, role labels,
    // …) decrypt after a capsule fast-path restore. Without that call the
    // dashboard still renders but the module-level hub key cache is empty
    // and every hub-encrypted query silently shows [encrypted] placeholders.
    //
    // Directly pin the contract: after reload the hub key cache is
    // non-empty. The capsule-reload test above only asserts the dashboard
    // heading, which is NOT encrypted, and would pass even if
    // loadHubKeysForUser had been accidentally removed.
    await expect(adminPage.getByTestId('dashboard-heading')).toBeVisible({
      timeout: 10000,
    })

    // Wait for the initial unlockWithPin path to have populated the cache
    // (unlockWithPin also calls loadHubKeysForUser asynchronously).
    await expect
      .poll(async () => adminPage.evaluate(() => window.__TEST_HUB_KEY_CACHE?.size() ?? 0), {
        timeout: 10_000,
        message: 'hub key cache should be populated after initial unlock',
      })
      .toBeGreaterThan(0)

    // Reload — capsule auto-restore path must reload hub keys.
    await adminPage.reload()
    await expect(adminPage.getByTestId('dashboard-heading')).toBeVisible({
      timeout: 10000,
    })

    // The cache starts empty in the fresh module instance and must be
    // re-populated asynchronously by loadHubKeysForUser inside
    // restoreSession. Poll up to 10s.
    await expect
      .poll(async () => adminPage.evaluate(() => window.__TEST_HUB_KEY_CACHE?.size() ?? 0), {
        timeout: 10_000,
        message: 'hub key cache should be re-populated after capsule-restore reload',
      })
      .toBeGreaterThan(0)
  })

  test('clearSessionCapsule + reload falls through to PIN prompt', async ({ adminPage }) => {
    await expect(adminPage.getByTestId('dashboard-heading')).toBeVisible({
      timeout: 10000,
    })

    await clearSessionCapsule(adminPage)
    await adminPage.reload()

    // Now the app should redirect to /login and show PIN input
    await adminPage.waitForURL(/\/login/, { timeout: 15000 })
    const pinInput = adminPage.locator('input[aria-label="PIN digit 1"]')
    await expect(pinInput).toBeVisible({ timeout: 10000 })

    // Re-enter the PIN to leave the suite in a usable state
    await enterPin(adminPage, TEST_PIN)
    await adminPage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
  })

  test('expired capsule falls through to PIN prompt on reload', async ({ adminPage }) => {
    await expect(adminPage.getByTestId('dashboard-heading')).toBeVisible({
      timeout: 10000,
    })

    // Fast-forward the capsule expiry into the past via direct IDB write
    await adminPage.evaluate(async () => {
      const req = indexedDB.open('llamenos-session', 1)
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        const tx = db.transaction('capsules', 'readwrite')
        const store = tx.objectStore('capsules')
        const getReq = store.get('active')
        const capsule = await new Promise<unknown>((resolve, reject) => {
          getReq.onsuccess = () => resolve(getReq.result)
          getReq.onerror = () => reject(getReq.error)
        })
        if (capsule && typeof capsule === 'object') {
          ;(capsule as { autoLockExpiresAt: number }).autoLockExpiresAt = Date.now() - 1000
          await new Promise<void>((resolve, reject) => {
            const putReq = store.put(capsule, 'active')
            putReq.onsuccess = () => resolve()
            putReq.onerror = () => reject(putReq.error)
          })
        }
      } finally {
        db.close()
      }
    })

    await adminPage.reload()
    await adminPage.waitForURL(/\/login/, { timeout: 15000 })
    const pinInput = adminPage.locator('input[aria-label="PIN digit 1"]')
    await expect(pinInput).toBeVisible()

    // Leave the context usable for teardown
    await enterPin(adminPage, TEST_PIN)
    await adminPage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
  })

  test('cross-tab lock: BroadcastChannel lock locks sibling tab', async ({ adminPage }) => {
    await expect(adminPage.getByTestId('dashboard-heading')).toBeVisible({
      timeout: 10000,
    })

    // Open a second page in the same context (shares IDB, BroadcastChannel)
    const tabB = await adminPage.context().newPage()
    await tabB.goto('/')
    await expect(tabB.getByTestId('dashboard-heading')).toBeVisible({
      timeout: 15000,
    })

    // Dispatch a lock broadcast from tab A. The BroadcastChannel message is
    // delivered to both tab A's key-manager listener and tab B's listener.
    // Both will call lock(), clearing their capsules and zeroing their workers.
    await adminPage.evaluate(() => {
      const bc = new BroadcastChannel('llamenos-lock')
      bc.postMessage({ type: 'lock' })
      bc.close()
    })

    // Tab B's listener locks its worker and clears its capsule. Since tab B
    // had no capsule left, a reload should redirect to /login.
    await tabB.reload()
    await tabB.waitForURL(/\/login/, { timeout: 15000 })

    // Cleanup: close tab B and re-unlock tab A
    await tabB.close()
    await adminPage.reload()
    await adminPage.waitForURL(/\/login/, { timeout: 15000 })
    await enterPin(adminPage, TEST_PIN)
    await adminPage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
  })
})
