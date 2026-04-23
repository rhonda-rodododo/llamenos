/**
 * Per-role Playwright auth fixtures.
 *
 * Each role fixture provides an authenticated `page` via cached storageState
 * (localStorage + refresh cookie from global setup). PIN entry happens per-test
 * for full isolation — no shared state between tests.
 *
 * Usage:
 *   import { test, expect } from '../fixtures/auth'
 *   test('admin does something', async ({ adminPage }) => { ... })
 *   test('volunteer sees limited nav', async ({ volunteerPage }) => { ... })
 */

import { type BrowserContext, test as base, type Page } from '@playwright/test'
import { completeProfileSetup, enterPin } from '../helpers'

const TEST_PIN = '123456'
const STORAGE_DIR = 'tests/storage'

/** Storage state file paths for each role */
export const STORAGE_PATHS = {
  admin: `${STORAGE_DIR}/admin.json`,
  'hub-admin': `${STORAGE_DIR}/hub-admin.json`,
  volunteer: `${STORAGE_DIR}/volunteer.json`,
  reviewer: `${STORAGE_DIR}/reviewer.json`,
  reporter: `${STORAGE_DIR}/reporter.json`,
} as const

export type RoleName = keyof typeof STORAGE_PATHS

/**
 * Create an authenticated page for a role.
 * Loads cached storageState → navigates to / → enters PIN → waits for dashboard.
 * Each call creates a NEW browser context — full test isolation.
 */
async function createAuthenticatedPage(
  browser: import('@playwright/test').Browser,
  role: RoleName
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: STORAGE_PATHS[role],
  })
  const page = await context.newPage()

  // Auto-dismiss session expired modal if it appears during the test
  await page.addLocatorHandler(page.getByText('Session Expired'), async () => {
    const reconnectBtn = page.getByRole('button', { name: /reconnect/i })
    if (await reconnectBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await reconnectBtn.click({ timeout: 3000 }).catch(() => {})
    }
  })

  // Block the token refresh endpoint initially to prevent restoreSession from getting
  // an access token before we can enter the PIN. This ensures the app stays on the
  // login page with the PIN form visible instead of auto-redirecting to dashboard.
  let refreshBlocked = true
  await page.route('**/api/auth/token/refresh', async (route) => {
    if (refreshBlocked) {
      // Return 401 so restoreSession fails and the app shows the login/PIN screen
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"blocked"}',
      })
    } else {
      await route.continue()
    }
  })

  // Navigate to app
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  const loginHeading = page.getByTestId('login-heading')
  const dashboardHeading = page.getByRole('heading', { name: 'Dashboard', exact: true })
  const profileSetup = page.getByRole('heading', { name: 'Welcome!' })

  // With refresh blocked, the app should show the login/PIN screen.
  // Race on PIN input, login-heading testid (renders before PIN input),
  // dashboard (cached access token), and profile-setup.
  const firstState = await Promise.race([
    pinInput.waitFor({ state: 'visible', timeout: 45000 }).then(() => 'pin' as const),
    loginHeading.waitFor({ state: 'visible', timeout: 45000 }).then(() => 'login' as const),
    dashboardHeading.waitFor({ state: 'visible', timeout: 45000 }).then(() => 'dashboard' as const),
    profileSetup.waitFor({ state: 'visible', timeout: 45000 }).then(() => 'profile' as const),
  ])

  // Unblock refresh so the PIN unlock flow can call refreshToken and getUserInfo
  refreshBlocked = false

  if (firstState === 'pin' || firstState === 'login') {
    // If we got login heading but PIN isn't visible yet, wait for it
    if (firstState === 'login') {
      await pinInput.waitFor({ state: 'visible', timeout: 15000 })
    }
    await enterPin(page, TEST_PIN)
    // After PIN: PBKDF2 runs, then navigates to dashboard or profile-setup
    const afterPin = await Promise.race([
      dashboardHeading
        .waitFor({ state: 'visible', timeout: 90000 })
        .then(() => 'dashboard' as const),
      profileSetup.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'profile' as const),
    ])
    if (afterPin === 'profile') {
      await completeProfileSetup(page)
    }
  } else if (firstState === 'profile') {
    await completeProfileSetup(page)
  } else if (firstState === 'dashboard') {
    // Dashboard appeared despite blocked refresh — may have had a cached access token.
    // Check if key manager is unlocked.
    const isUnlocked = await page.evaluate(async () => {
      const km = (window as Record<string, unknown>).__TEST_KEY_MANAGER as
        | { isUnlocked: () => Promise<boolean> }
        | undefined
      return (await km?.isUnlocked()) ?? false
    })
    if (!isUnlocked) {
      // Reload to show PIN screen — refresh is now unblocked so unlock flow works
      await page.reload({ waitUntil: 'domcontentloaded' })
      const reloadPinInput = page.locator('input[aria-label="PIN digit 1"]')
      const reloadDashboard = page.getByRole('heading', { name: 'Dashboard', exact: true })
      const reloadFirst = await Promise.race([
        reloadPinInput.waitFor({ state: 'visible', timeout: 45000 }).then(() => 'pin' as const),
        reloadDashboard
          .waitFor({ state: 'visible', timeout: 45000 })
          .then(() => 'dashboard' as const),
      ])
      if (reloadFirst === 'pin') {
        await enterPin(page, TEST_PIN)
        await reloadDashboard.waitFor({ state: 'visible', timeout: 90000 })
      }
    }
  }

  // Clean up the route handler
  await page.unroute('**/api/auth/token/refresh')

  return { context, page }
}

/**
 * Extended Playwright test with per-role authenticated page fixtures.
 * Each fixture creates a FRESH browser context per test — full isolation.
 */
export const test = base.extend<{
  adminPage: Page
  adminContext: BrowserContext
  hubAdminPage: Page
  hubAdminContext: BrowserContext
  volunteerPage: Page
  volunteerContext: BrowserContext
  reviewerPage: Page
  reviewerContext: BrowserContext
  reporterPage: Page
  reporterContext: BrowserContext
}>({
  adminPage: async ({ browser }, use) => {
    const { context, page } = await createAuthenticatedPage(browser, 'admin')
    await use(page)
    await context.storageState({ path: STORAGE_PATHS.admin })
    await context.close()
  },
  adminContext: async ({ browser }, use) => {
    const { context } = await createAuthenticatedPage(browser, 'admin')
    await use(context)
    await context.storageState({ path: STORAGE_PATHS.admin })
    await context.close()
  },
  hubAdminPage: async ({ browser }, use) => {
    const { context, page } = await createAuthenticatedPage(browser, 'hub-admin')
    await use(page)
    await context.storageState({ path: STORAGE_PATHS['hub-admin'] })
    await context.close()
  },
  hubAdminContext: async ({ browser }, use) => {
    const { context } = await createAuthenticatedPage(browser, 'hub-admin')
    await use(context)
    await context.storageState({ path: STORAGE_PATHS['hub-admin'] })
    await context.close()
  },
  volunteerPage: async ({ browser }, use) => {
    const { context, page } = await createAuthenticatedPage(browser, 'volunteer')
    await use(page)
    await context.storageState({ path: STORAGE_PATHS.volunteer })
    await context.close()
  },
  volunteerContext: async ({ browser }, use) => {
    const { context } = await createAuthenticatedPage(browser, 'volunteer')
    await use(context)
    await context.storageState({ path: STORAGE_PATHS.volunteer })
    await context.close()
  },
  reviewerPage: async ({ browser }, use) => {
    const { context, page } = await createAuthenticatedPage(browser, 'reviewer')
    await use(page)
    await context.storageState({ path: STORAGE_PATHS.reviewer })
    await context.close()
  },
  reviewerContext: async ({ browser }, use) => {
    const { context } = await createAuthenticatedPage(browser, 'reviewer')
    await use(context)
    await context.storageState({ path: STORAGE_PATHS.reviewer })
    await context.close()
  },
  reporterPage: async ({ browser }, use) => {
    const { context, page } = await createAuthenticatedPage(browser, 'reporter')
    await use(page)
    await context.storageState({ path: STORAGE_PATHS.reporter })
    await context.close()
  },
  reporterContext: async ({ browser }, use) => {
    const { context } = await createAuthenticatedPage(browser, 'reporter')
    await use(context)
    await context.storageState({ path: STORAGE_PATHS.reporter })
    await context.close()
  },
})

export { type BrowserContext, type CDPSession, devices, expect, type Page } from '@playwright/test'
