/**
 * Task 18: platform Analytics section (super-admin only).
 *
 * The `/analytics` endpoint is mounted twice in src/server/app.ts:
 *   - on `authenticated` (no hubContext → hubId undefined → cross-hub),
 *   - on `hubScoped` (hub-scoped).
 *
 * AnalyticsSection hits only the un-prefixed `/analytics` endpoints via
 * `useGlobalCallAnalytics`, `useGlobalCallHoursAnalytics`,
 * `useGlobalUserStatsAnalytics`, so this view aggregates activity across ALL
 * hubs. The nav item lives in the `platform` group and is gated on
 * role-super-admin + calls:read-history / audit:read.
 */

import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Platform Analytics (super-admin)', () => {
  test('super-admin sees all three analytics cards', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/analytics')

    // Range toggle visible
    await expect(adminPage.getByTestId('admin-analytics-range-7')).toBeVisible({ timeout: 30000 })
    await expect(adminPage.getByTestId('admin-analytics-range-30')).toBeVisible()

    // All three card content areas present (charts or no-data states render inside them)
    await expect(adminPage.getByTestId('admin-analytics-call-volume-chart')).toBeVisible({
      timeout: 10000,
    })
    await expect(adminPage.getByTestId('admin-analytics-hours-chart')).toBeVisible()

    // Users table or empty state
    const table = adminPage.getByTestId('admin-analytics-users-table')
    const card = adminPage.getByText(/Per-user activity/i).first()
    await expect(card).toBeVisible()
    // Table may be absent if no data — that's fine
    await table.count()
  })

  test('range toggle switches between 7 and 30 days', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/analytics')

    await expect(adminPage.getByTestId('admin-analytics-range-7')).toBeVisible({ timeout: 30000 })

    // Click 30-day range
    await adminPage.getByTestId('admin-analytics-range-30').click()

    // Call volume card still present after refetch
    await expect(adminPage.getByTestId('admin-analytics-call-volume-chart')).toBeVisible({
      timeout: 10000,
    })

    // Click back to 7-day
    await adminPage.getByTestId('admin-analytics-range-7').click()
    await expect(adminPage.getByTestId('admin-analytics-call-volume-chart')).toBeVisible({
      timeout: 10000,
    })
  })

  test('hub admin sees analytics in the sidebar', async ({ hubAdminPage }) => {
    await navigateAfterLogin(hubAdminPage, '/admin/hub-roles')
    await expect(hubAdminPage.getByTestId('admin-sidebar-item-analytics')).toBeVisible()
  })
})
