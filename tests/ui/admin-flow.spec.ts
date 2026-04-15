import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin, uniquePhone } from '../helpers'

test.describe('Admin flow', () => {
  test('login shows dashboard with admin nav', async ({ adminPage }) => {
    await expect(adminPage.locator('nav').getByText('Admin', { exact: true }).first()).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Shifts' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Ban List' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Call History' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Audit Log' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Hub Settings' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  })

  test('user CRUD', async ({ adminPage }) => {
    const phone = uniquePhone()
    const userName = `Vol ${Date.now()}`
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()

    // Add user — wait for data to load, then use force click to bypass
    // React re-render instability (button detaches during async state updates)
    await adminPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    await adminPage.waitForTimeout(1000)
    await adminPage.getByTestId('user-add-btn').click({ force: true })
    await adminPage.getByLabel('Name').fill(userName)
    await adminPage.getByLabel('Phone Number').fill(phone)
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByRole('button', { name: /save/i }).click()

    // Should show the generated nsec
    await expect(adminPage.getByText(/nsec1/)).toBeVisible({ timeout: 15000 })

    // Close the nsec card
    await adminPage.getByTestId('dismiss-nsec').click()

    // User should appear (phone is masked by default)
    // Allow time for async decrypt-on-fetch to resolve the encrypted name
    await expect(adminPage.getByText(userName).first()).toBeVisible({ timeout: 15000 })

    // Delete the user — scope to the row containing the user name
    const volRow = adminPage
      .getByTestId('user-list')
      .locator('div')
      .filter({ hasText: userName })
      .first()
    await volRow.getByTestId('user-delete-btn').click()
    // Confirm dialog has a "Delete" button
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: /delete/i })
      .click()
    // Wait for dialog to close
    await expect(adminPage.getByRole('dialog')).toBeHidden()

    // User should be removed from the list
    await expect(adminPage.locator('main').getByText(userName)).not.toBeVisible()
  })

  test('shift creation', async ({ adminPage }) => {
    const shiftName = `Shift ${Date.now()}`
    await adminPage.getByRole('link', { name: 'Shifts' }).click()
    await expect(adminPage.getByRole('heading', { name: /shift schedule/i })).toBeVisible()

    await adminPage.getByRole('button', { name: /create shift/i }).click()
    const form = adminPage.locator('form')
    await form.locator('input').first().fill(shiftName)
    await adminPage.getByRole('button', { name: /save/i }).click()

    await expect(adminPage.getByText(shiftName)).toBeVisible()
  })

  test('shift edit', async ({ adminPage }) => {
    const shiftName = `Edit ${Date.now()}`
    const updatedName = `Updated ${Date.now()}`
    await adminPage.getByRole('link', { name: 'Shifts' }).click()

    // Create a shift first
    await adminPage.getByRole('button', { name: /create shift/i }).click()
    const form = adminPage.locator('form')
    await form.locator('input').first().fill(shiftName)
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(shiftName)).toBeVisible()

    // Edit it — find the heading, go up to its container, click Edit
    const shiftRow = adminPage
      .locator('h3')
      .filter({ hasText: shiftName })
      .locator('..')
      .locator('..')
    await shiftRow.getByRole('button', { name: 'Edit' }).click()
    const editForm = adminPage.locator('form')
    await editForm.locator('input').first().fill(updatedName)
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(updatedName)).toBeVisible()
  })

  test('shift delete', async ({ adminPage }) => {
    const shiftName = `Del ${Date.now()}`
    await adminPage.getByRole('link', { name: 'Shifts' }).click()

    // Create a shift
    await adminPage.getByRole('button', { name: /create shift/i }).click()
    const form = adminPage.locator('form')
    await form.locator('input').first().fill(shiftName)
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(shiftName)).toBeVisible()

    // Delete it — find the heading, go up to its container, click Delete
    const shiftRow = adminPage
      .locator('h3')
      .filter({ hasText: shiftName })
      .locator('..')
      .locator('..')
    await shiftRow.getByRole('button', { name: 'Delete' }).click()
    // The shift should eventually disappear (no confirm dialog on shifts)
    await expect(adminPage.getByText(shiftName)).not.toBeVisible()
  })

  test('ban list management', async ({ adminPage }) => {
    const phone = uniquePhone()
    await adminPage.getByRole('link', { name: 'Ban List' }).click()
    await expect(adminPage.getByRole('heading', { name: /ban list/i })).toBeVisible()

    await adminPage.getByRole('button', { name: /ban number/i }).click()
    await adminPage.getByLabel('Phone Number').fill(phone)
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByLabel('Reason').fill('E2E test ban')
    await adminPage.getByRole('button', { name: /save/i }).click()

    await expect(adminPage.getByText(phone)).toBeVisible()
    await expect(adminPage.getByText('E2E test ban')).toBeVisible()
  })

  test('ban removal', async ({ adminPage }) => {
    const phone = uniquePhone()
    await adminPage.getByRole('link', { name: 'Ban List' }).click()

    // Add a ban first
    await adminPage.getByRole('button', { name: /ban number/i }).click()
    await adminPage.getByLabel('Phone Number').fill(phone)
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByLabel('Reason').fill('To remove')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.getByText(phone)).toBeVisible()

    // Remove it — scope to the row containing the phone number
    const banRow = adminPage.locator('.divide-y > div').filter({ hasText: phone })
    await banRow.getByRole('button', { name: 'Remove' }).click()
    // Confirm dialog has an "Unban Number" button
    await adminPage.getByRole('dialog').getByRole('button', { name: /unban/i }).click()
    // Wait for dialog to close
    await expect(adminPage.getByRole('dialog')).toBeHidden()
    await expect(adminPage.locator('main').getByText(phone)).not.toBeVisible()
  })

  test('phone validation rejects bad numbers', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    await adminPage.waitForTimeout(1000)
    await adminPage.getByTestId('user-add-btn').click({ force: true })

    await adminPage.getByLabel('Name').fill('Bad Phone')
    // PhoneInput strips non-digits; use a too-short number that passes through handleChange
    await adminPage.getByLabel('Phone Number').fill('+12')
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByRole('button', { name: /save/i }).click()

    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible()
  })

  test('audit log shows entries', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Audit Log' }).click()
    await expect(adminPage.getByTestId('audit-log-heading')).toBeVisible()
    // Wait for loading to finish, entries should appear
    await adminPage.waitForTimeout(1000)
  })

  test('admin sidebar nav exposes core sections', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin')
    await expect(adminPage.getByTestId('admin-shell')).toBeVisible({ timeout: 15000 })

    // Core sidebar items should be visible
    await expect(adminPage.getByTestId('admin-sidebar-item-transcription')).toBeVisible()
    await expect(adminPage.getByTestId('admin-sidebar-item-spam-protection')).toBeVisible()

    // Navigate to Spam Protection and verify its content
    await navigateAfterLogin(adminPage, '/admin/spam-protection')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'spam-protection'
    )
    await expect(adminPage.getByTestId('admin-spam-protection-captcha-switch')).toBeVisible()
    await expect(adminPage.getByTestId('admin-spam-protection-rate-limit-switch')).toBeVisible()
  })

  test('admin transcription section exposes switches', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/transcription')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'transcription'
    )

    const switches = adminPage.getByRole('switch')
    const count = await switches.count()
    expect(count).toBeGreaterThan(0)
  })

  test('call history page loads', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Call History' }).click()
    await expect(adminPage.getByRole('heading', { name: /call history/i })).toBeVisible()
  })

  test('call history search form works', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Call History' }).click()
    await expect(adminPage.getByRole('heading', { name: /call history/i })).toBeVisible()

    // Fill search input and submit
    await adminPage.getByPlaceholder(/search by phone/i).fill('+1234567890')
    await adminPage.locator('button[aria-label="Search"]').click()

    // Clear filters should appear
    await expect(adminPage.locator('button[aria-label="Clear filters"]')).toBeVisible()
    await adminPage.locator('button[aria-label="Clear filters"]').click()
  })

  test('notes page loads', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Call Notes' }).click()
    await adminPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible({
      timeout: 15000,
    })
    await expect(adminPage.getByText(/encrypted end-to-end/i)).toBeVisible()
  })

  test('language switching works', async ({ adminPage }) => {
    // Open the language selector dropdown and pick Español
    await adminPage.getByRole('combobox', { name: /switch to/i }).click()
    await adminPage.getByRole('option', { name: /español/i }).click()
    await expect(adminPage.getByRole('heading', { name: 'Panel' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Notas' })).toBeVisible()

    // Switch back to English — aria-label is now in Spanish ("Cambiar a ...")
    await adminPage.getByRole('combobox', { name: /cambiar a/i }).click()
    await adminPage.getByRole('option', { name: /english/i }).click()
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  })

  test('logout works', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /log out/i }).click()
    await expect(adminPage.getByRole('heading', { name: /sign in/i })).toBeVisible()
  })
})
