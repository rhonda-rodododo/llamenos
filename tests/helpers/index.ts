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
    // Assert the digit landed — but skip the last one. In a 6-digit PIN with
    // a 6-slot input, the final fill triggers the consumer's onComplete in
    // the same React event cycle. Several consumers synchronously swap the
    // PinInput's `value` prop inside onComplete (AdminBootstrap transitions
    // from the create step to the confirm step; PinChallengeDialog on a wrong
    // PIN clears `pin` via the attempts-dependent useEffect). React batches
    // those state updates into a single render, so by the time Playwright
    // polls toHaveValue the DOM already reflects the post-transition value
    // (empty). Skipping the assertion for the last digit mirrors the user
    // experience — the downstream assertions verify the completion effect.
    if (i < pin.length - 1) {
      await expect(input).toHaveValue(pin[i], { timeout: 1000 })
    }
  }
  // Focus the last filled digit and press Enter to submit (no-op if already auto-submitted)
  const lastFilledDigit = page.locator(`input[aria-label="PIN digit ${pin.length}"]`)
  await lastFilledDigit.focus().catch(() => {
    // Input may be disabled (auto-submit in progress) — that's fine
  })
  await page.keyboard.press('Enter').catch(() => {
    // Enter may fail if dialog is transitioning — that's fine
  })
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
 * Clear the session capsule so that the next page.reload() falls through
 * to the PIN entry flow. Also dispatches a BroadcastChannel('llamenos-lock')
 * message so any sibling tabs in the same BrowserContext are locked too —
 * this matches production cross-tab lock semantics.
 *
 * Use this before page.reload() in tests that specifically exercise the
 * lock-on-reload behaviour. Tests that want to keep the session unlocked
 * across a reload should NOT call this.
 */
export async function clearSessionCapsule(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      sessionStorage.removeItem('llamenos-session-token')
    } catch {
      /* ignore */
    }
    try {
      const bc = new BroadcastChannel('llamenos-lock')
      bc.postMessage({ type: 'lock' })
      bc.close()
    } catch {
      /* unsupported */
    }
    // IDB orphan is cleaned up automatically on next loadCapsule() call.
  })
}

/**
 * Re-enter PIN after a clearSessionCapsule() + page.reload() sequence.
 *
 * Prerequisite: the caller cleared the session capsule first. Otherwise
 * the capsule auto-restores on reload and this helper's wait for /login
 * will time out.
 *
 * After PR #48 the app redirects to /login automatically when the key is
 * locked, so this helper just waits for that redirect, enters the PIN,
 * and waits for the authenticated layout to re-render.
 */
export async function reenterPinAfterReload(page: Page): Promise<void> {
  // Wait for the locked-key redirect to fire
  await page.waitForURL(/\/login/, { timeout: 15000 })

  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  await pinInput.waitFor({ state: 'visible', timeout: 10000 })

  await enterPin(page, TEST_PIN)

  // PBKDF2 600K + unlockWithPin + loadHubKeys + invalidateQueries can take
  // 60s+ under parallel worker load.
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
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
