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
    await adminPage.goto('/security/sessions')
    await expect(adminPage.getByTestId('sessions-page')).toBeVisible()
    await adminPage.getByTestId('tab-passkeys').click()
    await expect(adminPage).toHaveURL(/\/security\/passkeys$/)
    await expect(adminPage.getByTestId('passkeys-page')).toBeVisible()
  })

  test('sessions page renders (no sessions or with none)', async ({ adminPage }) => {
    await adminPage.goto('/security/sessions')
    // Either the sessions list is visible or the empty state is shown
    const page = adminPage.getByTestId('sessions-page')
    const empty = adminPage.getByText('No active sessions.')
    await expect(page.or(empty)).toBeVisible()
  })
})
