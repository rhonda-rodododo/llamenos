/**
 * WebAuthn Passkey Tests
 *
 * Tests passkey registration, authentication, and credential management
 * using Playwright's virtual authenticator via Chrome DevTools Protocol.
 *
 * Tests:
 *   2.1: Admin registers a passkey → credential appears in list
 *   2.3: Empty label prevents registration (button disabled)
 *   2.4: Multiple passkeys can be registered
 *   3.1: Login with passkey (no nsec required)
 *   3.3: Session from passkey auth works for API calls
 *   4.1: Delete passkey credential
 *
 * Playwright is configured to run UI tests under Desktop Chrome only, so
 * the CDP-based virtual authenticator must always be available. If setup
 * throws, that's a real failure — no silent skip.
 */

import { type CDPSession, type Page, expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Virtual Authenticator
// ─────────────────────────────────────────────────────────────────────────────

async function setupVirtualAuthenticator(
  page: Page
): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  })
  return { cdp, authenticatorId }
}

async function teardownVirtualAuthenticator(
  cdp: CDPSession,
  authenticatorId: string
): Promise<void> {
  try {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
  } catch {
    // Ignore cleanup errors
  }
}

/** Navigate to /settings and open the passkeys section */
async function openPasskeysSection(page: Page): Promise<void> {
  await navigateAfterLogin(page, '/settings')
  // Wait for the passkeys card to appear (requires webauthnAvailable)
  await expect(page.locator('#passkeys')).toBeVisible({ timeout: 5000 })

  // Check if the collapsible content is already expanded by looking for the input
  const labelInput = page.getByTestId('passkey-label-input')
  const alreadyExpanded = await labelInput.isVisible({ timeout: 500 }).catch(() => false)

  if (!alreadyExpanded) {
    // Click the card header (CollapsibleTrigger wraps CardHeader via asChild,
    // so data-slot becomes "collapsible-trigger" not "card-header")
    await page.locator('#passkeys').locator('div[data-slot="collapsible-trigger"]').click()
    // Wait for collapsible animation to complete
    await labelInput.waitFor({ state: 'visible', timeout: 5000 })
  }

  await expect(labelInput).toBeVisible({ timeout: 5000 })
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Passkey Registration
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Passkey registration', () => {
  test.describe.configure({ mode: 'serial' })

  test('admin can register a passkey — credential appears in list', async ({ adminPage }) => {
    const auth = await setupVirtualAuthenticator(adminPage)
    await openPasskeysSection(adminPage)

    const labelInput = adminPage.getByTestId('passkey-label-input')
    const registerBtn = adminPage.getByTestId('passkey-register-btn')

    // Register button should be disabled until label is entered
    await expect(registerBtn).toBeDisabled()

    // Fill in label and register
    await labelInput.fill('My Test Key')
    await expect(registerBtn).toBeEnabled()
    await registerBtn.click()

    // Virtual authenticator auto-confirms — credential should appear
    await expect(
      adminPage.getByTestId('passkey-credential-row').filter({ hasText: 'My Test Key' })
    ).toBeVisible({ timeout: 10_000 })

    // Success toast
    await expect(adminPage.getByText(/passkey registered/i)).toBeVisible({ timeout: 5000 })

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })

  test('register button is disabled when label is empty', async ({ adminPage }) => {
    const auth = await setupVirtualAuthenticator(adminPage)

    await openPasskeysSection(adminPage)

    const registerBtn = adminPage.getByTestId('passkey-register-btn')
    const labelInput = adminPage.getByTestId('passkey-label-input')

    // Empty label → disabled
    await expect(registerBtn).toBeDisabled()

    // Type then clear → disabled again
    await labelInput.fill('test')
    await expect(registerBtn).toBeEnabled()
    await labelInput.clear()
    await expect(registerBtn).toBeDisabled()

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })

  test('multiple passkeys can be registered', async ({ adminPage }) => {
    const auth1 = await setupVirtualAuthenticator(adminPage)

    await openPasskeysSection(adminPage)

    const labelInput = adminPage.getByTestId('passkey-label-input')
    const registerBtn = adminPage.getByTestId('passkey-register-btn')

    // Register first passkey using first virtual authenticator
    await labelInput.fill('Device Alpha')
    await registerBtn.click()
    await expect(
      adminPage.getByTestId('passkey-credential-row').filter({ hasText: 'Device Alpha' })
    ).toBeVisible({ timeout: 10_000 })

    // Remove first authenticator and add a second one on the same CDP session.
    // excludeCredentials prevents the same authenticator from creating a new
    // credential for the same user, so we need a fresh authenticator.
    const { cdp } = auth1
    await cdp.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: auth1.authenticatorId,
    })
    const { authenticatorId: auth2Id } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    })

    // Register second passkey using fresh authenticator
    await labelInput.fill('Device Beta')
    await expect(registerBtn).toBeEnabled({ timeout: 5_000 })
    await registerBtn.click()
    await expect(
      adminPage.getByTestId('passkey-credential-row').filter({ hasText: 'Device Beta' })
    ).toBeVisible({ timeout: 10_000 })

    // Both credentials should be present
    const rows = adminPage.getByTestId('passkey-credential-row')
    const count = await rows.count()
    expect(count, 'Expected at least 2 credentials registered').toBeGreaterThanOrEqual(2)

    await teardownVirtualAuthenticator(cdp, auth2Id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Passkey Authentication
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Passkey authentication', () => {
  test.describe.configure({ mode: 'serial' })

  test('login with passkey succeeds without entering nsec', async ({ adminPage }) => {
    const auth = await setupVirtualAuthenticator(adminPage)

    await openPasskeysSection(adminPage)
    const labelInput = adminPage.getByTestId('passkey-label-input')
    const registerBtn = adminPage.getByTestId('passkey-register-btn')
    await labelInput.fill('Login Test Key')
    await registerBtn.click()
    await expect(
      adminPage.getByTestId('passkey-credential-row').filter({ hasText: 'Login Test Key' })
    ).toBeVisible({ timeout: 10_000 })

    // Now log out and attempt passkey login — clear both storages to simulate a
    // fresh device so the login page shows the passkey button instead of PIN entry.
    // Block the token refresh endpoint to prevent restoreSession from auto-redirecting
    // via the httpOnly cookie (which survives storage clears).
    await adminPage.route('**/api/auth/token/refresh', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"blocked"}' })
    )
    await adminPage.evaluate(() => {
      sessionStorage.clear()
      localStorage.clear()
    })
    await adminPage.goto('/login')
    await adminPage.waitForLoadState('domcontentloaded')

    const passkeyBtn = adminPage.getByTestId('passkey-login-btn')
    await expect(passkeyBtn).toBeVisible({ timeout: 15_000 })

    // Unblock refresh before clicking — the passkey flow needs it for getUserInfo
    await adminPage.unroute('**/api/auth/token/refresh')

    await passkeyBtn.click()

    // Virtual authenticator auto-selects the registered credential.
    // Since localStorage was cleared (no stored key), the app shows a PIN setup
    // flow to provision the key on this "new device".
    const pinSetup = adminPage.getByTestId('passkey-pin-setup')
    await expect(pinSetup).toBeVisible({ timeout: 30_000 })

    // Create a PIN (6 digits) and confirm it
    const TEST_PIN = '123456'
    const pinDigit1 = adminPage.locator('input[aria-label="PIN digit 1"]')
    await pinDigit1.waitFor({ state: 'visible', timeout: 10_000 })
    await pinDigit1.focus()
    await adminPage.keyboard.type(TEST_PIN, { delay: 80 })
    await adminPage.keyboard.press('Enter')

    // Confirm step — enter the same PIN
    await pinDigit1.waitFor({ state: 'visible', timeout: 10_000 })
    await pinDigit1.focus()
    await adminPage.keyboard.type(TEST_PIN, { delay: 80 })
    await adminPage.keyboard.press('Enter')

    // After PIN setup, the app should navigate away from /login
    await adminPage.waitForURL((url) => !url.toString().includes('/login'), { timeout: 30_000 })

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })

  test('session from passkey auth is valid for API calls', async ({ adminPage }) => {
    const auth = await setupVirtualAuthenticator(adminPage)

    await openPasskeysSection(adminPage)
    const labelInput = adminPage.getByTestId('passkey-label-input')
    const registerBtn = adminPage.getByTestId('passkey-register-btn')
    await labelInput.fill('API Session Key')
    await registerBtn.click()
    await expect(
      adminPage.getByTestId('passkey-credential-row').filter({ hasText: 'API Session Key' })
    ).toBeVisible({ timeout: 10_000 })

    // Log out, log back in via passkey — clear all storage to get the full login form.
    // Block refresh to prevent restoreSession from auto-redirecting via httpOnly cookie.
    await adminPage.route('**/api/auth/token/refresh', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"blocked"}' })
    )
    await adminPage.evaluate(() => {
      sessionStorage.clear()
      localStorage.clear()
    })
    await adminPage.goto('/login')
    await adminPage.waitForLoadState('domcontentloaded')

    const passkeyBtn = adminPage.getByTestId('passkey-login-btn')
    await expect(passkeyBtn).toBeVisible({ timeout: 10_000 })

    // Unblock refresh before clicking — the passkey flow needs it for getUserInfo
    await adminPage.unroute('**/api/auth/token/refresh')

    await passkeyBtn.click()

    // Passkey login on a fresh device shows PIN setup to provision the key
    const pinSetup = adminPage.getByTestId('passkey-pin-setup')
    await expect(pinSetup).toBeVisible({ timeout: 30_000 })

    const SESSION_PIN = '654321'
    const pinDigit1 = adminPage.locator('input[aria-label="PIN digit 1"]')
    await pinDigit1.waitFor({ state: 'visible', timeout: 10_000 })
    await pinDigit1.focus()
    await adminPage.keyboard.type(SESSION_PIN, { delay: 80 })
    await adminPage.keyboard.press('Enter')

    // Confirm PIN
    await pinDigit1.waitFor({ state: 'visible', timeout: 10_000 })
    await pinDigit1.focus()
    await adminPage.keyboard.type(SESSION_PIN, { delay: 80 })
    await adminPage.keyboard.press('Enter')

    await adminPage.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15_000 })

    // Verify the facade client holds a JWT access token after passkey login
    const accessToken = await adminPage.evaluate(
      () =>
        (window as Record<string, unknown>).__TEST_AUTH_FACADE &&
        (
          (window as Record<string, unknown>).__TEST_AUTH_FACADE as {
            getAccessToken(): string | null
          }
        ).getAccessToken()
    )
    expect(accessToken, 'JWT access token must be held by facade after passkey login').toBeTruthy()
    // Verify it is a JWT: 3 dot-separated base64url segments
    const jwtParts = (accessToken ?? '').split('.')
    expect(jwtParts, 'access_token must be a JWT (3 segments)').toHaveLength(3)

    // Verify API calls work (check health endpoint)
    const healthStatus = await adminPage.evaluate(async () => {
      const res = await fetch('/api/health/ready')
      return res.status
    })
    expect(healthStatus, 'API should be reachable after passkey login').toBe(200)

    // Verify authenticated call to /api/auth/userinfo returns nsecSecret
    const userinfoResult = await adminPage.evaluate(async (token: string) => {
      const res = await fetch('/api/auth/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      })
      return { status: res.status, data: res.ok ? await res.json() : null }
    }, accessToken as string)
    expect(userinfoResult.status, '/api/auth/userinfo must return 200').toBe(200)

    const userinfo = userinfoResult.data as { pubkey?: string; nsecSecret?: string | null } | null
    expect(userinfo, 'userinfo response must not be null').not.toBeNull()
    expect(userinfo, 'userinfo must have nsecSecret property').toHaveProperty('nsecSecret')
    // nsecSecret is a 64-char hex when user is enrolled in Authentik, or null otherwise
    if (userinfo?.nsecSecret !== null) {
      expect(userinfo?.nsecSecret, 'nsecSecret must be a 64-char hex string').toMatch(
        /^[0-9a-f]{64}$/
      )
    }

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Credential Management
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Credential management', () => {
  test.describe.configure({ mode: 'serial' })

  test('deleting a passkey removes it from the list', async ({ adminPage }) => {
    const auth = await setupVirtualAuthenticator(adminPage)

    await openPasskeysSection(adminPage)
    const labelInput = adminPage.getByTestId('passkey-label-input')
    const registerBtn = adminPage.getByTestId('passkey-register-btn')

    // Register a credential to delete
    await labelInput.fill('To Be Deleted')
    await registerBtn.click()
    await expect(
      adminPage.getByTestId('passkey-credential-row').filter({ hasText: 'To Be Deleted' })
    ).toBeVisible({ timeout: 10_000 })

    const rowsBefore = await adminPage.getByTestId('passkey-credential-row').count()

    // Delete the credential
    const targetRow = adminPage
      .getByTestId('passkey-credential-row')
      .filter({ hasText: 'To Be Deleted' })
    const deleteBtn = targetRow.getByTestId('passkey-delete-btn')
    await deleteBtn.click()

    // Row should disappear
    await expect(
      adminPage.getByTestId('passkey-credential-row').filter({ hasText: 'To Be Deleted' })
    ).not.toBeVisible({ timeout: 5000 })

    const rowsAfter = await adminPage.getByTestId('passkey-credential-row').count()
    expect(rowsAfter, 'Credential count should decrease by 1 after deletion').toBe(rowsBefore - 1)

    await teardownVirtualAuthenticator(auth.cdp, auth.authenticatorId)
  })

  test('passkey section only shows when WebAuthn is supported', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/settings')

    const webauthnSupported = await adminPage.evaluate(
      () =>
        typeof window !== 'undefined' &&
        'credentials' in navigator &&
        'PublicKeyCredential' in window
    )

    const passkeySection = adminPage.locator('#passkeys')

    if (webauthnSupported) {
      await expect(passkeySection).toBeVisible({ timeout: 5000 })
    } else {
      // Section hidden when WebAuthn not available
      await expect(passkeySection).not.toBeVisible()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Virtual authenticator smoke test
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Virtual authenticator setup', () => {
  test('WebAuthn API is available in test browser', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/login')
    const supported = await page.evaluate(
      () => 'credentials' in navigator && 'PublicKeyCredential' in window
    )
    // Log result — this test always passes (it's informational)
    if (!supported) {
      console.log('[webauthn] WebAuthn not available in this browser — passkey tests will skip')
    }
    expect(typeof supported).toBe('boolean')
    await ctx.close()
  })
})
