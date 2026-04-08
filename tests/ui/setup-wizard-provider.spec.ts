import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const TEST_SECRET =
  process.env.DEV_RESET_SECRET || process.env.E2E_TEST_SECRET || 'test-reset-secret'

test.describe('Setup Wizard - Provider Module', () => {
  test.beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/api/test-reset-setup`, {
      method: 'POST',
      headers: { 'X-Test-Secret': TEST_SECRET },
    })
    if (!res.ok) throw new Error(`Failed to reset setup state: ${res.status}`)
  })
  // Helper: navigate to /setup and wait for the wizard
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
      await expect(page.locator('#hotline-name')).toBeVisible({ timeout: 30000 })
    }
  }

  // Helper: fill identity step with defaults
  async function fillIdentityStep(page: import('@playwright/test').Page) {
    await page.locator('#hotline-name').fill(`Test Hotline ${Date.now()}`)
    await page.locator('#org-name').fill('Test Org')
  }

  // Helper: click a channel card by label
  async function selectChannel(page: import('@playwright/test').Page, label: string) {
    const card = page
      .locator('[role="button"][aria-pressed]')
      .filter({ has: page.getByText(label, { exact: true }) })
    await card.click()
  }

  // Helper: click Next
  async function clickNext(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /next/i }).click()
    await page.waitForTimeout(1000)
  }

  // Helper: click Skip
  async function clickSkip(page: import('@playwright/test').Page) {
    const skipBtn = page.getByRole('button', { name: /skip/i })
    await skipBtn.waitFor({ state: 'visible', timeout: 10000 })
    await skipBtn.click()
    await page.waitForTimeout(500)
  }

  // Helper: navigate to step 3 with Voice selected
  async function goToVoiceProviderStep(page: import('@playwright/test').Page) {
    await goToSetup(page)
    await fillIdentityStep(page)
    await clickNext(page)
    await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 5000 })
    await selectChannel(page, 'Voice Calls')
    await clickNext(page)
    await expect(page.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })
  }

  // =====================================================================
  // Test: Voice provider form shows validate button
  // =====================================================================
  test('voice provider step shows validate credentials button', async ({ adminPage }) => {
    await goToVoiceProviderStep(adminPage)

    // Should see the provider form
    await expect(adminPage.getByText('Voice & SMS Provider')).toBeVisible()

    // Provider cards should be visible
    await expect(adminPage.getByText('Twilio', { exact: true }).first()).toBeVisible()

    // Validate button should be visible
    const validateBtn = adminPage.getByTestId('oauth-connect-button')
    await expect(validateBtn).toBeVisible()
  })

  // =====================================================================
  // Test: Provider selection changes credential fields
  // =====================================================================
  test('selecting different providers changes visible credential fields', async ({ adminPage }) => {
    await goToVoiceProviderStep(adminPage)

    // Twilio is default — should show Account SID and Auth Token
    await expect(adminPage.getByTestId('account-sid')).toBeVisible()
    await expect(adminPage.getByTestId('auth-token')).toBeVisible()

    // Switch to Asterisk
    const asteriskCard = adminPage
      .locator('.cursor-pointer')
      .filter({ hasText: 'Asterisk (Self-Hosted)' })
    await asteriskCard.click()

    // Should show Asterisk-specific fields
    await expect(adminPage.getByText('ARI URL')).toBeVisible()
    await expect(adminPage.getByText('ARI Username')).toBeVisible()
    await expect(adminPage.getByText('ARI Password')).toBeVisible()

    // Twilio fields should not be visible
    await expect(adminPage.getByTestId('account-sid')).not.toBeVisible()
  })

  // =====================================================================
  // Test: Phone number input is available
  // =====================================================================
  test('phone number input is visible in provider step', async ({ adminPage }) => {
    await goToVoiceProviderStep(adminPage)

    // Phone number input should be visible
    const phoneInput = adminPage.getByTestId('phone-number-input')
    await expect(phoneInput).toBeVisible()

    // Should show validate-first message when not connected
    await expect(
      adminPage.getByText('Validate your provider credentials to see available phone numbers.')
    ).toBeVisible()
  })

  // =====================================================================
  // Test: Signal provider step shows bridge configuration
  // =====================================================================
  test('signal provider step shows bridge configuration fields', async ({ adminPage }) => {
    await goToSetup(adminPage)
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select Signal
    await selectChannel(adminPage, 'Signal')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Should show Signal bridge section
    await expect(adminPage.getByRole('heading', { name: 'Signal Bridge' })).toBeVisible()

    // Should show E2EE note
    await expect(adminPage.getByText(/Signal provides end-to-end encryption/)).toBeVisible()

    // Should show prerequisites
    await expect(adminPage.getByText('Prerequisites')).toBeVisible()
    await expect(adminPage.getByText(/Linux server with Docker/)).toBeVisible()

    // Should show Docker command
    await expect(adminPage.getByText('Docker Run Command')).toBeVisible()
    await expect(adminPage.getByText(/signal-cli-rest-api/)).toBeVisible()

    // Should show input fields
    await expect(adminPage.getByTestId('signal-bridge-url')).toBeVisible()
    await expect(adminPage.getByTestId('signal-api-key')).toBeVisible()
    await expect(adminPage.getByTestId('signal-webhook-secret')).toBeVisible()
    await expect(adminPage.getByTestId('signal-registered-number')).toBeVisible()

    // Test connection button should be visible but disabled (no URL)
    const testBtn = adminPage.getByTestId('test-signal-connection')
    await expect(testBtn).toBeVisible()
    await expect(testBtn).toBeDisabled()
  })

  // =====================================================================
  // Test: Signal test connection button enables with URL
  // =====================================================================
  test('signal test connection button enables when bridge URL is entered', async ({
    adminPage,
  }) => {
    await goToSetup(adminPage)
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    await selectChannel(adminPage, 'Signal')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    const testBtn = adminPage.getByTestId('test-signal-connection')
    await expect(testBtn).toBeDisabled()

    // Enter a bridge URL
    await adminPage.getByTestId('signal-bridge-url').fill('https://signal.example.com:8080')

    // Test button should now be enabled
    await expect(testBtn).toBeEnabled()
  })

  // =====================================================================
  // Test: Webhook URLs shown after validation
  // =====================================================================
  test('webhook confirmation component renders with correct URLs', async ({ adminPage }) => {
    await goToVoiceProviderStep(adminPage)

    // Initially, webhook URLs should NOT be visible (not validated yet)
    await expect(adminPage.getByTestId('webhook-confirmation')).not.toBeVisible()
  })

  // =====================================================================
  // Test: Multiple channels show multiple provider forms
  // =====================================================================
  test('selecting voice and signal shows both provider forms', async ({ adminPage }) => {
    await goToSetup(adminPage)
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Select both Voice and Signal
    await selectChannel(adminPage, 'Voice Calls')
    await selectChannel(adminPage, 'Signal')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Both forms should be visible
    await expect(adminPage.getByText('Voice & SMS Provider')).toBeVisible()
    await expect(adminPage.getByRole('heading', { name: 'Signal Bridge' })).toBeVisible()
  })

  // =====================================================================
  // Test: Full flow with provider step
  // =====================================================================
  test('complete setup flow through provider step to dashboard', async ({ adminPage }) => {
    await goToSetup(adminPage)
    const hotlineName = `Provider Flow ${Date.now()}`

    // Step 1: Identity
    await adminPage.locator('#hotline-name').fill(hotlineName)
    await adminPage.locator('#org-name').fill('Provider Test Org')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })

    // Step 2: Select Voice and Reports
    await selectChannel(adminPage, 'Voice Calls')
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)
    await expect(adminPage.getByText('Configure Providers')).toBeVisible({ timeout: 5000 })

    // Step 3: Voice provider form is shown
    await expect(adminPage.getByText('Voice & SMS Provider')).toBeVisible()
    await expect(adminPage.getByText('Twilio', { exact: true }).first()).toBeVisible()

    // Skip to continue (no real credentials to test)
    await clickSkip(adminPage)
    await expect(adminPage.getByText('Quick Settings')).toBeVisible({ timeout: 5000 })

    // Skip remaining steps
    await clickSkip(adminPage) // Settings
    await clickSkip(adminPage) // Invite

    // Step 6: Summary
    await expect(adminPage.getByText('Review & Launch')).toBeVisible({ timeout: 5000 })
    await expect(adminPage.getByText(hotlineName)).toBeVisible()

    // Voice should show as pending (not validated)
    await expect(adminPage.getByText('Pending')).toBeVisible()

    // Complete setup
    await adminPage.getByRole('button', { name: /go to dashboard/i }).click()
    await adminPage.waitForURL('**/', { timeout: 15000 })
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })
  })

  // =====================================================================
  // Test: Channel Settings on admin settings page
  // =====================================================================
  test('channel settings section appears on admin settings page', async ({ adminPage }) => {
    // First complete setup
    await goToSetup(adminPage)
    await fillIdentityStep(adminPage)
    await clickNext(adminPage)
    await expect(adminPage.getByText('Choose Communication Channels')).toBeVisible({
      timeout: 5000,
    })
    await selectChannel(adminPage, 'Reports')
    await clickNext(adminPage)
    await clickSkip(adminPage) // Providers
    await clickSkip(adminPage) // Settings
    await clickSkip(adminPage) // Invite
    await adminPage.getByRole('button', { name: /go to dashboard/i }).click()
    await adminPage.waitForURL('**/', { timeout: 15000 })

    // Navigate to the Messaging / SMS admin section (formerly "Channels" under
    // the flat collapsible settings page).
    await navigateAfterLogin(adminPage, '/admin/messaging-sms')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'messaging-sms',
      { timeout: 10000 }
    )
    await expect(adminPage.getByTestId('admin-section-heading')).toBeVisible()
  })
})
