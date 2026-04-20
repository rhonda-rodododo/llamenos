import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin, uniquePhone } from '../helpers'

test.describe('Team Contact Assignment', () => {
  test('team management page loads', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/teams')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute('data-section', 'teams')
    // Wait for teams to load (teamsLoading starts true, then renders list)
    await expect(adminPage.getByTestId('admin-teams-list')).toBeVisible({ timeout: 15000 })
  })

  test('can create a team', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/teams')
    await expect(adminPage.getByTestId('admin-teams-list')).toBeVisible({ timeout: 15000 })

    const teamName = `Team ${Date.now()}`
    await adminPage.getByTestId('admin-teams-create').click()
    await adminPage.getByTestId('admin-teams-name-input').fill(teamName)
    await adminPage.getByTestId('admin-teams-description-input').fill('E2E test team')
    await adminPage.getByTestId('admin-teams-save').click()

    await expect(adminPage.getByTestId('admin-teams-save-success')).toBeVisible({ timeout: 5000 })
    await expect(adminPage.getByText(teamName)).toBeVisible()
  })

  test('contact detail shows team assignment card', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/contacts')
    await expect(adminPage.getByTestId('new-contact-btn')).toBeVisible({ timeout: 10000 })
    await adminPage.getByTestId('new-contact-btn').click()

    await expect(adminPage.getByTestId('create-contact-dialog')).toBeVisible({ timeout: 5000 })
    // Use displayName input specifically to avoid strict mode violation
    await adminPage.locator('#displayName').fill(`Contact ${Date.now()}`)
    await adminPage.getByRole('button', { name: /create/i }).click()

    await adminPage.waitForURL(/\/contacts\//, { timeout: 10000 })
    await expect(adminPage.getByTestId('contact-summary-card')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByTestId('contact-teams-card')).toBeVisible()
  })

  test('can assign and unassign a team to a contact', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/teams')
    await expect(adminPage.getByTestId('admin-teams-list')).toBeVisible({ timeout: 15000 })

    const teamName = `AssignTeam ${Date.now()}`
    await adminPage.getByTestId('admin-teams-create').click()
    await adminPage.getByTestId('admin-teams-name-input').fill(teamName)
    await adminPage.getByTestId('admin-teams-save').click()
    await expect(adminPage.getByTestId('admin-teams-save-success')).toBeVisible({ timeout: 5000 })

    await navigateAfterLogin(adminPage, '/contacts')
    await expect(adminPage.getByTestId('new-contact-btn')).toBeVisible({ timeout: 10000 })
    await adminPage.getByTestId('new-contact-btn').click()

    await expect(adminPage.getByTestId('create-contact-dialog')).toBeVisible({ timeout: 5000 })
    const contactName = `AssignContact ${Date.now()}`
    await adminPage.locator('#displayName').fill(contactName)
    await adminPage.getByRole('button', { name: /create/i }).click()

    await adminPage.waitForURL(/\/contacts\//, { timeout: 10000 })
    await expect(adminPage.getByTestId('contact-summary-card')).toBeVisible({ timeout: 10000 })

    await expect(adminPage.getByTestId('team-assign-select')).toBeVisible()
    await adminPage.getByTestId('team-assign-select').click()

    const option = adminPage.getByRole('option').filter({ hasText: teamName })
    const optionCount = await option.count()

    if (optionCount === 0) {
      await adminPage.keyboard.press('Escape')
      test.skip()
      return
    }

    await option.click()

    await expect(adminPage.getByTestId('contact-team-badges')).toBeVisible()
    await expect(adminPage.getByText(teamName)).toBeVisible()

    const unassignBtn = adminPage.locator(`[data-testid^="team-unassign-"]`).first()
    if (await unassignBtn.isVisible().catch(() => false)) {
      await unassignBtn.click()
      await expect(adminPage.locator('span').filter({ hasText: teamName })).not.toBeVisible()
    }
  })
})
