/**
 * Task 19: platform Health dashboard.
 *
 * Renders two cards:
 *  - System health (DB/storage/relay/version/uptime) from `/api/health`
 *    which is public (used by k8s probes).
 *  - Provider health (telephony + messaging) from
 *    `/api/settings/provider-health` — gated on `settings:read`.
 *
 * The nav item lives in the `operations` group and is gated on
 * `settings:read`.
 */

import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Platform Health (super-admin)', () => {
  test('super-admin sees both health cards with expected rows', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/health')

    // System Health card + dependency rows + version + uptime
    await expect(adminPage.getByTestId('admin-health-system-card')).toBeVisible({ timeout: 30000 })
    await expect(adminPage.getByTestId('admin-health-system-db-status')).toBeVisible()
    await expect(adminPage.getByTestId('admin-health-system-storage-status')).toBeVisible()
    await expect(adminPage.getByTestId('admin-health-system-relay-status')).toBeVisible()
    await expect(adminPage.getByTestId('admin-health-system-version')).toBeVisible()
    await expect(adminPage.getByTestId('admin-health-system-uptime')).toBeVisible()

    // Provider Health card present (may show providers or empty state)
    await expect(adminPage.getByTestId('admin-health-providers-card')).toBeVisible()

    // Manual refresh button visible and clickable
    await expect(adminPage.getByTestId('admin-health-refresh-button')).toBeVisible()
    await adminPage.getByTestId('admin-health-refresh-button').click()
  })

  test('hub admin sees health in the sidebar', async ({ hubAdminPage }) => {
    await navigateAfterLogin(hubAdminPage, '/admin/hub-roles')
    await expect(hubAdminPage.getByTestId('admin-sidebar-item-health')).toBeVisible()
  })
})
