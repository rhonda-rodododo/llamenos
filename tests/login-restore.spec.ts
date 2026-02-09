import { test, expect } from '@playwright/test'

test.describe('Login page', () => {
  test('shows secret key input by default', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()

    // Secret key input should be visible by default
    await expect(page.locator('#nsec')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
  })

  test('shows restore from backup toggle', async ({ page }) => {
    await page.goto('/login')

    // Restore button should be visible
    await expect(page.getByRole('button', { name: /restore from backup/i })).toBeVisible()

    // Expand restore section
    await page.getByRole('button', { name: /restore from backup/i }).click()

    // File picker should appear
    await expect(page.getByText(/select backup file/i)).toBeVisible()
  })

  test('invalid nsec shows error', async ({ page }) => {
    await page.goto('/login')

    // Enter invalid key and submit
    await page.locator('#nsec').fill('not-a-valid-nsec')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()

    // Should show error
    await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 5000 })
  })

  test('empty nsec shows error', async ({ page }) => {
    await page.goto('/login')

    // Click login with empty field
    await page.getByRole('button', { name: 'Log in', exact: true }).click()

    // Should show error
    await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 5000 })
  })

  test('language selector is available on login page', async ({ page }) => {
    await page.goto('/login')

    // Language select dropdown should be visible (uses LanguageSelect component)
    await expect(page.getByRole('combobox', { name: /switch to/i })).toBeVisible()
  })

  test('theme toggles work on login page', async ({ page }) => {
    await page.goto('/login')

    // Theme buttons should be visible (system, light, dark)
    await expect(page.getByRole('button', { name: /system theme/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /light theme/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /dark theme/i })).toBeVisible()

    // Click light theme
    await page.getByRole('button', { name: /light theme/i }).click()

    // Verify it's still visible (click toggled state)
    await expect(page.getByRole('button', { name: /light theme/i })).toBeVisible()
  })

  test('security note is visible', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText(/key never leaves your device/i)).toBeVisible()
  })
})
