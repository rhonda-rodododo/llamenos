import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { expect, test } from '../fixtures/auth'
import { TEST_PIN, enterPin, navigateAfterLogin, uniquePhone } from '../helpers'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

test.describe('PIN Challenge (Re-auth Step-up)', () => {
  test.beforeEach(async ({ request }) => {
    // Ensure at least one user with a phone exists for the toggle button
    const adminApi = createAdminApiFromStorageState(request)
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    await adminApi.post('/api/users', {
      pubkey: pk,
      name: 'PIN Test User',
      phone: uniquePhone(),
      roleIds: ['role-volunteer'],
    })
  })

  test('phone unmask on users page requires PIN', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/users')

    // Wait for users list to load and decrypt (phone field is encrypted)
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()

    // Find a user row with a phone toggle button — needs time for API response + field decryption
    const toggleBtn = adminPage.getByTestId('toggle-phone-visibility').first()
    await expect(toggleBtn).toBeVisible({ timeout: 30000 })

    // Click to unmask phone — should trigger PIN challenge
    await toggleBtn.click()

    // Verify PIN dialog appears
    const pinDialog = adminPage.getByTestId('pin-challenge-dialog')
    await expect(pinDialog).toBeVisible({ timeout: 5000 })

    // Enter correct PIN
    await enterPin(adminPage, TEST_PIN)

    // Dialog should close
    await expect(pinDialog).not.toBeVisible({ timeout: 5000 })

    // Phone should now be visible (unmasked — full E.164 format with +)
    const phoneText = adminPage.locator('p.font-mono').first()
    await expect(phoneText).toContainText('+')
  })

  test('wrong PIN shows error, 3 failures wipes key', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/users')

    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()

    const toggleBtn = adminPage.getByTestId('toggle-phone-visibility').first()
    await expect(toggleBtn).toBeVisible({ timeout: 30000 })

    // Click to unmask phone
    await toggleBtn.click()

    const pinDialog = adminPage.getByTestId('pin-challenge-dialog')
    await expect(pinDialog).toBeVisible({ timeout: 5000 })

    // Enter wrong PIN — PBKDF2 runs during verification (slow under CI parallel load)
    await enterPin(adminPage, '999999')

    // Should show error — wait for PBKDF2 to complete + error render
    const errorMsg = adminPage.getByTestId('pin-challenge-error')
    await expect(errorMsg).toBeVisible({ timeout: 15000 })

    // Wait for PIN input to be ready again (PBKDF2 disables inputs during verification)
    await adminPage
      .locator('input[aria-label="PIN digit 1"]')
      .waitFor({ state: 'visible', timeout: 10000 })

    // Enter wrong PIN again
    await enterPin(adminPage, '888888')
    await expect(errorMsg).toBeVisible({ timeout: 15000 })

    // Wait for PIN input to be ready again
    await adminPage
      .locator('input[aria-label="PIN digit 1"]')
      .waitFor({ state: 'visible', timeout: 10000 })

    // Third wrong PIN — should trigger wipe and close dialog
    await enterPin(adminPage, '777777')

    // Dialog should close after max attempts (CI Chromium needs extra time for wipe + redirect)
    await expect(pinDialog).not.toBeVisible({ timeout: 15000 })

    // Key should be wiped — redirected to login
    await adminPage.waitForURL('**/login', { timeout: 15000 })
  })

  test('cancel PIN challenge closes dialog without action', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/users')

    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()

    const toggleBtn = adminPage.getByTestId('toggle-phone-visibility').first()
    await expect(toggleBtn).toBeVisible({ timeout: 30000 })

    // Click to unmask phone
    await toggleBtn.click()

    const pinDialog = adminPage.getByTestId('pin-challenge-dialog')
    await expect(pinDialog).toBeVisible({ timeout: 5000 })

    // Click cancel
    await adminPage.getByRole('button', { name: /cancel/i }).click()

    // Dialog should close
    await expect(pinDialog).not.toBeVisible({ timeout: 5000 })

    // Should still be on users page
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()
  })
})
