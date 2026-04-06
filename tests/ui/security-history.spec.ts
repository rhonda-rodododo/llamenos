import { expect, test } from '../fixtures/auth'

test.describe('Security history', () => {
  test('history tab link navigates to /security/history', async ({ adminPage }) => {
    await adminPage.goto('/security/sessions')
    await adminPage.getByTestId('tab-history').click()
    await expect(adminPage).toHaveURL(/\/security\/history$/)
    await expect(adminPage.getByTestId('history-page')).toBeVisible()
  })

  test('history page renders (list or empty state)', async ({ adminPage }) => {
    await adminPage.goto('/security/history')
    const page = adminPage.getByTestId('history-page')
    await expect(page).toBeVisible()
    // Export button is always present
    await expect(adminPage.getByTestId('export-history')).toBeVisible()
  })

  test('export triggers a download', async ({ adminPage }) => {
    await adminPage.goto('/security/history')
    await expect(adminPage.getByTestId('history-page')).toBeVisible()
    const downloadPromise = adminPage.waitForEvent('download')
    await adminPage.getByTestId('export-history').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^auth-history-/)
  })
})
