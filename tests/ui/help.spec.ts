import { expect, test } from '../fixtures/auth'

test.describe('Help & Getting Started', () => {
  test.describe.configure({ mode: 'serial' })

  test('help page loads with FAQ sections', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Help' }).click()

    // Page heading should be visible
    await expect(adminPage.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Quick reference cards should be visible
    await expect(adminPage.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible()
    await expect(adminPage.getByRole('heading', { name: 'Security' })).toBeVisible()

    // FAQ sections should be present
    await expect(adminPage.getByText('Getting Started')).toBeVisible()
    await expect(adminPage.getByText('Calls & Shifts')).toBeVisible()
    await expect(adminPage.getByText('Notes & Encryption')).toBeVisible()

    // Admin-only FAQ section should be visible for admin
    await expect(adminPage.getByText('Administration')).toBeVisible()
  })

  test('help page FAQ items expand on click', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Help' }).click()
    await expect(adminPage.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Click a FAQ question
    const faqQuestion = adminPage.getByText('How do I log in?')
    await faqQuestion.click()

    // The answer should be visible
    await expect(adminPage.getByText(/6-digit PIN/)).toBeVisible()

    // Click again to collapse
    await faqQuestion.click()
    await expect(adminPage.getByText(/6-digit PIN/)).not.toBeVisible()
  })

  test('help page shows admin guide for admin users', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Help' }).click()
    await expect(adminPage.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Admin guide section should be visible for admin users
    await expect(adminPage.getByText('Admin Guide')).toBeVisible()
  })

  test('help page shows keyboard shortcuts reference', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Help' }).click()
    await expect(adminPage.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Shortcut reference card should show shortcuts
    await expect(adminPage.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible()
    await expect(adminPage.getByText('Ctrl+K', { exact: true })).toBeVisible()
    await expect(adminPage.getByText('Alt+N', { exact: true })).toBeVisible()
  })

  test('help page shows quick navigation links', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Help' }).click()
    await expect(adminPage.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 10000 })

    // Quick nav section should have links
    await expect(adminPage.getByRole('heading', { name: 'Quick Navigation' })).toBeVisible()
    // Scope to main content to avoid matching sidebar nav links
    const mainContent = adminPage.locator('main')
    await expect(mainContent.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(mainContent.getByRole('link', { name: 'Users' })).toBeVisible()
  })

  test('help link is visible in sidebar', async ({ adminPage }) => {
    // On dashboard, Help link should be in sidebar
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })

    const helpLink = adminPage.locator('nav').getByRole('link', { name: 'Help' })
    await expect(helpLink).toBeVisible()

    // Click it to navigate
    await helpLink.click()
    await expect(adminPage).toHaveURL(/\/help/)
    await expect(adminPage.getByRole('heading', { name: /help/i })).toBeVisible()
  })

  test('getting started checklist shows on dashboard', async ({ adminPage }) => {
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })

    // Clear any previous dismissal, then navigate away and back to force remount
    await adminPage.evaluate(() => localStorage.removeItem('getting-started-dismissed'))
    await adminPage.getByRole('link', { name: 'Help' }).click()
    await expect(adminPage.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 5000 })
    await adminPage.locator('nav').getByRole('link', { name: 'Dashboard' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })

    // Global test setup resets the DB before each run: only the seeded admin
    // exists, setupCompleted is false, no shifts, no hotline number — so the
    // checklist MUST render. If it doesn't, something is broken.
    await expect(adminPage.getByTestId('getting-started-checklist')).toBeVisible({
      timeout: 10000,
    })
  })

  test('getting started checklist can be dismissed', async ({ adminPage }) => {
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })

    // Clear any previous dismissal, then navigate away and back to force remount
    await adminPage.evaluate(() => localStorage.removeItem('getting-started-dismissed'))
    await adminPage.getByRole('link', { name: 'Help' }).click()
    await expect(adminPage.getByRole('heading', { name: /help/i })).toBeVisible({ timeout: 5000 })
    await adminPage.locator('nav').getByRole('link', { name: 'Dashboard' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })

    const checklist = adminPage.getByTestId('getting-started-checklist')
    await expect(checklist).toBeVisible({ timeout: 10000 })

    await adminPage.getByTestId('getting-started-dismiss').click()

    await expect(checklist).not.toBeVisible({ timeout: 3000 })
  })

  test('command palette includes Help command', async ({ adminPage }) => {
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })

    // Open command palette with Ctrl+K
    await adminPage.keyboard.press('Control+k')
    await expect(adminPage.getByPlaceholder('Type a command or search...')).toBeVisible({
      timeout: 5000,
    })

    // Type "help" to search
    await adminPage.getByPlaceholder('Type a command or search...').fill('help')

    // Help command should appear
    await expect(adminPage.getByRole('option', { name: 'Help', exact: true })).toBeVisible()
  })
})
