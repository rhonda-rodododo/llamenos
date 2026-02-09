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

  test('admin can edit profile name', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Profile card should be visible
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()

    // Change display name
    const nameInput = page.locator('#profile-name')
    const oldName = await nameInput.inputValue()
    const newName = `Admin ${Date.now()}`
    await nameInput.fill(newName)

    // Save button should appear (dirty state)
    await page.getByRole('button', { name: /update profile/i }).click()

    // Toast should confirm
    await expect(page.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })

    // Restore original name
    await nameInput.fill(oldName || 'Admin')
    await page.getByRole('button', { name: /update profile/i }).click()
    await expect(page.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })
  })

  test('profile rejects invalid phone', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Enter invalid phone
    const phoneInput = page.locator('#profile-phone')
    await phoneInput.fill('not-a-number')
    await page.getByRole('button', { name: /update profile/i }).click()

    // Should show error
    await expect(page.getByText(/invalid phone/i)).toBeVisible({ timeout: 5000 })
  })

  test('volunteer sees profile card in settings', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Key Backup card
    await expect(page.getByRole('heading', { name: /key backup/i })).toBeVisible()

    // Security Keys (WebAuthn) card — admin only
    await expect(page.getByRole('heading', { name: /security keys/i })).toBeVisible()

    // Spam Mitigation card — admin only
    await expect(page.getByRole('heading', { name: /spam mitigation/i })).toBeVisible()
  })

  test('volunteer does not see admin-only settings', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Should NOT see WebAuthn or Spam Mitigation
    await expect(page.getByRole('heading', { name: /security keys/i })).not.toBeVisible()
    await expect(page.getByRole('heading', { name: /spam mitigation/i })).not.toBeVisible()
  })

  test('spoken language selection works', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

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
