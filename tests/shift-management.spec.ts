import { test, expect } from '@playwright/test'
import { loginAsAdmin, createVolunteerAndGetNsec, uniquePhone, resetTestState } from './helpers'

test.describe('Shift management', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Shifts' }).click()
    await expect(page.getByRole('heading', { name: /shift schedule/i })).toBeVisible()
  })

  test('page loads with heading and create button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create shift/i })).toBeVisible()
    // Fallback group section should be visible
    await expect(page.getByText(/fallback group/i)).toBeVisible()
  })

  test('empty state shows no shifts message', async ({ page }) => {
    // After reset, no shifts should exist — wait for loading to finish
    await expect(page.getByText(/no shifts scheduled/i)).toBeVisible({ timeout: 10000 })
  })

  test('create shift with name and times', async ({ page }) => {
    const shiftName = `Morning ${Date.now()}`
    await page.getByRole('button', { name: /create shift/i }).click()

    // Fill in shift form
    await page.getByLabel(/shift name/i).fill(shiftName)
    await page.getByLabel(/start time/i).fill('08:00')
    await page.getByLabel(/end time/i).fill('16:00')

    await page.getByRole('button', { name: /save/i }).click()

    // Shift should appear in the list
    await expect(page.getByText(shiftName)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('08:00 - 16:00')).toBeVisible()
  })

  test('edit shift name and time', async ({ page }) => {
    const shiftName = `EditMe ${Date.now()}`
    const updatedName = `Edited ${Date.now()}`

    // Create a shift first
    await page.getByRole('button', { name: /create shift/i }).click()
    await page.getByLabel(/shift name/i).fill(shiftName)
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Edit it
    const shiftRow = page.locator('h3').filter({ hasText: shiftName }).locator('..').locator('..')
    await shiftRow.getByRole('button', { name: 'Edit' }).click()

    const editForm = page.locator('form')
    await editForm.getByLabel(/shift name/i).fill(updatedName)
    await editForm.getByLabel(/start time/i).fill('10:00')
    await editForm.getByLabel(/end time/i).fill('18:00')
    await page.getByRole('button', { name: /save/i }).click()

    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('10:00 - 18:00')).toBeVisible()
    await expect(page.getByText(shiftName)).not.toBeVisible()
  })

  test('delete shift', async ({ page }) => {
    const shiftName = `DeleteMe ${Date.now()}`

    // Create a shift
    await page.getByRole('button', { name: /create shift/i }).click()
    await page.getByLabel(/shift name/i).fill(shiftName)
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Delete it
    const shiftRow = page.locator('h3').filter({ hasText: shiftName }).locator('..').locator('..')
    await shiftRow.getByRole('button', { name: 'Delete' }).click()

    // Shift should disappear
    await expect(page.getByText(shiftName)).not.toBeVisible()
  })

  test('cancel shift creation', async ({ page }) => {
    await page.getByRole('button', { name: /create shift/i }).click()
    await expect(page.getByLabel(/shift name/i)).toBeVisible()

    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByLabel(/shift name/i)).not.toBeVisible()
  })

  test('cancel shift edit', async ({ page }) => {
    const shiftName = `CancelEdit ${Date.now()}`

    // Create a shift
    await page.getByRole('button', { name: /create shift/i }).click()
    await page.getByLabel(/shift name/i).fill(shiftName)
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Start editing
    const shiftRow = page.locator('h3').filter({ hasText: shiftName }).locator('..').locator('..')
    await shiftRow.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('form').getByLabel(/shift name/i)).toBeVisible()

    // Cancel
    await page.getByRole('button', { name: /cancel/i }).click()
    // Original name still visible
    await expect(page.getByText(shiftName)).toBeVisible()
  })

  test('assign volunteers to shift', async ({ page }) => {
    // Create a volunteer first
    const phone = uniquePhone()
    const volName = `ShiftVol ${Date.now()}`
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await createVolunteerAndGetNsec(page, volName, phone)
    await page.getByRole('button', { name: /close/i }).click()

    // Go to shifts
    await page.getByRole('link', { name: 'Shifts' }).click()
    await expect(page.getByRole('heading', { name: /shift schedule/i })).toBeVisible()

    const shiftName = `WithVol ${Date.now()}`
    await page.getByRole('button', { name: /create shift/i }).click()
    await page.getByLabel(/shift name/i).fill(shiftName)

    // Open volunteer multi-select — scope to the form
    const volSelect = page.locator('form').getByRole('combobox')
    await volSelect.click()
    // Select the volunteer from the dropdown
    await page.getByRole('option', { name: new RegExp(volName) }).click()
    // Close the popover by pressing Escape
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Should show 1 volunteer count
    await expect(page.getByText(/1 volunteer/i)).toBeVisible()
  })

  test('fallback group selection', async ({ page }) => {
    // Create a volunteer first
    const phone = uniquePhone()
    const volName = `FallbackVol ${Date.now()}`
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await createVolunteerAndGetNsec(page, volName, phone)
    await page.getByRole('button', { name: /close/i }).click()

    // Go to shifts
    await page.getByRole('link', { name: 'Shifts' }).click()
    await expect(page.getByText(/fallback group/i)).toBeVisible()

    // Open the fallback volunteer multi-select (in the Fallback Group card)
    const fallbackCard = page.locator('main').filter({ hasText: /fallback group/i }).last()
    const fallbackSelect = fallbackCard.getByRole('combobox')
    await fallbackSelect.click()

    // Select the volunteer
    await page.getByRole('option', { name: new RegExp(volName) }).click()
    await page.keyboard.press('Escape')

    // Volunteer badge should appear
    await expect(fallbackCard.getByText(volName)).toBeVisible({ timeout: 5000 })
  })

  test('shift shows volunteer count', async ({ page }) => {
    const shiftName = `CountShift ${Date.now()}`
    await page.getByRole('button', { name: /create shift/i }).click()
    await page.getByLabel(/shift name/i).fill(shiftName)
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Should show 0 volunteers
    const shiftCard = page.locator('h3').filter({ hasText: shiftName }).locator('..').locator('..')
    await expect(shiftCard.getByText(/0 volunteer/i)).toBeVisible()
  })
})
