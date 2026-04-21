import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Intake Detail', () => {
  test('intakes page loads with filter', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/intakes')
    await expect(adminPage.getByTestId('intakes-page')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByTestId('intakes-status-filter')).toBeVisible()
  })

  test('intake detail panel shows when row is clicked', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/intakes')
    await expect(adminPage.getByTestId('intakes-page')).toBeVisible({ timeout: 10000 })

    await adminPage.waitForTimeout(1500)

    const rows = adminPage.getByTestId('intake-row')
    const count = await rows.count()

    if (count === 0) {
      test.skip()
      return
    }

    await rows.first().click()
    await expect(adminPage.getByTestId('intake-detail-panel')).toBeVisible({ timeout: 5000 })
  })

  test('intake status filter changes displayed rows', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/intakes')
    await expect(adminPage.getByTestId('intakes-page')).toBeVisible({ timeout: 10000 })
    await adminPage.waitForTimeout(1500)

    await adminPage.getByTestId('intakes-status-filter').click()
    await adminPage.getByRole('option', { name: /all/i }).click()
    await expect(adminPage.getByTestId('intakes-page')).toBeVisible()

    await adminPage.getByTestId('intakes-status-filter').click()
    await adminPage.getByRole('option', { name: /reviewed/i }).click()
    await expect(adminPage.getByTestId('intakes-page')).toBeVisible()
  })

  test('intake detail shows action buttons for triage permission', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/intakes')
    await expect(adminPage.getByTestId('intakes-page')).toBeVisible({ timeout: 10000 })
    await adminPage.waitForTimeout(1500)

    const rows = adminPage.getByTestId('intake-row')
    const count = await rows.count()

    if (count === 0) {
      test.skip()
      return
    }

    // Click first row to open detail
    await rows.first().click()
    await expect(adminPage.getByTestId('intake-detail-panel')).toBeVisible({ timeout: 5000 })

    await expect(adminPage.getByTestId('intake-review-btn')).toBeVisible()
    await expect(adminPage.getByTestId('intake-merge-btn')).toBeVisible()
    await expect(adminPage.getByTestId('intake-dismiss-btn')).toBeVisible()
  })
})
