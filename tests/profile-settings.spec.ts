import { test, expect } from '@playwright/test'
import { loginAsAdmin, loginAsVolunteer, createVolunteerAndGetNsec, completeProfileSetup, uniquePhone } from './helpers'

test.describe('Profile self-service', () => {
  let volunteerNsec: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await loginAsAdmin(page)
    volunteerNsec = await createVolunteerAndGetNsec(page, 'Profile Vol', uniquePhone())
    await page.close()
  })

  test('admin can edit profile name and it persists', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // Profile card should be visible
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()

    // Change display name
    const nameInput = page.locator('#profile-name')
    const oldName = await nameInput.inputValue()
    const newName = `Admin ${Date.now()}`
    await nameInput.fill(newName)

    // Save — name is sent to API
    await page.getByRole('button', { name: /update profile/i }).click()
    await expect(page.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })

    // Reload and verify name persisted via /auth/me
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.locator('#profile-name')).toHaveValue(newName)

    // Restore original name
    await page.locator('#profile-name').fill(oldName || 'Admin')
    await page.getByRole('button', { name: /update profile/i }).click()
    await expect(page.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })
  })

  test('admin can save a valid phone number', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // Enter a valid E.164 phone number
    const phoneInput = page.locator('#profile-phone')
    await phoneInput.fill('+12125559999')
    await phoneInput.blur()
    await page.getByRole('button', { name: /update profile/i }).click()

    // Should succeed
    await expect(page.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })
  })

  test('profile rejects invalid phone', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // Enter a too-short phone (PhoneInput strips non-digits)
    const phoneInput = page.locator('#profile-phone')
    await phoneInput.fill('+123')
    await phoneInput.blur()
    await page.getByRole('button', { name: /update profile/i }).click()

    // Should show error
    await expect(page.getByText(/invalid phone/i)).toBeVisible({ timeout: 5000 })
  })

  test('volunteer sees profile card in settings', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // Profile card should be visible for all users
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.locator('#profile-name')).toBeVisible()
    await expect(page.locator('#profile-phone')).toBeVisible()

    // Public key should be shown
    await expect(page.getByText(/npub1/)).toBeVisible()
  })

  test('admin sees backup and security cards', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // Key Backup card
    await expect(page.getByRole('heading', { name: /key backup/i })).toBeVisible()

    // Passkeys (WebAuthn) card
    await expect(page.getByRole('heading', { name: /passkeys/i })).toBeVisible()

    // Spam Mitigation card — admin only
    await expect(page.getByRole('heading', { name: /spam mitigation/i })).toBeVisible()
  })

  test('volunteer does not see admin-only settings', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // Should NOT see Passkey Policy or Spam Mitigation (Passkeys card is visible for all users)
    await expect(page.getByRole('heading', { name: /passkey policy/i })).not.toBeVisible()
    await expect(page.getByRole('heading', { name: /spam mitigation/i })).not.toBeVisible()
  })

  test('volunteer can update name and phone', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // Update name
    const newName = `Vol ${Date.now()}`
    await page.locator('#profile-name').fill(newName)

    // Update phone
    await page.locator('#profile-phone').fill('+15551234567')
    await page.locator('#profile-phone').blur()

    await page.getByRole('button', { name: /update profile/i }).click()
    await expect(page.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })

    // Verify name persists after reload
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.locator('#profile-name')).toHaveValue(newName)
  })

  test('spoken language selection works', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()

    // Find the spoken languages section
    await expect(page.getByText(/languages you can take calls in/i)).toBeVisible()

    // Click a language to toggle it (e.g., Español)
    const esButton = page.locator('button').filter({ hasText: 'Español' }).last()
    await esButton.click()

    // Save button should appear
    const saveBtn = page.getByRole('button', { name: /update profile/i })
    if (await saveBtn.isVisible()) {
      await saveBtn.click()
      await expect(page.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })
    }
  })
})
