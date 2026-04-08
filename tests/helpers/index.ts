import { type APIRequestContext, type Page, expect } from '@playwright/test'
import { TestIds } from '../test-ids'

export const ADMIN_NSEC = 'nsec174zsa94n3e7t0ugfldh9tgkkzmaxhalr78uxt9phjq3mmn6d6xas5jdffh'
export const TEST_PIN = '123456'

/**
 * Default timeout values for common operations.
 * Centralized here for easy tuning during test optimization.
 */
export const Timeouts = {
  /** Time to wait for page navigation */
  NAVIGATION: 10000,
  /** Time to wait for API responses */
  API: 15000,
  /** Time to wait for elements to appear */
  ELEMENT: 10000,
  /** Time to wait for auth-related operations (60s for parallel execution with PBKDF2) */
  AUTH: 60000,
  /** Short delay for UI settling after login/navigation */
  UI_SETTLE: 500,
  /** Medium delay for route component mount and initial API calls */
  ASYNC_SETTLE: 1500,
} as const

// Re-export TestIds for convenience
export { TestIds } from '../test-ids'

// Re-export page object utilities
export * from '../pages/index'

/**
 * Enter a PIN into the PinInput component (supports 6-8 digit PINs in 8-slot input).
 * Uses Playwright's fill() on each slot for reliable React controlled input handling.
 * After all digits are filled, verifies the value and presses Enter to submit.
 */
export async function enterPin(page: Page, pin: string) {
  const firstDigit = page.locator('input[aria-label="PIN digit 1"]')
  await firstDigit.waitFor({ state: 'visible', timeout: 10000 })
  for (let i = 0; i < pin.length; i++) {
    const input = page.locator(`input[aria-label="PIN digit ${i + 1}"]`)
    await input.fill(pin[i])
    // Verify the digit was accepted before moving on
    await expect(input).toHaveValue(pin[i], { timeout: 1000 })
  }
  // Focus the last filled digit and press Enter to submit
  const lastFilledDigit = page.locator(`input[aria-label="PIN digit ${pin.length}"]`)
  await lastFilledDigit.focus()
  await page.keyboard.press('Enter')
}

/**
 * Navigate to a URL after the user has already logged in.
 * If already authenticated (sidebar visible), does SPA navigation directly.
 * Otherwise, re-authenticates via PIN entry first.
 */
export async function navigateAfterLogin(page: Page, url: string): Promise<void> {
  // Check if we're already authenticated (sidebar Dashboard link visible)
  const dashboardLink = page.getByRole('link', { name: 'Dashboard' })
  const isAuthenticated = await dashboardLink.isVisible({ timeout: 1000 }).catch(() => false)

  if (!isAuthenticated) {
    // Handle profile-setup page (no sidebar, need to complete first)
    if (page.url().includes('profile-setup')) {
      await completeProfileSetup(page)
    } else {
      // Need to re-authenticate — full page load clears in-memory keyManager
      await page.goto('/login')
      await page.waitForLoadState('domcontentloaded')

      const pinInput = page.locator('input[aria-label="PIN digit 1"]')
      const pinVisible = await pinInput.isVisible({ timeout: 5000 }).catch(() => false)

      if (pinVisible) {
        await enterPin(page, TEST_PIN)
      }

      // Wait for the authenticated layout (may redirect to profile-setup first)
      const dashOrSetup = await Promise.race([
        dashboardLink
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'dashboard' as const),
        page
          .waitForURL((u) => u.toString().includes('profile-setup'), { timeout: 30000 })
          .then(() => 'profile-setup' as const),
      ])

      if (dashOrSetup === 'profile-setup') {
        await completeProfileSetup(page)
      }
    }
  }

  // SPA navigation via TanStack Router (no page reload, keeps auth state)
  const parsed = new URL(url, 'http://localhost')
  const searchParams = Object.fromEntries(parsed.searchParams.entries())
  await page.evaluate(
    ({ pathname, search }) => {
      const router = (window as any).__TEST_ROUTER
      if (!router) return
      if (Object.keys(search).length > 0) {
        router.navigate({ to: pathname, search })
      } else {
        router.navigate({ to: pathname })
      }
    },
    { pathname: parsed.pathname, search: searchParams }
  )
  await page.waitForURL(
    (u) => {
      const p = new URL(u.toString()).pathname
      return p === parsed.pathname || p === `${parsed.pathname}/`
    },
    { timeout: Timeouts.NAVIGATION }
  )

  // Allow route component to mount and initial API calls to complete
  await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
}

/**
 * Re-enter PIN after a page.reload() when user is already authenticated.
 * The reload clears keyManager, so the encrypted key in localStorage triggers
 * the PIN screen. After entering PIN the app redirects to /.
 * If currentPath is provided, the helper then navigates back to that path
 * via the sidebar or page.goto as appropriate.
 */
export async function reenterPinAfterReload(page: Page): Promise<void> {
  // After reload, wait for the page to settle — Session Expired modal may flash
  await page.waitForLoadState('domcontentloaded')

  // Dismiss Session Expired modal if it appears before PIN input
  const sessionExpired = page.getByText('Session Expired')
  if (await sessionExpired.isVisible({ timeout: 1000 }).catch(() => false)) {
    const reconnectBtn = page.getByRole('button', { name: /reconnect/i })
    if (await reconnectBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await reconnectBtn.click({ timeout: 3000 }).catch(() => {})
    }
  }

  const pinInput = page.locator('input[aria-label="PIN digit 1"]')

  // After reload, the refresh cookie may restore the API session without
  // showing a PIN prompt (user stays on dashboard with locked keys).
  // Use waitFor (NOT isVisible) — isVisible resolves immediately for absent elements.
  let pinVisible = await pinInput
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false)

  if (!pinVisible) {
    // Block refresh endpoint and reload to force the login/PIN screen
    await page.route('**/api/auth/token/refresh', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"blocked"}',
      })
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    // Wait for the login/PIN screen to appear (the blocked refresh triggers redirect)
    pinVisible = await pinInput
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    // Unblock refresh so the PIN unlock flow can complete
    await page.unroute('**/api/auth/token/refresh')
  }

  if (!pinVisible) {
    // Last resort: navigate directly to /login to force PIN screen
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    pinVisible = await pinInput
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false)
  }

  if (!pinVisible) {
    throw new Error(
      'reenterPinAfterReload: PIN screen never appeared after reload + blocked refresh + goto /login'
    )
  }

  await enterPin(page, TEST_PIN)
  // PBKDF2 600K + unlockWithPin + loadHubKeys + invalidateQueries can take 60s+
  // under parallel worker load (3 workers each doing PBKDF2 simultaneously)
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
  // Wait for the authenticated layout to render (sidebar, dashboard heading)
  const dashHeading = page.getByRole('heading', { name: 'Dashboard', exact: true })
  await dashHeading.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {
    // May have gone to profile-setup instead — that's OK
  })
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /log out/i }).click()
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
}

export async function createUserAndGetNsec(
  page: Page,
  name: string,
  phone: string
): Promise<string> {
  await page.getByRole('link', { name: 'Users' }).click()
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

  await page.getByTestId(TestIds.USER_ADD_BTN).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Phone Number').fill(phone)
  await page.getByLabel('Phone Number').blur()
  await page.getByTestId(TestIds.FORM_SAVE_BTN).click()

  const nsecCode = page.getByTestId(TestIds.USER_NSEC_CODE)
  await expect(nsecCode).toBeVisible({ timeout: Timeouts.API })
  const nsec = await nsecCode.textContent()
  if (!nsec) throw new Error('Failed to get nsec')
  return nsec
}

/** Dismiss the nsec card shown after user creation. */
export async function dismissNsecCard(page: Page): Promise<void> {
  await page.getByTestId('dismiss-nsec').click()
  await expect(page.getByTestId('dismiss-nsec')).not.toBeVisible()
}

export async function completeProfileSetup(page: Page) {
  if (page.url().includes('profile-setup')) {
    await page.getByRole('button', { name: /complete setup/i }).click()
    await page.waitForURL((u) => !u.toString().includes('profile-setup'), { timeout: 15000 })
  }
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
    timeout: 10000,
  })
}

let phoneCounter = 0
export function uniquePhone(): string {
  const suffix = Date.now().toString().slice(-5)
  const counter = String(phoneCounter++).padStart(2, '0')
  return `+1555${suffix}${counter}`
}

const TEST_RESET_SECRET = process.env.DEV_RESET_SECRET || 'test-reset-secret'

export async function resetTestState(request: APIRequestContext) {
  const res = await request.post('/api/test-reset', {
    headers: { 'X-Test-Secret': TEST_RESET_SECRET },
  })
  if (!res.ok()) {
    throw new Error(`test-reset failed with status ${res.status()}: ${await res.text()}`)
  }
}
