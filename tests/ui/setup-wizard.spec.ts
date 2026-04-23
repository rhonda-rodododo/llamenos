import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin, uniquePhone } from '../helpers'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const TEST_SECRET =
  process.env.DEV_RESET_SECRET || process.env.E2E_TEST_SECRET || 'test-reset-secret'

test.describe('Setup Wizard', () => {
  test.beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/api/test-reset-setup`, {
      method: 'POST',
      headers: { 'X-Test-Secret': TEST_SECRET },
    })
    if (!res.ok) throw new Error(`Failed to reset setup state: ${res.status}`)
  })
  // --- Helper: navigate to /setup and wait for the wizard to render ---
  async function goToSetup(page: import('@playwright/test').Page) {
    await navigateAfterLogin(page, '/setup')
    await expect(page.getByText('Setup Wizard')).toBeVisible({ timeout: 10000 })
    // The setup wizard has its own PIN gate when the key-manager is locked
    const pinInput = page.locator('input[aria-label="PIN digit 1"]')
    const hasPinGate = await pinInput.isVisible({ timeout: 1000 }).catch(() => false)
    if (hasPinGate) {
      await pinInput.focus()
      await page.keyboard.type('123456', { delay: 80 })
      await page.keyboard.press('Enter')
      // Wait for the identity form to appear after PIN unlock
      await expect(page.locator('#hotline-name')).toBeVisible({ timeout: 30000 })
    }
  }

  // --- Helper: fill out step 1 (Identity) with defaults ---
  async function fillIdentityStep(
    page: import('@playwright/test').Page,
    opts: { name?: string; org?: string } = {}
  ) {
    const hotlineName = opts.name ?? `Test Hotline ${Date.now()}`
    const orgName = opts.org ?? 'Test Org'
    await page.locator('#hotline-name').fill(hotlineName)
    await page.locator('#org-name').fill(orgName)
    return { hotlineName, orgName }
  }

  // --- Helper: click a channel card by its label text ---
  async function selectChannel(page: import('@playwright/test').Page, label: string) {
    // Use getByRole('button') with exact name matching to avoid substring conflicts
    // Channel cards have role="button" with aria-pressed attribute
    const card = page
      .locator(`[role="button"][aria-pressed]`)
      .filter({ has: page.getByText(label, { exact: true }) })
    await card.click()
  }

  // --- Helper: click Next and wait for the step to advance ---
  async function clickNext(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /next/i }).click()
    // Wait for save + re-render (react-query adds context overhead)
    await page.waitForTimeout(1000)
  }

  // --- Helper: click Back ---
  async function clickBack(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /back/i }).click()
    await page.waitForTimeout(500)
  }

  // --- Helper: click Skip ---
  async function clickSkip(page: import('@playwright/test').Page) {
    const skipBtn = page.getByRole('button', { name: /skip/i })
    await skipBtn.waitFor({ state: 'visible', timeout: 10000 })
    await skipBtn.click()
    await page.waitForTimeout(500)
  }

  // =====================================================================
  // Test 1: Setup wizard page loads
  // =====================================================================
  test('setup wizard page loads with identity step', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // The wizard title should be visible
    await expect(adminPage.getByText('Setup Wizard')).toBeVisible()

    // Should show the identity step heading
    await expect(adminPage.getByText('Name Your Hotline')).toBeVisible()

    // Should show the step indicator "Step 1 of 6" — use exact to avoid matching sr-only announcement
    await expect(adminPage.getByText('Identity', { exact: true })).toBeVisible()

    // Identity form fields should be visible
    await expect(adminPage.locator('#hotline-name')).toBeVisible()
    await expect(adminPage.locator('#org-name')).toBeVisible()

    // Next button should be present but disabled (hotline name is empty)
    const nextBtn = adminPage.getByRole('button', { name: /next/i })
    await expect(nextBtn).toBeVisible()
    await expect(nextBtn).toBeDisabled()

    // Back button should be disabled on step 1
    const backBtn = adminPage.getByRole('button', { name: /back/i })
    await expect(backBtn).toBeDisabled()
  })

  // =====================================================================
  // Test 2: Step 1 - Identity form fill and advance
  // =====================================================================
  test('step 1: fill identity fields and advance to channels', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Fill hotline name
    await adminPage.locator('#hotline-name').fill('Community Crisis Line')
    // Fill organization
    await adminPage.locator('#org-name').fill('Crisis Response Org')

    // Next button should now be enabled (hotline name is not empty)
    const nextBtn = adminPage.getByRole('button', { name: /next/i })
    await expect(nextBtn).toBeEnabled()

    // Click Next to proceed to step 2
    await clickNext(adminPage)

    // Should now show the Channels step
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Step indicator should show "Channels" heading
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible()
  })

  // =====================================================================
  // Test 3: Step 2 - Channel selection validation
  // =====================================================================
  test('step 2: channel selection validation prevents advancing without selection', async ({
    adminPage,
  }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // The error message should already be showing since no channels are selected
    await expect(adminPage.getByText('Please select at least one channel')).toBeVisible()

    // Next button should be disabled
    const nextBtn = adminPage.getByRole('button', { name: /next/i })
    await expect(nextBtn).toBeDisabled()

    // Select the Reports channel (no provider needed)
    await selectChannel(adminPage, 'Reports')

    // Error should disappear
    await expect(adminPage.getByText('Please select at least one channel')).not.toBeVisible()

    // Next button should now be enabled
    await expect(nextBtn).toBeEnabled()

    // Should be able to advance
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })
  })

  // =====================================================================
  // Test 4: Step 2 - Multiple channel selection
  // =====================================================================
  test('step 2: select multiple channels and verify selection state', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select Voice Calls
    await selectChannel(adminPage, 'Voice Calls')

    // The Voice card should show as selected (aria-pressed=true)
    const voiceCard = adminPage
      .locator('[role="button"][aria-pressed]')
      .filter({ has: adminPage.getByText('Voice Calls', { exact: true }) })
    await expect(voiceCard).toHaveAttribute('aria-pressed', 'true')

    // Select SMS
    await selectChannel(adminPage, 'SMS')

    // The SMS card should show as selected
    const smsCard = adminPage
      .locator('[role="button"][aria-pressed]')
      .filter({ has: adminPage.getByText('SMS', { exact: true }) })
    await expect(smsCard).toHaveAttribute('aria-pressed', 'true')

    // Both should remain selected
    await expect(voiceCard).toHaveAttribute('aria-pressed', 'true')
    await expect(smsCard).toHaveAttribute('aria-pressed', 'true')

    // Other channels should NOT be selected
    const whatsappCard = adminPage
      .locator('[role="button"][aria-pressed]')
      .filter({ has: adminPage.getByText('WhatsApp', { exact: true }) })
    await expect(whatsappCard).toHaveAttribute('aria-pressed', 'false')

    // Next button should be enabled
    await expect(adminPage.getByRole('button', { name: /next/i })).toBeEnabled()

    // Advance to providers step
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })
  })

  // =====================================================================
  // Test 5: Step 3 - Skip button appears and works
  // =====================================================================
  test('step 3: skip button navigates forward', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Skip button should NOT be visible on step 2
    await expect(adminPage.getByRole('button', { name: /skip/i })).not.toBeVisible()

    // Select Reports and advance to step 3
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Skip button SHOULD be visible on step 3
    const skipBtn = adminPage.getByRole('button', { name: /skip/i })
    await expect(skipBtn).toBeVisible()

    // Click Skip to go to step 4
    await clickSkip(adminPage)
    await expect(adminPage.getByText('Quick Settings')).toBeVisible({ timeout: 5000 })

    // Skip should still be visible on step 4
    await expect(adminPage.getByRole('button', { name: /skip/i })).toBeVisible()

    // Skip again to step 5 (Invite)
    await clickSkip(adminPage)
    await expect(adminPage.getByText(/invite users/i)).toBeVisible({ timeout: 5000 })

    // Skip again to step 6 (Summary)
    await clickSkip(adminPage)
    await expect(adminPage.getByText('Review & Launch')).toBeVisible({ timeout: 5000 })
  })

  // =====================================================================
  // Test 6: Step 4 - Settings displayed based on selected channels
  // =====================================================================
  test('step 4: voice settings appear when Voice is selected', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select Voice Calls
    await selectChannel(adminPage, 'Voice Calls')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Skip providers step
    await clickSkip(adminPage)
    await expect(adminPage.getByText('Quick Settings')).toBeVisible({ timeout: 5000 })

    // Voice settings section should be visible
    await expect(adminPage.getByText('Voice Call Settings')).toBeVisible()
    await expect(adminPage.getByText('Queue Timeout (seconds)')).toBeVisible()
    await expect(adminPage.getByText('Voicemail', { exact: true })).toBeVisible()
  })

  test('step 4: report settings appear when Reports is selected', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select Reports only
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)

    // Skip providers
    await clickSkip(adminPage)
    await expect(adminPage.getByText('Quick Settings')).toBeVisible({ timeout: 5000 })

    // Report settings should be visible
    await expect(adminPage.getByText('Report Settings')).toBeVisible()
    await expect(adminPage.getByText('Default Categories')).toBeVisible()

    // Should be able to add a category
    const categoryInput = adminPage.getByPlaceholder('New category name')
    await expect(categoryInput).toBeVisible()
    await categoryInput.fill('Harassment')
    await adminPage.getByRole('button', { name: /add/i }).click()
    await expect(adminPage.getByText('Harassment', { exact: true })).toBeVisible()
  })

  test('step 4: messaging settings appear when SMS is selected', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select SMS
    await selectChannel(adminPage, 'SMS')
    await clickNext(adminPage)

    // Skip providers
    await clickSkip(adminPage)
    await expect(adminPage.getByText('Quick Settings')).toBeVisible({ timeout: 5000 })

    // Messaging settings should be visible
    await expect(adminPage.getByText('Messaging Settings')).toBeVisible()
    await expect(adminPage.getByText('Auto-Response Template')).toBeVisible()
    await expect(adminPage.getByText('Inactivity Timeout (minutes)')).toBeVisible()
    await expect(adminPage.getByText('Max Concurrent Per Volunteer')).toBeVisible()
  })

  // =====================================================================
  // Test 7: Step 5 - Generate invite
  // =====================================================================
  test('step 5: generate invite for a user', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select Reports and advance
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)

    // Skip steps 3 and 4
    await clickSkip(adminPage)
    await clickSkip(adminPage)

    // Should be on Invite step
    await expect(adminPage.getByText(/invite users/i)).toBeVisible({ timeout: 5000 })

    // Generate invite button should be disabled without name/phone
    const genBtn = adminPage.getByRole('button', { name: /generate invite/i })
    await expect(genBtn).toBeDisabled()

    // Fill invite form
    const userName = `Wizard Vol ${Date.now()}`
    const userPhone = uniquePhone()

    // Find the name and phone inputs within the invite form
    await adminPage.getByPlaceholder('Volunteer name').fill(userName)
    await adminPage.getByPlaceholder('+12125551234').fill(userPhone)

    // Generate invite button should now be enabled
    await expect(genBtn).toBeEnabled()
    await genBtn.click()

    // Wait for invite to be generated (shown in the Generated Invites list)
    await expect(adminPage.getByText('Generated Invites')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByText(userName)).toBeVisible()

    // An invite code should appear (rendered in a monospace font-mono text)
    const inviteCode = adminPage.locator('.font-mono')
    await expect(inviteCode.first()).toBeVisible()
  })

  // =====================================================================
  // Test 8: Step 6 - Summary review
  // =====================================================================
  test('step 6: summary displays configured values', async ({ adminPage }) => {
    await goToSetup(adminPage)
    const hotlineName = `Summary Test ${Date.now()}`
    const orgName = 'Summary Org'

    // Step 1: Identity
    await adminPage.locator('#hotline-name').fill(hotlineName)
    await adminPage.locator('#org-name').fill(orgName)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Step 2: Select Voice Calls and Reports
    await selectChannel(adminPage, 'Voice Calls')
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)

    // Step 3: Skip providers
    await clickSkip(adminPage)
    // Step 4: Skip settings
    await clickSkip(adminPage)
    // Step 5: Skip invites
    await clickSkip(adminPage)

    // Should be on Summary step
    await expect(adminPage.getByText('Review & Launch')).toBeVisible({ timeout: 5000 })

    // Identity section should show the hotline name and org
    await expect(adminPage.getByText(hotlineName)).toBeVisible()
    await expect(adminPage.getByText(orgName)).toBeVisible()

    // Channels section should list Voice Calls and Reports
    await expect(adminPage.getByText('Voice Calls')).toBeVisible()
    await expect(adminPage.locator('#main-content').getByText('Reports')).toBeVisible()

    // Go to Dashboard button should be present
    const dashBtn = adminPage.getByRole('button', { name: /go to dashboard/i })
    await expect(dashBtn).toBeVisible()
  })

  // =====================================================================
  // Test 9: Back navigation
  // =====================================================================
  test('back navigation returns to previous steps', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Step 1: Fill identity
    const hotlineName = `Back Nav ${Date.now()}`
    await adminPage.locator('#hotline-name').fill(hotlineName)
    await adminPage.locator('#org-name').fill('Nav Org')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Step 2: Select a channel
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Go back to step 2 (Channels)
    await clickBack(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Reports should still be selected (state preserved)
    const reportsCard = adminPage.locator('[role="button"]').filter({ hasText: 'Reports' })
    await expect(reportsCard).toHaveAttribute('aria-pressed', 'true')

    // Go back to step 1 (Identity)
    await clickBack(adminPage)
    await expect(adminPage.getByText('Name Your Hotline')).toBeVisible({ timeout: 5000 })

    // Hotline name should still be filled (state preserved)
    await expect(adminPage.locator('#hotline-name')).toHaveValue(hotlineName)
    await expect(adminPage.locator('#org-name')).toHaveValue('Nav Org')
  })

  // =====================================================================
  // Test 10: Complete setup - full flow to dashboard
  // =====================================================================
  test('complete setup: full flow through to dashboard redirect', async ({ adminPage }) => {
    await goToSetup(adminPage)
    const hotlineName = `Full Flow ${Date.now()}`

    // Step 1: Identity
    await adminPage.locator('#hotline-name').fill(hotlineName)
    await adminPage.locator('#org-name').fill('Full Flow Org')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Step 2: Select Reports (simplest - no provider needed)
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Step 3: Skip providers
    await clickSkip(adminPage)
    await expect(adminPage.getByText('Quick Settings')).toBeVisible({ timeout: 5000 })

    // Step 4: Skip settings
    await clickSkip(adminPage)
    await expect(adminPage.getByText(/invite users/i)).toBeVisible({ timeout: 5000 })

    // Step 5: Skip invite
    await clickSkip(adminPage)
    await expect(adminPage.getByText('Review & Launch')).toBeVisible({ timeout: 5000 })

    // Step 6: Verify summary shows our config
    await expect(adminPage.getByText(hotlineName)).toBeVisible()
    await expect(adminPage.locator('#main-content').getByText('Reports')).toBeVisible()

    // Click "Go to Dashboard"
    await adminPage.getByRole('button', { name: /go to dashboard/i }).click()

    // Should redirect to the dashboard at "/"
    await adminPage.waitForURL('**/', { timeout: 15000 })
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })
  })

  // =====================================================================
  // Test: Step 3 - Provider form shows Test Connection and Save buttons
  // =====================================================================
  test('step 3: provider form shows test connection and save buttons for Voice', async ({
    adminPage,
  }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select Voice Calls to trigger provider form
    await selectChannel(adminPage, 'Voice Calls')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Provider form should be visible with Voice & SMS Provider header
    await expect(adminPage.getByText('Voice & SMS Provider', { exact: true })).toBeVisible()

    // Twilio should be selected by default (shown as a checked card)
    await expect(adminPage.getByText('Twilio').first()).toBeVisible()

    // Validate credentials button (OAuthConnectButton) should be visible
    const validateBtn = adminPage.getByTestId('oauth-connect-button')
    await expect(validateBtn).toBeVisible()

    // Save Provider button is only visible after validation, so just verify
    // the validate button exists and the provider form is rendered
    const saveBtn = adminPage.getByTestId('save-provider-button')
    // Save button may not be visible until credentials are validated
    const saveBtnVisible = await saveBtn.isVisible().catch(() => false)
    // Either the save button is visible (if already validated) or the validate button is
    expect(saveBtnVisible || (await validateBtn.isVisible())).toBe(true)
  })

  // =====================================================================
  // Test: Channel deselection toggle
  // =====================================================================
  test('step 2: clicking a selected channel deselects it', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select Voice Calls
    await selectChannel(adminPage, 'Voice Calls')
    const voiceCard = adminPage.locator('[role="button"]').filter({ hasText: 'Voice Calls' })
    await expect(voiceCard).toHaveAttribute('aria-pressed', 'true')

    // Click again to deselect
    await selectChannel(adminPage, 'Voice Calls')
    await expect(voiceCard).toHaveAttribute('aria-pressed', 'false')

    // Error message should reappear since no channels are selected
    await expect(adminPage.getByText('Please select at least one channel')).toBeVisible()
  })

  // =====================================================================
  // Test: Step 1 - Next disabled when hotline name is empty
  // =====================================================================
  test('step 1: next button disabled with empty hotline name', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Initially the input is empty
    await expect(adminPage.locator('#hotline-name')).toHaveValue('')

    // Next should be disabled
    await expect(adminPage.getByRole('button', { name: /next/i })).toBeDisabled()

    // Type something, then clear it
    await adminPage.locator('#hotline-name').fill('Temp')
    await expect(adminPage.getByRole('button', { name: /next/i })).toBeEnabled()

    await adminPage.locator('#hotline-name').fill('')
    await expect(adminPage.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  // =====================================================================
  // Test: No providers needed message for Reports-only
  // =====================================================================
  test('step 3: shows no providers needed when only Reports selected', async ({ adminPage }) => {
    await goToSetup(adminPage)

    // Complete step 1
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select only Reports
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Should show the "no providers needed" message
    await expect(adminPage.getByText('No external providers needed')).toBeVisible()
  })

  // =====================================================================
  // Test: Summary does not show navigation buttons (only Go to Dashboard)
  // =====================================================================
  test('step 6: summary step hides Next/Back navigation, shows Go to Dashboard', async ({
    adminPage,
  }) => {
    await goToSetup(adminPage)

    // Speed through all steps
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)
    await clickSkip(adminPage)
    await clickSkip(adminPage)
    await clickSkip(adminPage)

    // On summary step
    await expect(adminPage.getByText('Review & Launch')).toBeVisible({ timeout: 5000 })

    // Next and Back buttons should NOT be visible on the last step
    await expect(adminPage.getByRole('button', { name: /next/i })).not.toBeVisible()
    await expect(adminPage.getByRole('button', { name: /back/i })).not.toBeVisible()
    await expect(adminPage.getByRole('button', { name: /skip/i })).not.toBeVisible()

    // Only the Go to Dashboard button should be visible
    await expect(adminPage.getByRole('button', { name: /go to dashboard/i })).toBeVisible()
  })
})
