import { test, expect } from '@playwright/test'
import { ADMIN_NSEC, loginAsAdmin } from './helpers'

test.describe('Auth guards', () => {
  test('unauthenticated user is redirected to login from /', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated user is redirected from /notes', async ({ page }) => {
    await page.goto('/notes')
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated user is redirected from /settings', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated user is redirected from /admin/settings', async ({ page }) => {
    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/\/login/)
  })

  test('session persists across page reload', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // Reload and check session persists
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('logout clears session', async ({ page }) => {
    await loginAsAdmin(page)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // Logout
    await page.getByRole('button', { name: /log out/i }).click()
    await expect(page).toHaveURL(/\/login/)

    // Should not be able to access dashboard
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('API returns 401 for unauthenticated requests', async ({ page }) => {
    // Direct API call without auth
    const response = await page.request.get('/api/volunteers')
    expect(response.status()).toBe(401)
  })
})
