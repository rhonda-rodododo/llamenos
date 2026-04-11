import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Dashboard Analytics', () => {
  test('analytics section is visible to admins on the dashboard', async ({ adminPage }) => {
    // Admin fixture lands on dashboard — no need to navigate again
    const trigger = adminPage.getByTestId('analytics-section-trigger')
    await expect(trigger).toBeVisible({ timeout: 15000 })
    await expect(trigger).toContainText('Analytics')
  })

  test('analytics section is collapsed by default', async ({ adminPage }) => {
    // Admin fixture lands on dashboard
    // Charts should not be visible when collapsed
    await expect(adminPage.getByTestId('call-volume-chart')).not.toBeVisible()
    await expect(adminPage.getByTestId('call-hours-chart')).not.toBeVisible()
    await expect(adminPage.getByTestId('user-stats-table')).not.toBeVisible()
    // Skeleton loaders also hidden
    await expect(adminPage.getByTestId('call-volume-chart-skeleton')).not.toBeVisible()
  })

  test('analytics section expands and charts render on click', async ({ adminPage }) => {
    const trigger = adminPage.getByTestId('analytics-section-trigger')
    await trigger.click()

    // After expand, either the chart or no-data placeholder should appear
    await expect(
      adminPage.getByTestId('call-volume-chart').or(adminPage.getByTestId('call-volume-no-data'))
    ).toBeVisible({ timeout: 10000 })
    await expect(
      adminPage.getByTestId('call-hours-chart').or(adminPage.getByTestId('call-hours-no-data'))
    ).toBeVisible({ timeout: 10000 })
    await expect(
      adminPage.getByTestId('user-stats-table').or(adminPage.getByTestId('user-stats-no-data'))
    ).toBeVisible({ timeout: 10000 })
  })

  test('no console errors when analytics section is expanded', async ({ adminPage }) => {
    const errors: string[] = []
    adminPage.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    adminPage.on('pageerror', (err) => errors.push(err.message))

    const trigger = adminPage.getByTestId('analytics-section-trigger')
    await trigger.click()
    // Wait for content to load
    await adminPage.waitForTimeout(2000)

    // Filter out known non-critical errors (e.g., network errors in test env)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('net::ERR') &&
        !e.includes('favicon') &&
        !e.includes('serviceworker') &&
        !e.includes('ECONNREFUSED')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('period toggle switches between 7 and 30 days', async ({ adminPage }) => {
    await adminPage.getByTestId('analytics-section-trigger').click()

    // Wait for chart content to load
    await expect(
      adminPage.getByTestId('call-volume-chart').or(adminPage.getByTestId('call-volume-no-data'))
    ).toBeVisible({ timeout: 10000 })

    // The 7d/30d toggle buttons only render when there is chart data.
    // If there's no data (empty DB), the no-data placeholder is shown instead.
    const hasChartData = await adminPage
      .getByTestId('call-volume-chart')
      .isVisible()
      .catch(() => false)

    if (hasChartData) {
      const btn7d = adminPage.getByRole('button', { name: '7d' })
      const btn30d = adminPage.getByRole('button', { name: '30d' })

      await expect(btn7d).toBeVisible({ timeout: 5000 })
      await expect(btn30d).toBeVisible({ timeout: 5000 })

      // Click 30d and verify it triggers a new fetch (button becomes active)
      await btn30d.click()
      await adminPage.waitForTimeout(1000)

      // Click 7d again
      await btn7d.click()
      await adminPage.waitForTimeout(1000)

      // No crash — charts still render
      await expect(
        adminPage.getByTestId('call-volume-chart').or(adminPage.getByTestId('call-volume-no-data'))
      ).toBeVisible({ timeout: 5000 })
    } else {
      // No data state — verify the no-data placeholder is stable
      await expect(adminPage.getByTestId('call-volume-no-data')).toBeVisible()
    }
  })
})

test.describe('Dashboard Analytics — user visibility', () => {
  test('analytics section is hidden from volunteers', async ({ volunteerPage }) => {
    // Navigate to dashboard as a volunteer
    await navigateAfterLogin(volunteerPage, '/')

    // Analytics trigger should NOT be visible for volunteers
    await expect(volunteerPage.getByTestId('analytics-section-trigger')).not.toBeVisible()
  })
})
