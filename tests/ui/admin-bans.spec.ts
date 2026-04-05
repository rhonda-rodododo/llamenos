/**
 * Task 16: platform Bans section (super-admin only).
 *
 * The `/bans` endpoint is mounted twice in src/server/app.ts:
 *   - on `authenticated` (no hubContext → rows with hub_id = 'global'),
 *   - on `hubScoped` (hub-scoped rows).
 *
 * BansSection hits only the un-prefixed `/bans` path via useGlobalBans, so
 * the numbers banned here block calls across ALL hubs. The nav item lives in
 * the `platform` group and is gated on role-super-admin + bans:read.
 */

import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin, uniquePhone } from '../helpers'

test.describe('Platform Bans (super-admin)', () => {
  test('super-admin can add a global ban and then delete it', async ({ adminPage }) => {
    const phone = uniquePhone()

    await navigateAfterLogin(adminPage, '/admin/bans')

    // Add form visible
    await expect(adminPage.getByTestId('admin-bans-add-phone-input')).toBeVisible({
      timeout: 30000,
    })

    await adminPage.getByTestId('admin-bans-add-phone-input').fill(phone)
    await adminPage.getByTestId('admin-bans-add-reason-input').fill('E2E spam test')
    await adminPage.getByTestId('admin-bans-add-button').click()

    // Ban appears in the table
    await expect(adminPage.getByTestId('admin-bans-table')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByTestId(`admin-bans-row-${phone}`)).toBeVisible({
      timeout: 10000,
    })

    // Delete it
    await adminPage.getByTestId(`admin-bans-delete-${phone}`).click()
    await adminPage.getByTestId('admin-bans-confirm-delete').click()

    // Row gone
    await expect(adminPage.getByTestId(`admin-bans-row-${phone}`)).toHaveCount(0, {
      timeout: 10000,
    })
  })

  test('super-admin can bulk import bans via CSV', async ({ adminPage }) => {
    const phoneA = uniquePhone()
    const phoneB = uniquePhone()
    const csv = `${phoneA}\n${phoneB}\n`

    await navigateAfterLogin(adminPage, '/admin/bans')

    await expect(adminPage.getByTestId('admin-bans-bulk-upload-input')).toBeVisible({
      timeout: 30000,
    })

    // Attach CSV via buffer
    await adminPage.getByTestId('admin-bans-bulk-upload-input').setInputFiles({
      name: 'bans.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    })

    await adminPage.getByTestId('admin-bans-bulk-reason-input').fill('Bulk E2E')
    await adminPage.getByTestId('admin-bans-bulk-submit').click()

    // Both rows should appear
    await expect(adminPage.getByTestId(`admin-bans-row-${phoneA}`)).toBeVisible({
      timeout: 10000,
    })
    await expect(adminPage.getByTestId(`admin-bans-row-${phoneB}`)).toBeVisible({
      timeout: 10000,
    })

    // Clean up
    await adminPage.getByTestId(`admin-bans-delete-${phoneA}`).click()
    await adminPage.getByTestId('admin-bans-confirm-delete').click()
    await expect(adminPage.getByTestId(`admin-bans-row-${phoneA}`)).toHaveCount(0, {
      timeout: 10000,
    })
    await adminPage.getByTestId(`admin-bans-delete-${phoneB}`).click()
    await adminPage.getByTestId('admin-bans-confirm-delete').click()
    await expect(adminPage.getByTestId(`admin-bans-row-${phoneB}`)).toHaveCount(0, {
      timeout: 10000,
    })
  })

  test('hub admin does not see platform bans in the sidebar', async ({ hubAdminPage }) => {
    // The platform group is hidden from non-super-admins. Navigate to any
    // hub-admin section and assert the sidebar item isn't present.
    await navigateAfterLogin(hubAdminPage, '/admin/hub-roles')
    await expect(hubAdminPage.getByTestId('admin-sidebar-item-bans')).toHaveCount(0)
  })
})
