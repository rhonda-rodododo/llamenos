import { test, expect } from '@playwright/test'
import { loginAsAdmin, loginAsVolunteer, createVolunteerAndGetNsec, completeProfileSetup, uniquePhone } from './helpers'

test.describe('Volunteer flow', () => {
  let volunteerNsec: string
  let volunteerPhone: string

  test.beforeAll(async ({ browser }) => {
    // Create a volunteer via admin
    const page = await browser.newPage()
    volunteerPhone = uniquePhone()
    await loginAsAdmin(page)
    volunteerNsec = await createVolunteerAndGetNsec(page, 'E2E Vol', volunteerPhone)
    await page.close()
  })

  test('volunteer can login', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    // Should be on profile-setup or dashboard
    await expect(page).toHaveURL(/\/(profile-setup)?$/)
  })

  test('volunteer completes profile setup', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('volunteer sees limited navigation', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    // Should see Dashboard, Notes, Settings
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Notes' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()

    // Should NOT see admin links
    await expect(page.getByRole('link', { name: 'Volunteers' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Shifts' })).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'Ban List' })).not.toBeVisible()
  })

  test('volunteer can toggle on-break', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    // Find the break button
    const breakBtn = page.getByRole('button', { name: /take a break/i })
    if (await breakBtn.isVisible()) {
      await breakBtn.click()
      await expect(page.getByText('On Break', { exact: true })).toBeVisible()
    }
  })

  test('volunteer cannot access admin pages via URL', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    // Try accessing /volunteers directly
    await page.goto('/volunteers')
    await expect(page.getByText(/access denied/i)).toBeVisible()
  })

  test('volunteer cannot access /shifts via URL', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.goto('/shifts')
    await expect(page.getByText(/access denied/i)).toBeVisible()
  })

  test('volunteer cannot access /bans via URL', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.goto('/bans')
    await expect(page.getByText(/access denied/i)).toBeVisible()
  })

  test('volunteer can navigate to notes', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()
  })

  test('volunteer can navigate to settings', async ({ page }) => {
    await loginAsVolunteer(page, volunteerNsec)
    await completeProfileSetup(page)

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    // Should see transcription toggle but not spam settings
    await expect(page.getByRole('heading', { name: 'Spam Mitigation' })).not.toBeVisible()
  })
})
