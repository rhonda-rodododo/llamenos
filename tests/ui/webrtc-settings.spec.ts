import { expect, test } from '../fixtures/auth'
import { enterPin, navigateAfterLogin, reenterPinAfterReload } from '../helpers'

async function gotoPhoneProvider(page: import('@playwright/test').Page) {
  await navigateAfterLogin(page, '/admin/phone-provider')
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', 'phone-provider')
  await expect(page.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
    timeout: 10000,
  })
  // WebRTC config lives inside the Advanced section — reveal it
  const reveal = page.getByTestId('admin-advanced-reveal-phone-provider')
  const panel = page.getByTestId('admin-advanced-panel-phone-provider')
  if (!(await panel.isVisible({ timeout: 500 }).catch(() => false))) {
    await reveal.click()
  }
  await expect(panel).toBeVisible()
}

async function selectTelephonyProvider(
  page: import('@playwright/test').Page,
  label: string | RegExp
) {
  await page.getByTestId('admin-phone-provider-provider-select').click()
  await page.getByRole('option', { name: label }).click()
}

test.describe('WebRTC & Call Preference Settings', () => {
  // --- User Settings: Call Preference ---

  test('call preference section is visible in user settings', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Click to expand the Call Preference section
    await adminPage.getByText('Call Preference').first().click()
    await expect(adminPage.getByText('Phone Only')).toBeVisible()
    await expect(adminPage.getByText('Browser Only')).toBeVisible()
    await expect(adminPage.getByText('Phone + Browser')).toBeVisible()
  })

  test('phone only is selected by default', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await adminPage.getByText('Call Preference').first().click()

    // Phone Only should be the active option (has the indicator dot)
    const phoneOption = adminPage.locator('button').filter({ hasText: 'Phone Only' })
    await expect(phoneOption).toHaveClass(/border-primary/)
  })

  test('browser and both options are disabled when WebRTC not configured', async ({
    adminPage,
  }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await adminPage.getByText('Call Preference').first().click()

    // WebRTC not configured message should be visible
    await expect(adminPage.getByText(/browser calling is not available/i)).toBeVisible()

    // Browser and Both options should be disabled
    const browserOption = adminPage.locator('button').filter({ hasText: 'Browser Only' })
    const bothOption = adminPage.locator('button').filter({ hasText: 'Phone + Browser' })
    await expect(browserOption).toBeDisabled()
    await expect(bothOption).toBeDisabled()
  })

  test('deep link to call-preference section auto-expands it', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/settings?section=call-preference')
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible({
      timeout: 10000,
    })

    // The section should be expanded — we should see the preference options
    await expect(adminPage.getByText('Phone Only')).toBeVisible({ timeout: 10000 })
  })

  // --- Hub Settings: WebRTC Configuration ---

  test('WebRTC config switch appears in phone provider advanced settings', async ({
    adminPage,
  }) => {
    await gotoPhoneProvider(adminPage)
    await expect(adminPage.getByTestId('admin-phone-provider-webrtc-enabled-switch')).toBeVisible()
  })

  test('WebRTC toggle enables API key fields for Twilio', async ({ adminPage }) => {
    await gotoPhoneProvider(adminPage)

    // Initially API Key fields should not be visible (toggle is off by default on fresh DB)
    const toggle = adminPage.getByTestId('admin-phone-provider-webrtc-enabled-switch')
    if (await toggle.isChecked()) {
      // Ensure starting state is off
      await toggle.click()
    }
    await expect(adminPage.getByTestId('admin-phone-provider-api-key-sid-input')).not.toBeVisible()

    // Enable WebRTC toggle
    await toggle.click()

    // Now API Key fields should be visible (Twilio is default)
    await expect(adminPage.getByTestId('admin-phone-provider-api-key-sid-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-phone-provider-api-key-secret-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-phone-provider-twiml-app-sid-input')).toBeVisible()
  })

  test('WebRTC fields not shown for Asterisk provider', async ({ adminPage }) => {
    await gotoPhoneProvider(adminPage)

    // Switch to Asterisk
    await selectTelephonyProvider(adminPage, /Asterisk/i)

    // WebRTC toggle should NOT be visible for Asterisk
    await expect(
      adminPage.getByTestId('admin-phone-provider-webrtc-enabled-switch')
    ).not.toBeVisible()
  })

  test('WebRTC toggle shown for SignalWire provider', async ({ adminPage }) => {
    await gotoPhoneProvider(adminPage)

    // Switch to SignalWire
    await selectTelephonyProvider(adminPage, 'SignalWire')

    // WebRTC toggle should still be visible
    await expect(adminPage.getByTestId('admin-phone-provider-webrtc-enabled-switch')).toBeVisible()
  })

  test('WebRTC toggle shown for Vonage without Twilio-specific fields', async ({ adminPage }) => {
    await gotoPhoneProvider(adminPage)

    // Switch to Vonage
    await selectTelephonyProvider(adminPage, 'Vonage')

    // WebRTC toggle should be visible
    const toggle = adminPage.getByTestId('admin-phone-provider-webrtc-enabled-switch')
    await expect(toggle).toBeVisible()

    // Enable WebRTC
    if (!(await toggle.isChecked())) await toggle.click()

    // Vonage doesn't need API Key SID — should NOT show Twilio-specific fields
    await expect(adminPage.getByTestId('admin-phone-provider-api-key-sid-input')).not.toBeVisible()
    await expect(
      adminPage.getByTestId('admin-phone-provider-twiml-app-sid-input')
    ).not.toBeVisible()
  })

  test('WebRTC config persists with provider save', async ({ adminPage }) => {
    await gotoPhoneProvider(adminPage)

    // Ensure Twilio is selected
    await selectTelephonyProvider(adminPage, 'Twilio')

    // Fill in basic Twilio credentials (phone number required to enable save).
    const phoneInput = adminPage.locator('#phone-provider-phone')
    await phoneInput.click()
    await phoneInput.clear()
    await phoneInput.pressSequentially('5551234567', { delay: 30 })
    await phoneInput.press('Tab')
    await adminPage.waitForTimeout(500)
    await adminPage.getByTestId('admin-phone-provider-account-sid-input').fill('ACwebrtctest123')
    await adminPage.getByTestId('admin-phone-provider-auth-token-input').fill('webrtc-auth-token')

    // Enable WebRTC and fill API Key fields
    const toggle = adminPage.getByTestId('admin-phone-provider-webrtc-enabled-switch')
    if (!(await toggle.isChecked())) await toggle.click()

    await adminPage.getByTestId('admin-phone-provider-api-key-sid-input').fill('SKtestkey123')
    await adminPage.getByTestId('admin-phone-provider-twiml-app-sid-input').fill('APtestapp456')

    // Save
    await adminPage.getByTestId('admin-phone-provider-save').click()
    await expect(adminPage.getByTestId('admin-phone-provider-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Reload clears keyManager — block refresh to force login screen
    await adminPage.route('**/api/auth/token/refresh', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"blocked"}' })
    )
    await adminPage.reload({ waitUntil: 'domcontentloaded' })
    const pinInput2 = adminPage.locator('input[aria-label="PIN digit 1"]')
    await pinInput2.waitFor({ state: 'visible', timeout: 60000 })
    await adminPage.unroute('**/api/auth/token/refresh')
    await enterPin(adminPage, '123456')
    await adminPage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
    // Navigate back to phone provider section
    await gotoPhoneProvider(adminPage)

    // WebRTC toggle is inside AdvancedReveal (closed by default after reload)
    await adminPage.getByTestId('admin-advanced-reveal-phone-provider').click()

    // WebRTC toggle should now be on (from saved state) — wait for fields to render
    await expect(adminPage.getByTestId('admin-phone-provider-webrtc-enabled-switch')).toBeChecked({
      timeout: 10000,
    })

    // Verify WebRTC fields are populated
    await expect(adminPage.getByTestId('admin-phone-provider-api-key-sid-input')).toHaveValue(
      'SKtestkey123',
      { timeout: 10000 }
    )
    await expect(adminPage.getByTestId('admin-phone-provider-twiml-app-sid-input')).toHaveValue(
      'APtestapp456'
    )
  })
})
