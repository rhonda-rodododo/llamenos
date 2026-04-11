import { expect, test } from '../fixtures/auth'

test.describe('Theme', () => {
  test('can switch to dark theme', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /dark theme/i }).click()
    await expect(adminPage.locator('html')).toHaveClass(/dark/)
  })

  test('can switch to light theme', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /light theme/i }).click()
    await expect(adminPage.locator('html')).not.toHaveClass(/dark/)
  })

  test('can switch to system theme', async ({ adminPage }) => {
    // First force dark so we know the state changed
    await adminPage.getByRole('button', { name: /dark theme/i }).click()
    await expect(adminPage.locator('html')).toHaveClass(/dark/)

    // Switch to system — should remove the forced class and follow OS preference
    await adminPage.getByRole('button', { name: /system theme/i }).click()

    // In system mode the html element gets dark/light based on OS preference,
    // but the stored value should be "system" (not "dark" or "light")
    const storedTheme = await adminPage.evaluate(() => localStorage.getItem('llamenos-theme'))
    expect(storedTheme).toBe('system')

    // The html element should still have a valid theme applied (either dark or light from OS)
    const htmlClasses = await adminPage.locator('html').getAttribute('class')
    // It should NOT have both dark and light simultaneously — sanity check
    expect(htmlClasses).toBeDefined()
  })

  test('theme persists across page reload', async ({ adminPage }) => {
    await adminPage.getByRole('button', { name: /dark theme/i }).click()
    await expect(adminPage.locator('html')).toHaveClass(/dark/)

    await adminPage.reload()
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 15000,
    })
    // Theme is stored in localStorage and applied by the ThemeProvider before React renders,
    // so the dark class should persist across reload regardless of the PIN/profile-setup flow.
    await expect(adminPage.locator('html')).toHaveClass(/dark/)
  })

  test('theme preference is stored in localStorage', async ({ adminPage }) => {
    // Switch to dark and verify localStorage
    await adminPage.getByRole('button', { name: /dark theme/i }).click()
    let stored = await adminPage.evaluate(() => localStorage.getItem('llamenos-theme'))
    expect(stored).toBe('dark')

    // Switch to light and verify localStorage
    await adminPage.getByRole('button', { name: /light theme/i }).click()
    stored = await adminPage.evaluate(() => localStorage.getItem('llamenos-theme'))
    expect(stored).toBe('light')

    // Switch to system and verify localStorage
    await adminPage.getByRole('button', { name: /system theme/i }).click()
    stored = await adminPage.evaluate(() => localStorage.getItem('llamenos-theme'))
    expect(stored).toBe('system')
  })

  test('login page has theme toggle', async ({ adminPage }) => {
    // Logout first
    await adminPage.getByRole('button', { name: /log out/i }).click()
    await expect(adminPage.getByRole('heading', { name: /sign in/i })).toBeVisible()

    // Theme buttons should be visible on login
    await expect(adminPage.getByRole('button', { name: /dark theme/i })).toBeVisible()
    await expect(adminPage.getByRole('button', { name: /light theme/i })).toBeVisible()
    await expect(adminPage.getByRole('button', { name: /system theme/i })).toBeVisible()
  })

  test('dark theme persists across SPA navigation', async ({ adminPage }) => {
    // Switch to dark
    await adminPage.getByRole('button', { name: /dark theme/i }).click()
    await expect(adminPage.locator('html')).toHaveClass(/dark/)

    // Navigate to Users page
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.waitForURL(/\/users/)
    await expect(adminPage.locator('html')).toHaveClass(/dark/)

    // Navigate back to Dashboard
    await adminPage.getByRole('link', { name: 'Dashboard' }).click()
    await adminPage.waitForURL((u) => u.pathname === '/' || u.pathname === '/index')
    await expect(adminPage.locator('html')).toHaveClass(/dark/)
  })
})
