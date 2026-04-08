/**
 * Task 17: platform Audit log section (super-admin only).
 *
 * The `/audit` endpoint is mounted twice in src/server/app.ts:
 *   - on `authenticated` (no hubContext → rows with hub_id = 'global'),
 *   - on `hubScoped` (hub-scoped rows).
 *
 * AuditSection hits only the un-prefixed `/audit` path via useGlobalAuditLog,
 * so this view shows platform-wide entries across ALL hubs. The nav item
 * lives in the `platform` group and is gated on role-super-admin + audit:read.
 */

import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Platform Audit log (super-admin)', () => {
  test('super-admin sees audit table with filters and pagination', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/audit')

    // Filters visible
    await expect(adminPage.getByTestId('admin-audit-filter-event-type')).toBeVisible({
      timeout: 30000,
    })
    await expect(adminPage.getByTestId('admin-audit-filter-date-from')).toBeVisible()
    await expect(adminPage.getByTestId('admin-audit-filter-date-to')).toBeVisible()
    await expect(adminPage.getByTestId('admin-audit-search-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-audit-clear-filters')).toBeVisible()

    // Pagination controls visible
    await expect(adminPage.getByTestId('admin-audit-page-info')).toBeVisible()
    await expect(adminPage.getByTestId('admin-audit-prev-page')).toBeVisible()
    await expect(adminPage.getByTestId('admin-audit-next-page')).toBeVisible()

    // Table or empty state
    const table = adminPage.getByTestId('admin-audit-table')
    const empty = adminPage.getByTestId('admin-audit-empty')
    await expect(table.or(empty)).toBeVisible({ timeout: 10000 })
  })

  test('super-admin can filter by search term and clear filters', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/audit')

    await expect(adminPage.getByTestId('admin-audit-search-input')).toBeVisible({
      timeout: 30000,
    })

    // Enter a search term that is extremely unlikely to match anything.
    const gibberish = `zzz_no_match_${Date.now()}`
    await adminPage.getByTestId('admin-audit-search-input').fill(gibberish)

    // Empty state should appear (React Query refetches as filters change).
    await expect(adminPage.getByTestId('admin-audit-empty')).toBeVisible({ timeout: 10000 })

    // Clear filters resets state — search input should be empty again.
    await adminPage.getByTestId('admin-audit-clear-filters').click()
    await expect(adminPage.getByTestId('admin-audit-search-input')).toHaveValue('')
  })

  test('super-admin can filter by event type', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/audit')

    await expect(adminPage.getByTestId('admin-audit-filter-event-type')).toBeVisible({
      timeout: 30000,
    })

    // Select an event category
    await adminPage.getByTestId('admin-audit-filter-event-type').selectOption('authentication')

    // Table or empty state still present
    const table = adminPage.getByTestId('admin-audit-table')
    const empty = adminPage.getByTestId('admin-audit-empty')
    await expect(table.or(empty)).toBeVisible({ timeout: 10000 })
  })

  test('pagination prev button is disabled on first page', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/audit')

    await expect(adminPage.getByTestId('admin-audit-prev-page')).toBeVisible({ timeout: 30000 })
    await expect(adminPage.getByTestId('admin-audit-prev-page')).toBeDisabled()
  })

  test('hub admin does not see platform audit in the sidebar', async ({ hubAdminPage }) => {
    // The platform group is hidden from non-super-admins. Navigate to any
    // hub-admin section and assert the sidebar item isn't present.
    await navigateAfterLogin(hubAdminPage, '/admin/hub-roles')
    await expect(hubAdminPage.getByTestId('admin-sidebar-item-audit')).toHaveCount(0)
  })
})
