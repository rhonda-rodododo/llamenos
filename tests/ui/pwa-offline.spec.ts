/**
 * PWA Offline Mode Tests
 *
 * Verifies service worker registration, cache storage correctness, and offline UX.
 *
 * Tests:
 *   1.1: Service worker registers successfully
 *   1.2: Cache contains app shell, excludes /api/* and /telephony/*
 *   2.1: Offline banner appears when network goes offline
 *   2.2: Offline banner disappears when network is restored
 *   3.1: App shell loads from cache when offline
 *   3.2: API calls fail gracefully when offline (no blank screen)
 *   5.1: No SRI mismatch errors in console
 */

import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Service Worker Registration
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Service Worker registration', () => {
  test('service worker registers and becomes active after login', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/')

    // Wait for SW to register and become active.
    // navigator.serviceWorker.ready resolves when a SW is "active", but that
    // worker may still be in the "activating" state (not yet "activated").
    // Listen for the statechange event to wait for the final "activated" state.
    const swState = await adminPage.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'not-supported'
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
      ])
      if (!reg) return 'timeout'
      const sw = reg as ServiceWorkerRegistration
      if (!sw.active) return 'no-active-sw'
      if (sw.active.state === 'activated') return 'activated'
      // SW is still activating — wait for the state transition
      return new Promise<string>((resolve) => {
        const worker = sw.active!
        const onStateChange = () => {
          if (worker.state === 'activated') {
            worker.removeEventListener('statechange', onStateChange)
            resolve('activated')
          }
        }
        worker.addEventListener('statechange', onStateChange)
        // Safety timeout — don't hang forever
        setTimeout(() => resolve(worker.state), 10_000)
      })
    })

    expect(swState, 'Service worker should be in "activated" state').toBe('activated')
  })

  test('no service worker registration errors in console', async ({ adminPage }) => {
    const consoleErrors: string[] = []
    adminPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        // Filter for SW-related errors only
        if (
          text.toLowerCase().includes('service worker') ||
          text.toLowerCase().includes('workbox')
        ) {
          consoleErrors.push(text)
        }
      }
    })

    await navigateAfterLogin(adminPage, '/')

    // Allow time for SW to initialize
    await adminPage.waitForTimeout(2000)

    expect(consoleErrors, `SW registration errors: ${consoleErrors.join(', ')}`).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1.2: Cache storage correctness
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Cache storage', () => {
  test('precache contains app shell assets', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/')

    // Wait for SW to activate and precaching to complete
    await adminPage.evaluate(() => navigator.serviceWorker.ready)
    await adminPage.waitForTimeout(2000)

    const cacheInfo = await adminPage.evaluate(async () => {
      const cacheNames = await caches.keys()
      const allCachedUrls: string[] = []

      for (const name of cacheNames) {
        const cache = await caches.open(name)
        const keys = await cache.keys()
        allCachedUrls.push(...keys.map((r) => r.url))
      }

      return {
        cacheNames,
        cachedUrls: allCachedUrls,
      }
    })

    // Must have at least one cache
    expect(cacheInfo.cacheNames.length, 'Expected at least one Workbox cache').toBeGreaterThan(0)

    // Cache must contain some JS/CSS (app shell)
    const hasAppShellAssets = cacheInfo.cachedUrls.some(
      (url) => url.endsWith('.js') || url.endsWith('.css') || url.includes('index.html')
    )
    expect(hasAppShellAssets, 'Cache should contain JS/CSS/HTML app shell assets').toBe(true)
  })

  test('cache does NOT contain /api/ responses', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/')

    await adminPage.evaluate(() => navigator.serviceWorker.ready)
    await adminPage.waitForTimeout(2000)

    const apiCached = await adminPage.evaluate(async () => {
      const cacheNames = await caches.keys()
      for (const name of cacheNames) {
        const cache = await caches.open(name)
        const keys = await cache.keys()
        if (keys.some((r) => r.url.includes('/api/'))) return true
      }
      return false
    })

    expect(apiCached, '/api/ responses must not be cached by service worker').toBe(false)
  })

  test('cache does NOT contain /telephony/ responses', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/')

    await adminPage.evaluate(() => navigator.serviceWorker.ready)
    await adminPage.waitForTimeout(2000)

    const telephonyCached = await adminPage.evaluate(async () => {
      const cacheNames = await caches.keys()
      for (const name of cacheNames) {
        const cache = await caches.open(name)
        const keys = await cache.keys()
        if (keys.some((r) => r.url.includes('/telephony/'))) return true
      }
      return false
    })

    expect(telephonyCached, '/telephony/ responses must not be cached').toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Offline UX indicator
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Offline banner', () => {
  test('offline banner appears when network goes offline', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/')

    // Verify banner is initially hidden
    const bannerInitial = adminPage.getByTestId('offline-banner')
    await expect(bannerInitial).not.toBeVisible()

    // Simulate going offline
    await adminPage.context().setOffline(true)

    // Banner should appear
    await expect(bannerInitial).toBeVisible({ timeout: 3000 })

    // Banner text should mention offline state
    const text = await bannerInitial.textContent()
    expect(text?.toLowerCase()).toMatch(/offline/)

    // Restore network
    await adminPage.context().setOffline(false)
  })

  test('offline banner disappears when network is restored', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/')

    const banner = adminPage.getByTestId('offline-banner')

    // Go offline → banner appears
    await adminPage.context().setOffline(true)
    await expect(banner).toBeVisible({ timeout: 3000 })

    // Go online → banner disappears
    await adminPage.context().setOffline(false)
    await expect(banner).not.toBeVisible({ timeout: 3000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: App shell offline load
// ─────────────────────────────────────────────────────────────────────────────

test.describe('App shell offline load', () => {
  test('login page renders from cache when offline', async ({ adminPage }) => {
    // First visit — prime the SW cache
    await navigateAfterLogin(adminPage, '/')
    await adminPage.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      // Wait for SW to finish activating and controlling the page
      if (reg.active?.state !== 'activated') {
        await new Promise<void>((resolve) => {
          reg.active?.addEventListener('statechange', function handler() {
            if (reg.active?.state === 'activated') {
              reg.active.removeEventListener('statechange', handler)
              resolve()
            }
          })
          // Resolve immediately if already activated
          if (reg.active?.state === 'activated') resolve()
        })
      }
    })
    // Visit a second time to ensure precache is populated (SW controls page on second load)
    await adminPage.reload({ waitUntil: 'networkidle' })
    await adminPage.waitForTimeout(1000)

    // Verify SW is controlling the page before going offline
    const isControlled = await adminPage.evaluate(() => !!navigator.serviceWorker.controller)
    if (!isControlled) {
      // If not controlled yet, reload once more and wait
      await adminPage.reload({ waitUntil: 'networkidle' })
      await adminPage.waitForTimeout(2000)
    }

    // Go offline and navigate to login
    await adminPage.context().setOffline(true)

    // Navigate to root; SW serves app shell from cache
    await adminPage.goto('/', { waitUntil: 'load', timeout: 15000 }).catch(() => {
      // load event may not fire if SW doesn't serve all resources
    })
    // Give React time to render from cached assets
    await adminPage.waitForTimeout(2000)

    // App should render something (not a blank page / ERR_INTERNET_DISCONNECTED)
    // The login/PIN page or dashboard should be visible
    const bodyText = await adminPage.evaluate(() => document.body.innerText)
    expect(bodyText.length, 'Page should render content from cache, not blank').toBeGreaterThan(10)

    // Should not show browser's default offline error page
    expect(bodyText).not.toMatch(/ERR_INTERNET_DISCONNECTED|net::ERR|No internet/i)

    // Restore
    await adminPage.context().setOffline(false)
  })

  test('API failures when offline result in error state, not blank screen', async ({
    adminPage,
  }) => {
    await navigateAfterLogin(adminPage, '/')
    await adminPage.evaluate(() => navigator.serviceWorker.ready)
    await adminPage.waitForTimeout(2000)

    // Go offline while on dashboard
    await adminPage.context().setOffline(true)

    // Try to navigate to a data-heavy page
    await adminPage.evaluate(() => {
      const router = (window as any).__TEST_ROUTER
      if (router) router.navigate({ to: '/' })
    })
    await adminPage.waitForTimeout(2000)

    // Body should not be blank
    const bodyText = await adminPage.evaluate(() => document.body.innerText.trim())
    expect(
      bodyText.length,
      'Page should show content (error state or cached), not blank'
    ).toBeGreaterThan(0)

    await adminPage.context().setOffline(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: SRI / Workbox integrity
// ─────────────────────────────────────────────────────────────────────────────

test.describe('SRI and Workbox integrity', () => {
  test('no SRI mismatch or content hash errors in console', async ({ adminPage }) => {
    const sriErrors: string[] = []
    adminPage.on('console', (msg) => {
      const text = msg.text()
      if (
        text.toLowerCase().includes('sri') ||
        text.toLowerCase().includes('content hash') ||
        text.toLowerCase().includes('integrity') ||
        (text.toLowerCase().includes('failed') && text.toLowerCase().includes('workbox'))
      ) {
        sriErrors.push(text)
      }
    })

    await navigateAfterLogin(adminPage, '/')
    await adminPage.evaluate(() => navigator.serviceWorker.ready)
    await adminPage.waitForTimeout(3000)

    expect(sriErrors, `SRI/integrity errors: ${sriErrors.join(' | ')}`).toHaveLength(0)
  })
})
