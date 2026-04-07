import { expect, test } from '../fixtures/auth'

test.describe('Security page', () => {
  test('shows Security nav link and redirects /security to /security/sessions', async ({
    adminPage,
  }) => {
    const navLink = adminPage.getByRole('link', { name: /^Security$/ })
    await expect(navLink).toBeVisible()
    await navLink.click()
    await expect(adminPage).toHaveURL(/\/security\/sessions$/)
    await expect(adminPage.getByTestId('sessions-page')).toBeVisible()
  })

  test('switches to passkeys tab', async ({ adminPage }) => {
    // Navigate via client-side link (NOT goto) to preserve crypto worker state
    const navLink = adminPage.getByRole('link', { name: /^Security$/ })
    await navLink.click()
    await expect(adminPage).toHaveURL(/\/security\/sessions$/)
    await expect(adminPage.getByTestId('sessions-page')).toBeVisible({ timeout: 30000 })
    await adminPage.getByTestId('tab-passkeys').click()
    await expect(adminPage).toHaveURL(/\/security\/passkeys$/)
    await expect(adminPage.getByTestId('passkeys-page')).toBeVisible({ timeout: 30000 })
  })

  test('sessions page renders', async ({ adminPage }) => {
    // Navigate via client-side link (NOT goto) to preserve crypto worker state
    const navLink = adminPage.getByRole('link', { name: /^Security$/ })
    await navLink.click()
    await expect(adminPage).toHaveURL(/\/security\/sessions$/)
    // Either the sessions list is visible or the empty state is shown
    const page = adminPage.getByTestId('sessions-page')
    const empty = adminPage.getByText('No active sessions.')
    await expect(page.or(empty)).toBeVisible({ timeout: 30000 })
  })
})
