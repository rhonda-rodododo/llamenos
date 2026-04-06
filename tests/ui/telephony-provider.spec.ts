import { expect, test } from '../fixtures/auth'
import { enterPin, navigateAfterLogin, reenterPinAfterReload } from '../helpers'

test.describe('Phone Provider Settings', () => {
  test('phone provider section is accessible from admin nav', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await expect(adminPage.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
      timeout: 10000,
    })
  })

  test('provider dropdown shows all providers', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')

    const select = adminPage.getByTestId('admin-phone-provider-provider-select')
    await expect(select).toBeVisible({ timeout: 10000 })
    await select.click()

    await expect(adminPage.getByRole('option', { name: 'Twilio' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'SignalWire' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Vonage' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Plivo' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Asterisk (Self-Hosted)' })).toBeVisible()
    // Close the dropdown
    await adminPage.keyboard.press('Escape')
  })

  test('changing provider updates credential form fields', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await expect(adminPage.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
      timeout: 10000,
    })

    // Open the Advanced panel to reveal credential fields
    await adminPage.getByTestId('admin-advanced-reveal-phone-provider').click()

    // Select Twilio
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'Twilio' }).click()
    await expect(adminPage.getByTestId('admin-phone-provider-account-sid-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-phone-provider-auth-token-input')).toBeVisible()

    // Switch to SignalWire
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'SignalWire' }).click()
    await expect(adminPage.getByTestId('admin-phone-provider-signalwire-space-input')).toBeVisible()

    // Switch to Vonage
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'Vonage' }).click()
    await expect(adminPage.getByTestId('admin-phone-provider-api-key-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-phone-provider-api-secret-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-phone-provider-application-id-input')).toBeVisible()

    // Switch to Plivo
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'Plivo' }).click()
    await expect(adminPage.getByTestId('admin-phone-provider-auth-id-input')).toBeVisible()

    // Switch to Asterisk
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'Asterisk (Self-Hosted)' }).click()
    await expect(adminPage.getByTestId('admin-phone-provider-ari-url-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-phone-provider-ari-username-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-phone-provider-ari-password-input')).toBeVisible()
    await expect(
      adminPage.getByTestId('admin-phone-provider-bridge-callback-url-input')
    ).toBeVisible()
  })

  test('save button disabled when phone number is empty', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await expect(adminPage.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
      timeout: 10000,
    })

    // Select Twilio
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'Twilio' }).click()

    // Clear any pre-filled phone number
    const phoneInput = adminPage.locator('input[type="tel"]')
    await phoneInput.fill('')

    await expect(adminPage.getByTestId('admin-phone-provider-save')).toBeDisabled()
  })

  test('admin can save Twilio provider config', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await expect(adminPage.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
      timeout: 10000,
    })

    // Select Twilio
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'Twilio' }).click()

    // Open advanced for credentials
    await adminPage.getByTestId('admin-advanced-reveal-phone-provider').click()

    // Fill in Twilio credentials
    await adminPage.locator('input[type="tel"]').fill('+15551234567')
    await adminPage.getByTestId('admin-phone-provider-account-sid-input').fill('AC1234567890abcdef')
    await adminPage.getByTestId('admin-phone-provider-auth-token-input').fill('test-auth-token-123')

    // Save
    const saveButton = adminPage.getByTestId('admin-phone-provider-save')
    await expect(saveButton).toBeEnabled()
    await saveButton.click()

    // Should show success toast
    await expect(adminPage.getByTestId('admin-phone-provider-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Should now show current-provider banner with Twilio
    await expect(
      adminPage.getByTestId('admin-phone-provider-current-provider-banner')
    ).toContainText(/twilio/i)
  })

  test('saved provider config persists after page reload', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await expect(adminPage.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
      timeout: 10000,
    })

    // Open advanced for credentials
    await adminPage.getByTestId('admin-advanced-reveal-phone-provider').click()

    // Save a config with unique values
    const uniqueSid = `AC${Date.now().toString(16)}`
    await adminPage.locator('input[type="tel"]').fill('+15559876543')
    await adminPage.getByTestId('admin-phone-provider-account-sid-input').fill(uniqueSid)
    await adminPage.getByTestId('admin-phone-provider-auth-token-input').fill('test-auth-token-456')

    await adminPage.getByTestId('admin-phone-provider-save').click()
    await expect(adminPage.getByTestId('admin-phone-provider-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Reload clears keyManager — go to /login to re-enter PIN
    await adminPage.goto('/login', { waitUntil: 'networkidle' })
    const pinInput = adminPage.locator('input[aria-label="PIN digit 1"]')
    await pinInput.waitFor({ state: 'visible', timeout: 30000 })
    // Wait for CSS transitions to settle before focusing
    await adminPage.waitForTimeout(1000)
    await enterPin(adminPage, '123456')
    // Wait for unlock (PBKDF2 is slow under parallel workers)
    await adminPage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
    // Navigate back to the section
    await navigateAfterLogin(adminPage, '/admin/phone-provider')

    // Should show current provider banner
    await expect(
      adminPage.getByTestId('admin-phone-provider-current-provider-banner')
    ).toBeVisible()

    // Open advanced and verify account SID is populated
    await adminPage.getByTestId('admin-advanced-reveal-phone-provider').click()
    const accountSidInput = adminPage.getByTestId('admin-phone-provider-account-sid-input')
    await expect(accountSidInput).toBeVisible({ timeout: 10000 })
    await expect(accountSidInput).not.toHaveValue('')
  })

  test('admin can save SignalWire provider config', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await expect(adminPage.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
      timeout: 10000,
    })

    // Switch to SignalWire
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'SignalWire' }).click()

    // Open advanced for credentials
    await adminPage.getByTestId('admin-advanced-reveal-phone-provider').click()

    // Fill in SignalWire credentials
    await adminPage.locator('input[type="tel"]').fill('+15551112222')
    await adminPage.getByTestId('admin-phone-provider-account-sid-input').fill('SW-project-id-123')
    await adminPage.getByTestId('admin-phone-provider-auth-token-input').fill('sw-auth-token-789')
    await adminPage.getByTestId('admin-phone-provider-signalwire-space-input').fill('myhotline')

    // Save
    await adminPage.getByTestId('admin-phone-provider-save').click()
    await expect(adminPage.getByTestId('admin-phone-provider-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Should show current provider as SignalWire
    await expect(
      adminPage.getByTestId('admin-phone-provider-current-provider-banner')
    ).toContainText(/signalwire/i)
  })

  test('test connection button works (will fail with fake creds)', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-provider')
    await expect(adminPage.getByTestId('admin-phone-provider-provider-select')).toBeVisible({
      timeout: 10000,
    })

    // Select Twilio
    await adminPage.getByTestId('admin-phone-provider-provider-select').click()
    await adminPage.getByRole('option', { name: 'Twilio' }).click()

    // Open advanced for credentials
    await adminPage.getByTestId('admin-advanced-reveal-phone-provider').click()

    await adminPage.locator('input[type="tel"]').fill('+15551234567')
    await adminPage.getByTestId('admin-phone-provider-account-sid-input').fill('ACfake123')
    await adminPage.getByTestId('admin-phone-provider-auth-token-input').fill('fake-token')

    // Click Test Connection
    await adminPage.getByTestId('admin-phone-provider-test-button').click()

    // Should show failure result banner
    await expect(adminPage.getByTestId('admin-phone-provider-test-result')).toBeVisible({
      timeout: 15000,
    })
  })
})
