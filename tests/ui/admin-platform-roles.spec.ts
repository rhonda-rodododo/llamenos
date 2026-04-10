/**
 * Task 15: Platform Roles section (super-admin only).
 *
 * The /api/settings/roles endpoint is platform-scoped because the settings
 * routes don't mount under hubContext middleware — c.get('hubId') is always
 * undefined on the server, so we hit the hubId IS NULL rows. The
 * PlatformRolesSection shares that endpoint and the same React Query cache
 * (queryKeys.roles.list()) with HubRolesSection, but lives under the platform
 * group and is gated on role-super-admin.
 */

import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Platform Roles (super-admin)', () => {
  test('super-admin can create and delete a custom platform role', async ({ adminPage }) => {
    const roleName = `e2e-test-role-${Date.now()}`

    await navigateAfterLogin(adminPage, '/admin/platform-roles')

    // Table visible
    await expect(adminPage.getByTestId('admin-platform-roles-table')).toBeVisible({
      timeout: 30000,
    })

    // Open create dialog
    await adminPage.getByTestId('admin-platform-roles-create-button').click()
    await expect(adminPage.getByTestId('admin-platform-roles-name-input')).toBeVisible()

    await adminPage.getByTestId('admin-platform-roles-name-input').fill(roleName)
    await adminPage
      .getByTestId('admin-platform-roles-description-input')
      .fill('Created by e2e test')
    await adminPage.getByTestId('admin-platform-roles-save').click()

    // Role appears in the table — scope the text lookup to the table so it
    // can't collide with any unrelated text elsewhere on the page.
    const table = adminPage.getByTestId('admin-platform-roles-table')
    await expect(table.getByText(roleName)).toBeVisible({ timeout: 10000 })

    // Delete it — we have to locate the row via text filter because the role id
    // is server-generated. Find the row's delete button by matching on row text.
    const row = adminPage.locator('tr', { hasText: roleName })
    await row.locator('[data-testid^="admin-platform-roles-delete-"]').click()

    // Confirm in the delete dialog
    await adminPage.getByTestId('admin-platform-roles-confirm-delete').click()

    // Role disappears from the table. Scope to the table to avoid matching
    // the role name that appears inside the delete-confirmation dialog
    // description ("Are you sure you want to delete '{name}'"), which Radix
    // dialogs keep mounted briefly during their close animation.
    await expect(table.getByText(roleName)).not.toBeVisible({ timeout: 10000 })
  })

  test('system super-admin role is read-only', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/platform-roles')

    await expect(adminPage.getByTestId('admin-platform-roles-table')).toBeVisible({
      timeout: 30000,
    })

    const editButton = adminPage.getByTestId('admin-platform-roles-edit-role-super-admin')
    const deleteButton = adminPage.getByTestId('admin-platform-roles-delete-role-super-admin')

    await expect(editButton).toBeDisabled()
    await expect(deleteButton).toBeDisabled()

    // System badge visible on that row
    const row = adminPage.getByTestId('admin-platform-roles-row-role-super-admin')
    await expect(row).toBeVisible()
  })

  test('hub admin does not see platform roles in the sidebar', async ({ hubAdminPage }) => {
    // The platform group is hidden from non-super-admins. Navigate to any admin
    // section and assert the sidebar item isn't present.
    await navigateAfterLogin(hubAdminPage, '/admin/hub-roles')
    await expect(hubAdminPage.getByTestId('admin-sidebar-item-platform-roles')).toHaveCount(0)
  })
})
