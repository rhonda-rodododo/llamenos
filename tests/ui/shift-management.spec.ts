import { expect, test } from '../fixtures/auth'
import { createUserAndGetNsec, dismissNsecCard, uniquePhone } from '../helpers'

test.describe('Shift management', () => {
  test.beforeEach(async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Shifts' }).click()
    await expect(adminPage.getByRole('heading', { name: /shift schedule/i })).toBeVisible()
  })

  test('page loads with heading and create button', async ({ adminPage }) => {
    await expect(adminPage.getByRole('button', { name: /create shift/i })).toBeVisible()
    // Fallback group section should be visible
    await expect(adminPage.getByText(/fallback group/i)).toBeVisible()
  })

  test('page renders shift schedule content', async ({ adminPage }) => {
    // Verify the schedule page renders with either shifts or the empty state
    const hasShifts = await adminPage
      .locator('h3')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)
    const hasEmptyState = await adminPage
      .getByText(/no shifts scheduled/i)
      .isVisible()
      .catch(() => false)
    expect(hasShifts || hasEmptyState).toBeTruthy()
  })

  test('create shift with name and times', async ({ adminPage }) => {
    const shiftName = `Morning ${Date.now()}`
    await adminPage.getByRole('button', { name: /create shift/i }).click()

    // Fill in shift form
    await adminPage.getByLabel(/shift name/i).fill(shiftName)
    await adminPage.getByLabel(/start time/i).fill('08:00')
    await adminPage.getByLabel(/end time/i).fill('16:00')

    await adminPage.getByRole('button', { name: /save/i }).click()

    // Shift should appear in the list
    await expect(adminPage.getByText(shiftName)).toBeVisible({ timeout: 10000 })
    const shiftCard = adminPage
      .locator('h3')
      .filter({ hasText: shiftName })
      .locator('..')
      .locator('..')
    await expect(shiftCard.getByText('08:00 - 16:00')).toBeVisible()
  })

  test('edit shift name and time', async ({ adminPage }) => {
    const shiftName = `EditMe ${Date.now()}`
    const updatedName = `Edited ${Date.now()}`

    // Create a shift first
    await adminPage.getByRole('button', { name: /create shift/i }).click()
    await adminPage.getByLabel(/shift name/i).fill(shiftName)
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Edit it
    const shiftRow = adminPage
      .locator('h3')
      .filter({ hasText: shiftName })
      .locator('..')
      .locator('..')
    await shiftRow.getByRole('button', { name: 'Edit' }).click()

    const editForm = adminPage.locator('form')
    await editForm.getByLabel(/shift name/i).fill(updatedName)
    await editForm.getByLabel(/start time/i).fill('10:00')
    await editForm.getByLabel(/end time/i).fill('18:00')
    await adminPage.getByRole('button', { name: /save/i }).click()

    // After save, the shift list refetches. Name is hub-encrypted, needs decryption time.
    await expect(adminPage.getByText(updatedName)).toBeVisible({ timeout: 30000 })
    const updatedCard = adminPage
      .locator('h3')
      .filter({ hasText: updatedName })
      .locator('..')
      .locator('..')
    await expect(updatedCard.getByText('10:00 - 18:00')).toBeVisible()
    await expect(adminPage.getByText(shiftName)).not.toBeVisible()
  })

  test('delete shift', async ({ adminPage }) => {
    const shiftName = `DeleteMe ${Date.now()}`

    // Create a shift
    await adminPage.getByRole('button', { name: /create shift/i }).click()
    await adminPage.getByLabel(/shift name/i).fill(shiftName)
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Delete it
    const shiftRow = adminPage
      .locator('h3')
      .filter({ hasText: shiftName })
      .locator('..')
      .locator('..')
    await shiftRow.getByRole('button', { name: 'Delete' }).click()

    // Shift should disappear
    await expect(adminPage.getByText(shiftName)).not.toBeVisible()
  })

  test('cancel shift creation', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /create shift/i }).click()
    await expect(adminPage.getByLabel(/shift name/i)).toBeVisible()

    await adminPage.getByRole('button', { name: /cancel/i }).click()
    await expect(adminPage.getByLabel(/shift name/i)).not.toBeVisible()
  })

  test('cancel shift edit', async ({ adminPage }) => {
    const shiftName = `CancelEdit ${Date.now()}`

    // Create a shift
    await adminPage.getByRole('button', { name: /create shift/i }).click()
    await adminPage.getByLabel(/shift name/i).fill(shiftName)
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Start editing
    const shiftRow = adminPage
      .locator('h3')
      .filter({ hasText: shiftName })
      .locator('..')
      .locator('..')
    await shiftRow.getByRole('button', { name: 'Edit' }).click()
    await expect(adminPage.locator('form').getByLabel(/shift name/i)).toBeVisible()

    // Cancel
    await adminPage.getByRole('button', { name: /cancel/i }).click()
    // Original name still visible
    await expect(adminPage.getByText(shiftName)).toBeVisible()
  })

  test('assign users to shift', async ({ adminPage }) => {
    // Create a user first
    const phone = uniquePhone()
    const userName = `ShiftVol ${Date.now()}`
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await createUserAndGetNsec(adminPage, userName, phone)
    await dismissNsecCard(adminPage)

    // Go to shifts
    await adminPage.getByRole('link', { name: 'Shifts' }).click()
    await expect(adminPage.getByRole('heading', { name: /shift schedule/i })).toBeVisible()

    const shiftName = `WithVol ${Date.now()}`
    await adminPage.getByRole('button', { name: /create shift/i }).click()
    await adminPage.getByLabel(/shift name/i).fill(shiftName)

    // Open user multi-select — scope to the form.
    // User names in the dropdown are decrypted; wait for decryption under load.
    const volSelect = adminPage.locator('form').getByRole('combobox')
    await volSelect.waitFor({ state: 'visible', timeout: 15000 })
    await volSelect.click({ timeout: 15000 })
    // Wait for options to be populated (user names need hub key decryption)
    await expect(adminPage.getByRole('option', { name: new RegExp(userName) })).toBeVisible({
      timeout: 30000,
    })
    await adminPage.getByRole('option', { name: new RegExp(userName) }).click()
    // Close the popover by pressing Escape
    await adminPage.keyboard.press('Escape')

    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Should show 1 user count (scoped to this shift's card)
    const shiftCard = adminPage
      .locator('h3')
      .filter({ hasText: shiftName })
      .locator('..')
      .locator('..')
    await expect(shiftCard.getByText(/1 user/i)).toBeVisible({ timeout: 15000 })
  })

  test('fallback group selection', async ({ adminPage }) => {
    // Create a user first
    const phone = uniquePhone()
    const userName = `FallbackVol ${Date.now()}`
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await createUserAndGetNsec(adminPage, userName, phone)
    await dismissNsecCard(adminPage)

    // Go to shifts
    await adminPage.getByRole('link', { name: 'Shifts' }).click()
    await expect(adminPage.getByText(/fallback group/i)).toBeVisible()

    // Open the fallback user multi-select (in the Fallback Group card)
    const fallbackCard = adminPage
      .locator('main')
      .filter({ hasText: /fallback group/i })
      .last()
    const fallbackSelect = fallbackCard.getByRole('combobox')
    await fallbackSelect.waitFor({ state: 'visible', timeout: 15000 })
    await fallbackSelect.click({ timeout: 15000 })

    // Select the user — names need decryption, wait for option to appear
    await expect(adminPage.getByRole('option', { name: new RegExp(userName) })).toBeVisible({
      timeout: 30000,
    })
    await adminPage.getByRole('option', { name: new RegExp(userName) }).click()
    await adminPage.keyboard.press('Escape')

    // User badge should appear
    await expect(fallbackCard.getByText(userName)).toBeVisible({ timeout: 15000 })
  })

  test('shift shows user count', async ({ adminPage }) => {
    const shiftName = `CountShift ${Date.now()}`
    await adminPage.getByRole('button', { name: /create shift/i }).click()
    await adminPage.getByLabel(/shift name/i).fill(shiftName)
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(shiftName)).toBeVisible({ timeout: 10000 })

    // Should show 0 users
    const shiftCard = adminPage
      .locator('h3')
      .filter({ hasText: shiftName })
      .locator('..')
      .locator('..')
    await expect(shiftCard.getByText(/0 user/i)).toBeVisible({ timeout: 15000 })
  })
})
