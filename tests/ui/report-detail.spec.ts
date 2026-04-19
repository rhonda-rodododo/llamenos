import { expect, test } from '../fixtures/auth'

test.describe('Report Detail', () => {
  test('report detail view renders when report is selected', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Reports' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
      timeout: 10000,
    })

    // Create a report
    const title = `Detail Test ${Date.now()}`
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible({
      timeout: 5000,
    })
    await adminPage.getByPlaceholder('Brief description of the report').fill(title)
    await adminPage.getByPlaceholder('Describe the situation in detail...').fill('Detail view test')
    await adminPage.getByRole('button', { name: /submit report/i }).click()

    await expect(adminPage.getByText(title).first()).toBeVisible({ timeout: 20000 })
    await adminPage.locator('button[type="button"]').filter({ hasText: title }).click()

    await expect(adminPage.getByTestId('report-detail-header')).toBeVisible({ timeout: 5000 })
    await expect(adminPage.getByTestId('report-detail-title')).toContainText(title)
  })

  test('report detail shows claim button for waiting reports', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Reports' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
      timeout: 10000,
    })

    const title = `Claim Test ${Date.now()}`
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible({
      timeout: 5000,
    })
    await adminPage.getByPlaceholder('Brief description of the report').fill(title)
    await adminPage.getByPlaceholder('Describe the situation in detail...').fill('Claim test')
    await adminPage.getByRole('button', { name: /submit report/i }).click()

    await expect(adminPage.getByText(title).first()).toBeVisible({ timeout: 20000 })
    await adminPage.locator('button[type="button"]').filter({ hasText: title }).click()

    await expect(adminPage.getByTestId('report-detail-claim')).toBeVisible({ timeout: 5000 })
  })

  test('report detail shows messages area', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Reports' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
      timeout: 10000,
    })

    const title = `Messages Test ${Date.now()}`
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible({
      timeout: 5000,
    })
    await adminPage.getByPlaceholder('Brief description of the report').fill(title)
    await adminPage.getByPlaceholder('Describe the situation in detail...').fill('Messages test')
    await adminPage.getByRole('button', { name: /submit report/i }).click()

    await expect(adminPage.getByText(title).first()).toBeVisible({ timeout: 20000 })
    await adminPage.locator('button[type="button"]').filter({ hasText: title }).click()

    await expect(adminPage.getByTestId('report-detail-messages')).toBeVisible({ timeout: 5000 })
  })

  test('report detail shows reply composer for active report', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Reports' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
      timeout: 10000,
    })

    const title = `Reply Test ${Date.now()}`
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible({
      timeout: 5000,
    })
    await adminPage.getByPlaceholder('Brief description of the report').fill(title)
    await adminPage
      .getByPlaceholder('Describe the situation in detail...')
      .fill('Reply composer test')
    await adminPage.getByRole('button', { name: /submit report/i }).click()

    await expect(adminPage.getByText(title).first()).toBeVisible({ timeout: 20000 })
    await adminPage.locator('button[type="button"]').filter({ hasText: title }).click()

    await expect(adminPage.getByTestId('report-detail-claim')).toBeVisible({ timeout: 5000 })
    await adminPage.getByTestId('report-detail-claim').click()
    await expect(adminPage.getByText('Active')).toBeVisible({ timeout: 10000 })

    await expect(adminPage.getByTestId('report-detail-composer')).toBeVisible({ timeout: 5000 })
    await expect(adminPage.getByTestId('report-detail-reply-textarea')).toBeVisible()
  })

  test('report detail shows close button for active report as admin', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Reports' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
      timeout: 10000,
    })

    const title = `Close Test ${Date.now()}`
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible({
      timeout: 5000,
    })
    await adminPage.getByPlaceholder('Brief description of the report').fill(title)
    await adminPage
      .getByPlaceholder('Describe the situation in detail...')
      .fill('Close button test')
    await adminPage.getByRole('button', { name: /submit report/i }).click()

    await expect(adminPage.getByText(title).first()).toBeVisible({ timeout: 20000 })
    await adminPage.locator('button[type="button"]').filter({ hasText: title }).click()

    await expect(adminPage.getByTestId('report-detail-claim')).toBeVisible({ timeout: 5000 })
    await adminPage.getByTestId('report-detail-claim').click()
    await expect(adminPage.getByText('Active')).toBeVisible({ timeout: 10000 })

    await expect(adminPage.getByTestId('close-report')).toBeVisible({ timeout: 5000 })
  })
})
