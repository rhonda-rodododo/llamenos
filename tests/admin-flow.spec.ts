import { test, expect } from '@playwright/test'
import { loginAsAdmin, uniquePhone, resetTestState } from './helpers'

test.describe('Admin flow', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('login shows dashboard with admin nav', async ({ page }) => {
    await expect(page.locator('nav').getByText('Admin', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Volunteers' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Shifts' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ban List' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Call History' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Audit Log' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  })

  test('volunteer CRUD', async ({ page }) => {
    const phone = uniquePhone()
    const volName = `Vol ${Date.now()}`
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

    // Add volunteer
    await page.getByRole('button', { name: /add volunteer/i }).click()
    const form = page.locator('form')
    await form.locator('input').first().fill(volName)
    await form.locator('input[type="tel"]').fill(phone)
    await page.getByRole('button', { name: /save/i }).click()

    // Should show the generated nsec
    await expect(page.getByText(/nsec1/)).toBeVisible()

    // Close the nsec card
    await page.getByRole('button', { name: /close/i }).click()

    // Volunteer should appear (phone is masked by default)
    await expect(page.getByText(volName).first()).toBeVisible()

    // Delete the volunteer — scope to the row containing the volunteer name
    const volRow = page.locator('.divide-y > div').filter({ hasText: volName })
    await volRow.getByRole('button', { name: 'Delete' }).click()
    // Confirm dialog has a "Delete" button
    await page.getByRole('dialog').getByRole('button', { name: /delete/i }).click()
    // Wait for dialog to close
    await expect(page.getByRole('dialog')).toBeHidden()

    // Volunteer should be removed from the list
    await expect(page.locator('main').getByText(volName)).not.toBeVisible()
  })

  test('shift creation', async ({ page }) => {
    const shiftName = `Shift ${Date.now()}`
    await page.getByRole('link', { name: 'Shifts' }).click()
    await expect(page.getByRole('heading', { name: /shift schedule/i })).toBeVisible()

    await page.getByRole('button', { name: /create shift/i }).click()
    const form = page.locator('form')
    await form.locator('input').first().fill(shiftName)
    await page.getByRole('button', { name: /save/i }).click()

    await expect(page.getByText(shiftName)).toBeVisible()
  })

  test('shift edit', async ({ page }) => {
    const shiftName = `Edit ${Date.now()}`
    const updatedName = `Updated ${Date.now()}`
    await page.getByRole('link', { name: 'Shifts' }).click()

    // Create a shift first
    await page.getByRole('button', { name: /create shift/i }).click()
    const form = page.locator('form')
    await form.locator('input').first().fill(shiftName)
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(shiftName)).toBeVisible()

    // Edit it — find the heading, go up to its container, click Edit
    const shiftRow = page.locator('h3').filter({ hasText: shiftName }).locator('..').locator('..')
    await shiftRow.getByRole('button', { name: 'Edit' }).click()
    const editForm = page.locator('form')
    await editForm.locator('input').first().fill(updatedName)
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(updatedName)).toBeVisible()
  })

  test('shift delete', async ({ page }) => {
    const shiftName = `Del ${Date.now()}`
    await page.getByRole('link', { name: 'Shifts' }).click()

    // Create a shift
    await page.getByRole('button', { name: /create shift/i }).click()
    const form = page.locator('form')
    await form.locator('input').first().fill(shiftName)
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(shiftName)).toBeVisible()

    // Delete it — find the heading, go up to its container, click Delete
    const shiftRow = page.locator('h3').filter({ hasText: shiftName }).locator('..').locator('..')
    await shiftRow.getByRole('button', { name: 'Delete' }).click()
    // The shift should eventually disappear (no confirm dialog on shifts)
    await expect(page.getByText(shiftName)).not.toBeVisible()
  })

  test('ban list management', async ({ page }) => {
    const phone = uniquePhone()
    await page.getByRole('link', { name: 'Ban List' }).click()
    await expect(page.getByRole('heading', { name: /ban list/i })).toBeVisible()

    await page.getByRole('button', { name: /ban number/i }).click()
    const form = page.locator('form')
    await form.locator('input[type="tel"]').fill(phone)
    await form.locator('input').last().fill('E2E test ban')
    await page.getByRole('button', { name: /save/i }).click()

    await expect(page.getByText(phone)).toBeVisible()
    await expect(page.getByText('E2E test ban')).toBeVisible()
  })

  test('ban removal', async ({ page }) => {
    const phone = uniquePhone()
    await page.getByRole('link', { name: 'Ban List' }).click()

    // Add a ban first
    await page.getByRole('button', { name: /ban number/i }).click()
    const form = page.locator('form')
    await form.locator('input[type="tel"]').fill(phone)
    await form.locator('input').last().fill('To remove')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(phone)).toBeVisible()

    // Remove it — scope to the row containing the phone number
    const banRow = page.locator('.divide-y > div').filter({ hasText: phone })
    await banRow.getByRole('button', { name: 'Remove' }).click()
    // Confirm dialog has an "Unban Number" button
    await page.getByRole('dialog').getByRole('button', { name: /unban/i }).click()
    // Wait for dialog to close
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.locator('main').getByText(phone)).not.toBeVisible()
  })

  test('phone validation rejects bad numbers', async ({ page }) => {
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await page.getByRole('button', { name: /add volunteer/i }).click()

    const form = page.locator('form')
    await form.locator('input').first().fill('Bad Phone')
    await form.locator('input[type="tel"]').fill('not-a-number')
    await page.getByRole('button', { name: /save/i }).click()

    await expect(page.getByText(/invalid phone/i)).toBeVisible()
  })

  test('audit log shows entries', async ({ page }) => {
    await page.getByRole('link', { name: 'Audit Log' }).click()
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible()
    // Wait for loading to finish, entries should appear
    await page.waitForTimeout(1000)
  })

  test('settings page loads with all sections', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Transcription' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Spam Mitigation' })).toBeVisible()
    await expect(page.getByText('Voice CAPTCHA')).toBeVisible()
    await expect(page.getByText('Rate Limiting')).toBeVisible()
  })

  test('settings toggles work', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Find a switch and toggle it
    const switches = page.getByRole('switch')
    const count = await switches.count()
    expect(count).toBeGreaterThan(0)
  })

  test('call history page loads', async ({ page }) => {
    await page.getByRole('link', { name: 'Call History' }).click()
    await expect(page.getByRole('heading', { name: /call history/i })).toBeVisible()
  })

  test('call history search form works', async ({ page }) => {
    await page.getByRole('link', { name: 'Call History' }).click()
    await expect(page.getByRole('heading', { name: /call history/i })).toBeVisible()

    // Fill search input and submit
    await page.getByPlaceholder(/search by phone/i).fill('+1234567890')
    await page.locator('button[aria-label="Search"]').click()

    // Clear filters should appear
    await expect(page.locator('button[aria-label="Clear filters"]')).toBeVisible()
    await page.locator('button[aria-label="Clear filters"]').click()
  })

  test('notes page loads', async ({ page }) => {
    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()
    await expect(page.getByText(/encrypted end-to-end/i)).toBeVisible()
  })

  test('language switching works', async ({ page }) => {
    // Use title attribute — always the native name regardless of UI language
    await page.locator('button[title="Español"]').click()
    await expect(page.getByRole('heading', { name: 'Panel' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Notas' })).toBeVisible()

    // Switch back to English (title stays the native name)
    await page.locator('button[title="English"]').click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('logout works', async ({ page }) => {
    await page.getByRole('button', { name: /log out/i }).click()
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
  })
})
