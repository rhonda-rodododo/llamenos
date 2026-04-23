import { devices, expect, test } from '../fixtures/auth'

test.use(devices['Pixel 7'])

test('mobile viewport shows hamburger menu', async ({ adminPage }) => {
  // Hamburger button should be visible on mobile
  await expect(adminPage.getByRole('button', { name: /open menu/i })).toBeVisible()

  // Sidebar links should be hidden (sidebar is invisible via CSS)
  await expect(adminPage.getByRole('link', { name: 'Dashboard' })).toBeHidden()

  // Open the menu
  await adminPage.getByRole('button', { name: /open menu/i }).click()

  // Now sidebar links should be visible
  await expect(adminPage.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(adminPage.getByRole('link', { name: 'Notes' })).toBeVisible()

  // Close button (X icon inside the sidebar header) should be visible
  const closeBtn = adminPage
    .getByTestId('nav-sidebar')
    .getByRole('button', { name: /close sidebar/i })
  await expect(closeBtn).toBeVisible()
  await closeBtn.click()

  // Links should be hidden again
  await expect(adminPage.getByRole('link', { name: 'Dashboard' })).toBeHidden()
})

test('mobile page has no horizontal overflow', async ({ adminPage }) => {
  // Check body doesn't overflow
  const bodyWidth = await adminPage.evaluate(() => document.body.scrollWidth)
  const viewportWidth = await adminPage.evaluate(() => window.innerWidth)
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1) // +1 for rounding
})

test('mobile navigation works across pages', async ({ adminPage }) => {
  // Open menu and navigate to Notes
  await adminPage.getByRole('button', { name: /open menu/i }).click()
  await adminPage.getByRole('link', { name: 'Notes' }).click()
  await expect(adminPage.getByRole('heading', { name: /notes/i })).toBeVisible()

  // Menu should auto-close after navigation
  await expect(adminPage.getByRole('link', { name: 'Dashboard' })).toBeHidden()

  // Navigate to Users
  await adminPage.getByRole('button', { name: /open menu/i }).click()
  await adminPage.getByRole('link', { name: 'Users' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()
})

test('mobile pages have no horizontal overflow across routes', async ({ adminPage }) => {
  const routes = ['/notes', '/users', '/admin/settings']
  for (const route of routes) {
    await adminPage.goto(route)
    await adminPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    const bodyWidth = await adminPage.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await adminPage.evaluate(() => window.innerWidth)
    expect(bodyWidth, `Overflow on ${route}`).toBeLessThanOrEqual(viewportWidth + 1)
  }
})
