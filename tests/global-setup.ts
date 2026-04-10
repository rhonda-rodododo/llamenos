import { expect, test } from '@playwright/test'

const TEST_PIN = '123456'
const TEST_RESET_SECRET = process.env.DEV_RESET_SECRET || 'test-reset-secret'
const STORAGE_DIR = 'tests/storage'

/**
 * Directly verify the test DB is in the expected reset state by querying
 * for any remaining super-admin users. Returns true if the reset is clean.
 * Used as defense in depth against stale config caches — the HTTP reset
 * clears server-side state, this check is authoritative.
 */
async function verifyDbResetClean(): Promise<boolean> {
  const postgres = (await import('postgres')).default
  const dbUrl =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://llamenos:llamenos@localhost:5433/llamenos'
  const sql = postgres(dbUrl, { max: 1 })
  try {
    const rows = await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM users WHERE roles::text LIKE '%"role-super-admin"%'
    `
    const count = Number.parseInt(rows[0]?.count ?? '0', 10)
    return count === 0
  } finally {
    await sql.end()
  }
}

/**
 * Enter a PIN into the PinInput component (supports 6-8 digit PINs in 8-slot input).
 * Uses Playwright's fill() on each slot for reliable React controlled input handling.
 * After all digits are filled, verifies the value and presses Enter to submit.
 */
async function enterSetupPin(page: import('@playwright/test').Page, pin: string) {
  const firstDigit = page.locator('input[aria-label="PIN digit 1"]')
  await firstDigit.waitFor({ state: 'visible', timeout: 30000 })
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
 * After loading storage state and navigating to /, handle PIN entry and profile setup.
 * The page may show: PIN screen → Dashboard, or PIN screen → profile-setup → Dashboard.
 */
async function unlockAndNavigateToDashboard(page: import('@playwright/test').Page) {
  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  const dashboard = page.getByRole('heading', { name: 'Dashboard', exact: true })
  const profileSetup = page.getByRole('heading', { name: 'Welcome!' })

  // Block the automatic restoreSession refresh so the PIN screen appears first.
  // Without this, restoreSession may get an access token from the refresh cookie
  // and redirect to dashboard before PIN entry (keys stay locked).
  let refreshBlocked = true
  await page.route('**/api/auth/token/refresh', async (route) => {
    if (refreshBlocked) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"blocked-during-setup"}',
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const firstVisible = await Promise.race([
    pinInput.waitFor({ state: 'visible', timeout: 45000 }).then(() => 'pin' as const),
    dashboard.waitFor({ state: 'visible', timeout: 45000 }).then(() => 'dashboard' as const),
    profileSetup.waitFor({ state: 'visible', timeout: 45000 }).then(() => 'profile' as const),
  ])

  // Unblock refresh so the PIN unlock flow can call refreshToken and getUserInfo
  refreshBlocked = false

  if (firstVisible === 'pin') {
    // Capture browser console for debugging unlock failures
    const consoleLogs: string[] = []
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`))

    await enterSetupPin(page, TEST_PIN)
    const wrongPin = page.getByText('Wrong PIN')
    const afterPin = await Promise.race([
      dashboard.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'dashboard' as const),
      profileSetup.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'profile' as const),
      wrongPin.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'wrong-pin' as const),
    ])
    if (afterPin === 'wrong-pin') {
      console.error('[UNLOCK] Browser console logs:')
      for (const log of consoleLogs) console.error(`  ${log}`)
      throw new Error('Wrong PIN entered during admin unlock')
    }
    if (afterPin === 'profile') {
      await page.getByRole('button', { name: /complete setup/i }).click()
      await expect(dashboard).toBeVisible({ timeout: 15000 })
    }
  } else if (firstVisible === 'profile') {
    await page.getByRole('button', { name: /complete setup/i }).click()
    await expect(dashboard).toBeVisible({ timeout: 15000 })
  }

  await page.unroute('**/api/auth/token/refresh')
}

/**
 * Complete the admin bootstrap flow:
 * 1. Navigate to /setup
 * 2. Click "Get Started", create PIN, confirm PIN
 * 3. Wait for keypair generation + recovery key
 * 4. Download backup, acknowledge, continue to setup wizard
 * 5. Complete setup wizard (identity + channels + skip remaining + launch)
 */
async function bootstrapAdmin(page: import('@playwright/test').Page) {
  await page.goto('/setup', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    // Unregister all service workers to prevent stale cached responses
    const registrations = await navigator.serviceWorker?.getRegistrations?.()
    if (registrations) {
      await Promise.all(registrations.map((r) => r.unregister()))
    }
    // Clear Cache Storage (Workbox precache) to prevent stale API responses
    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((name) => caches.delete(name)))
    }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  // Wait for bootstrap UI — config fetch must return needsBootstrap=true.
  // The SetupWizard shows "Create Admin Account" when needsBootstrap is true.
  // If the setup wizard (step 1) shows instead, the config fetch returned stale data.
  const bootstrapTitle = page.getByText('Create Admin Account')
  const wizardTitle = page.getByText('Setup Wizard')
  const firstVisible = await Promise.race([
    bootstrapTitle.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'bootstrap' as const),
    wizardTitle.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'wizard' as const),
  ])

  if (firstVisible === 'wizard') {
    // Setup wizard appeared instead of bootstrap — the app may have stale config.
    // Force a fresh config fetch by navigating away and back.
    console.log('[SETUP] WARNING: Setup Wizard appeared instead of bootstrap. Forcing reload...')
    // Clear everything aggressively
    await page.evaluate(async () => {
      localStorage.clear()
      sessionStorage.clear()
      if ('caches' in window) {
        const names = await caches.keys()
        await Promise.all(names.map((n) => caches.delete(n)))
      }
    })
    await page.goto('about:blank')
    await page.waitForTimeout(1000)
    await page.goto('/setup', { waitUntil: 'networkidle' })
    await expect(bootstrapTitle).toBeVisible({ timeout: 30000 })
  }

  // Click "Get Started"
  await page.getByRole('button', { name: /get started/i }).click()

  // Create PIN
  await enterSetupPin(page, TEST_PIN)

  // Wait for confirm step to render (prevent Enter bleed from create step)
  await page.getByText('Confirm your PIN').waitFor({ state: 'visible', timeout: 5000 })

  // Confirm PIN
  await enterSetupPin(page, TEST_PIN)

  // Wait for keypair generation + recovery key display (PBKDF2 600K — slow)
  const recoveryKey = page.getByTestId('recovery-key')
  await expect(recoveryKey).toBeVisible({ timeout: 90000 })

  // Log all console output to help debug failures
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warn') {
      console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`)
    }
  })
  page.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`))

  // Download backup (required before continuing)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /download encrypted backup/i }).click()
  const download = await downloadPromise
  console.log(`[SETUP] Backup downloaded: ${download.suggestedFilename()}`)

  // Acknowledge backup saved
  await page.getByText('I have saved my recovery key').click()
  console.log('[SETUP] Backup acknowledged')

  // Continue to setup wizard — this triggers importKey (PBKDF2 600K) + signIn
  const continueBtn = page.getByRole('button', { name: /continue to setup/i })
  await expect(continueBtn).toBeEnabled({ timeout: 5000 })
  console.log('[SETUP] Clicking Continue to Setup...')
  await continueBtn.click()
  console.log('[SETUP] Continue clicked, waiting for Setup Wizard (PBKDF2 + signIn)...')

  // Wait for setup wizard to load — importKey + signIn can take 30s+ on CI
  await expect(page.getByText('Setup Wizard')).toBeVisible({ timeout: 120000 })
  await expect(page.getByText('Identity', { exact: true })).toBeVisible()

  // Complete identity step (minimum for functional hub)
  await page.locator('#hotline-name').fill(`Test Hotline ${Date.now()}`)
  await page.locator('#org-name').fill('Test Organization')
  await page.getByRole('button', { name: /next/i }).click()

  // Wait for step 2 to confirm identity was saved
  await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 10000 })

  // Select Reports channel (lightweight, no provider needed)
  const reportsChannel = page
    .locator('[role="button"][aria-pressed]')
    .filter({ hasText: 'Reports' })
  await reportsChannel.click()
  await page.getByRole('button', { name: /next/i }).click()
  await page.waitForTimeout(1000)

  // Skip remaining wizard steps (providers, settings, invite users)
  for (let i = 0; i < 3; i++) {
    const skipBtn = page.getByRole('button', { name: /skip/i })
    await skipBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    if (await skipBtn.isVisible().catch(() => false)) {
      await skipBtn.click()
      await page.waitForTimeout(1000)
    }
  }

  // Summary step — click "Go to Dashboard"
  await expect(page.getByText('Review & Launch')).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: /go to dashboard/i }).click()

  // Wait for either dashboard or profile-setup
  const dashboardHeading = page.getByRole('heading', { name: 'Dashboard', exact: true })
  const profileSetupHeading = page.getByRole('heading', { name: 'Welcome!' })

  const destination = await Promise.race([
    dashboardHeading.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'dashboard' as const),
    profileSetupHeading
      .waitFor({ state: 'visible', timeout: 30000 })
      .then(() => 'profile-setup' as const),
  ])

  if (destination === 'profile-setup') {
    // Complete profile setup
    await page.getByRole('button', { name: /complete setup/i }).click()
    await expect(dashboardHeading).toBeVisible({ timeout: 15000 })
  }
}

/**
 * Create an invite for a role and complete onboarding in a new context.
 * Returns after saving the new user's storage state.
 */
async function createRoleAccount(
  adminPage: import('@playwright/test').Page,
  browser: import('@playwright/test').Browser,
  opts: {
    name: string
    phone: string
    roleName: string
    storageFile: string
  }
) {
  // Navigate to Users page — wait for data to load before interacting
  await adminPage.getByRole('link', { name: 'Users' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 10000 })
  // Wait for the page data to settle (React Query fetch + render)
  await adminPage.waitForLoadState('networkidle')
  await adminPage.waitForTimeout(1000)

  // Click "Invite User"
  const inviteBtn = adminPage.getByRole('button', { name: /invite user/i })
  await inviteBtn.waitFor({ state: 'visible', timeout: 10000 })
  await inviteBtn.click()

  // Fill invite form
  await adminPage.getByLabel('Name').fill(opts.name)
  await adminPage.locator('#invite-phone').fill(opts.phone)
  await adminPage.locator('#invite-phone').blur()
  await adminPage.waitForTimeout(500)

  // Select role from dropdown (shadcn Select with id="invite-role")
  const roleDisplayNames: Record<string, string> = {
    'hub-admin': 'Hub Admin',
    volunteer: 'Volunteer',
    reviewer: 'Reviewer',
    reporter: 'Reporter',
  }
  const roleTrigger = adminPage.locator('#invite-role')
  if (await roleTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
    await roleTrigger.click()
    await adminPage.waitForTimeout(500)
    const displayName = roleDisplayNames[opts.roleName]
    if (displayName) {
      // Radix Select options have role="option" — filter by exact text within options only
      const option = adminPage.locator('[role="option"]').getByText(displayName, { exact: true })
      await option.click({ timeout: 5000 })
    }
  }

  // Create invite
  await adminPage.getByRole('button', { name: /create invite/i }).click()

  // Wait for invite link to appear
  const inviteLinkEl = adminPage.getByTestId('invite-link-code')
  await expect(inviteLinkEl).toBeVisible({ timeout: 15000 })
  const inviteLink = await inviteLinkEl.textContent()
  if (!inviteLink) throw new Error(`Failed to get invite link for ${opts.name}`)

  // Dismiss all overlays — send invite dialog, invite link card
  // Press Escape repeatedly to close any dialogs.
  // IMPORTANT: Space presses >500ms apart to avoid triggering panic wipe
  // (3 Escapes within 1 second triggers emergency key destruction).
  for (let i = 0; i < 3; i++) {
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(1200)
  }
  // Also click dismiss button if still visible
  const dismissBtn = adminPage.getByTestId('dismiss-invite').first()
  if (await dismissBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dismissBtn.click()
    await adminPage.waitForTimeout(300)
  }

  // Open new browser context for the invited user
  const userContext = await browser.newContext()
  const userPage = await userContext.newPage()

  try {
    await userPage.goto(inviteLink, { waitUntil: 'networkidle' })
    console.log(`[SETUP] ${opts.name}: landed on ${userPage.url()}`)

    // Wait for welcome page — may show error if invite is invalid
    const welcomeOrError = await Promise.race([
      userPage
        .getByText(/welcome/i)
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => 'welcome' as const),
      userPage
        .getByText(/invalid invite/i)
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => 'invalid' as const),
      userPage
        .getByText(/no invite code/i)
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => 'no-code' as const),
    ])
    if (welcomeOrError !== 'welcome') {
      throw new Error(`Invite for ${opts.name} failed: ${welcomeOrError} (link: ${inviteLink})`)
    }

    // Click "Get Started"
    await userPage.getByRole('button', { name: /get started/i }).click()

    // Create PIN
    await enterSetupPin(userPage, TEST_PIN)

    // Wait for confirm step to render (prevent Enter bleed from create step)
    await userPage.getByText('Confirm your PIN').waitFor({ state: 'visible', timeout: 5000 })

    // Confirm PIN
    await enterSetupPin(userPage, TEST_PIN)

    // Wait for keypair generation + recovery key (PBKDF2 600K — slow)
    const recoveryKey = userPage.getByTestId('recovery-key')
    await expect(recoveryKey).toBeVisible({ timeout: 90000 })

    // Download backup — triggers blob download via <a> element
    const userDownload = userPage.waitForEvent('download', { timeout: 15000 })
    await userPage.getByRole('button', { name: /download encrypted backup/i }).click()
    await userDownload

    // Acknowledge backup
    await userPage.getByText('I have saved my recovery key').click()

    // Continue
    await userPage.getByRole('button', { name: /continue/i }).click()

    // Wait for redirect to profile-setup or dashboard
    await userPage.waitForURL(
      (url) => {
        const path = new URL(url.toString()).pathname
        return path.includes('profile-setup') || path === '/'
      },
      { timeout: 60000 }
    )

    // Complete profile setup if redirected there
    if (userPage.url().includes('profile-setup')) {
      const completeBtn = userPage.getByRole('button', { name: /complete setup/i })
      await completeBtn.waitFor({ state: 'visible', timeout: 15000 })
      await completeBtn.click()
      await userPage.waitForURL((u) => !u.toString().includes('profile-setup'), {
        timeout: 15000,
      })
    }

    // Wait for authenticated state — dashboard or may need a moment to redirect
    await expect(userPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 30000,
    })

    // Save storage state
    await userContext.storageState({ path: opts.storageFile })
  } finally {
    await userContext.close()
  }
}

// =====================================================================
// Global setup test suite — runs once before all other test projects
// =====================================================================

test.describe('Global Setup: Provision Test Accounts', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 })

  test('reset database and bootstrap admin', async ({ page, request, browser }) => {
    // Retry reset in case the server is still initializing
    let resetOk = false
    for (let i = 0; i < 10; i++) {
      try {
        const res = await request.post('/api/test-reset-no-admin', {
          headers: { 'X-Test-Secret': TEST_RESET_SECRET },
        })
        if (res.ok()) {
          resetOk = true
          break
        }
        if (res.status() === 404) {
          throw new Error(
            'test-reset-no-admin returned 404 — ENVIRONMENT must be set to "development".'
          )
        }
        console.log(`[SETUP] Reset attempt ${i + 1}: status ${res.status()}`)
      } catch (err) {
        if (err instanceof Error && err.message.includes('returned 404')) throw err
        console.log(`[SETUP] Reset attempt ${i + 1}: ${(err as Error).message}`)
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    if (!resetOk) throw new Error('test-reset-no-admin never returned 200 after 10 retries')

    // Defense in depth: verify the reset actually worked at two levels.
    // (1) Direct DB query — authoritative, no caches involved.
    // (2) /api/config needsBootstrap — catches stale config cache issues.
    let dbClean = await verifyDbResetClean()
    let dbRetry = 0
    while (!dbClean && dbRetry < 3) {
      console.log(
        `[SETUP] DB verification failed — super-admin still present (retry ${dbRetry + 1}/3)`
      )
      const retryRes = await request.post('/api/test-reset-no-admin', {
        headers: { 'X-Test-Secret': TEST_RESET_SECRET },
      })
      if (!retryRes.ok()) throw new Error('SQL-verified retry reset failed')
      await new Promise((r) => setTimeout(r, 500))
      dbClean = await verifyDbResetClean()
      dbRetry += 1
    }
    if (!dbClean) {
      throw new Error(
        'test-reset-no-admin did not clear the DB after 3 retries — check for leaked admin users'
      )
    }

    const configRes = await request.get('/api/config')
    const config = await configRes.json()
    if (!config.needsBootstrap) {
      console.log('[SETUP] WARNING: config.needsBootstrap is false after reset — retrying reset')
      const retryRes = await request.post('/api/test-reset-no-admin', {
        headers: { 'X-Test-Secret': TEST_RESET_SECRET },
      })
      if (!retryRes.ok()) throw new Error('Config-cache retry reset failed')
      await new Promise((r) => setTimeout(r, 1000))
    }

    // Run real bootstrap flow
    await bootstrapAdmin(page)

    // Save admin storage state
    await page.context().storageState({ path: `${STORAGE_DIR}/admin.json` })

    // Save admin pubkey alongside storage — opaque refresh tokens don't contain
    // the pubkey anymore, so we can't decode it from the cookie like we could
    // with stateless JWTs. Query the DB directly.
    const postgres = (await import('postgres')).default
    const dbUrl =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://llamenos:llamenos@localhost:5433/llamenos'
    const sql = postgres(dbUrl, { max: 1 })
    try {
      const rows = await sql<Array<{ pubkey: string }>>`
        SELECT pubkey FROM users WHERE roles::text LIKE '%"role-super-admin"%' LIMIT 1
      `
      if (rows[0]) {
        const fs = await import('node:fs')
        fs.writeFileSync(`${STORAGE_DIR}/admin-pubkey.txt`, rows[0].pubkey)
      }
    } finally {
      await sql.end()
    }
  })

  test('create hub-admin account via invite', async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: `${STORAGE_DIR}/admin.json`,
    })
    const adminPage = await adminContext.newPage()

    try {
      await unlockAndNavigateToDashboard(adminPage)

      await createRoleAccount(adminPage, browser, {
        name: 'Test Hub Admin',
        phone: '+15551000001',
        roleName: 'hub-admin',
        storageFile: `${STORAGE_DIR}/hub-admin.json`,
      })
      // Re-save admin storage state so subsequent tests get the rotated refresh token
      await adminContext.storageState({ path: `${STORAGE_DIR}/admin.json` })
    } finally {
      await adminContext.close()
    }
  })

  test('create volunteer account via invite', async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: `${STORAGE_DIR}/admin.json`,
    })
    const adminPage = await adminContext.newPage()

    try {
      await unlockAndNavigateToDashboard(adminPage)

      await createRoleAccount(adminPage, browser, {
        name: 'Test Volunteer',
        phone: '+15551000002',
        roleName: 'volunteer',
        storageFile: `${STORAGE_DIR}/volunteer.json`,
      })
      // Re-save admin storage state so subsequent tests get the rotated refresh token
      await adminContext.storageState({ path: `${STORAGE_DIR}/admin.json` })
    } finally {
      await adminContext.close()
    }
  })

  test('create reviewer account via invite', async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: `${STORAGE_DIR}/admin.json`,
    })
    const adminPage = await adminContext.newPage()

    try {
      await unlockAndNavigateToDashboard(adminPage)

      await createRoleAccount(adminPage, browser, {
        name: 'Test Reviewer',
        phone: '+15551000003',
        roleName: 'reviewer',
        storageFile: `${STORAGE_DIR}/reviewer.json`,
      })
      // Re-save admin storage state so subsequent tests get the rotated refresh token
      await adminContext.storageState({ path: `${STORAGE_DIR}/admin.json` })
    } finally {
      await adminContext.close()
    }
  })

  test('create reporter account via invite', async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: `${STORAGE_DIR}/admin.json`,
    })
    const adminPage = await adminContext.newPage()

    try {
      await unlockAndNavigateToDashboard(adminPage)

      await createRoleAccount(adminPage, browser, {
        name: 'Test Reporter',
        phone: '+15551000004',
        roleName: 'reporter',
        storageFile: `${STORAGE_DIR}/reporter.json`,
      })
    } finally {
      await adminContext.close()
    }
  })
})
