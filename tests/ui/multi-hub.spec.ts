import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

test.describe('Multi-hub architecture — UI', () => {
  test.describe.configure({ mode: 'serial' })

  test('existing pages still work with hub context', async ({ adminPage }) => {
    // Verify all main pages load correctly with hub context active
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 10000 })

    await adminPage.getByRole('link', { name: 'Shifts' }).click()
    await expect(adminPage.getByRole('heading', { name: /shift schedule/i })).toBeVisible({
      timeout: 10000,
    })

    await adminPage.getByRole('link', { name: 'Ban List' }).click()
    await expect(adminPage.getByRole('heading', { name: /ban list/i })).toBeVisible({
      timeout: 10000,
    })

    await adminPage.getByRole('link', { name: 'Audit Log' }).click()
    await expect(adminPage.getByTestId('audit-log-heading')).toBeVisible({ timeout: 10000 })

    await adminPage.getByRole('link', { name: 'Dashboard' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 10000,
    })
  })

  test('admin can archive a hub via the UI', async ({ adminPage, request }) => {
    const authedApi = createAdminApiFromStorageState(request)

    // Create a hub via the API so the test doesn't depend on prior state
    const hubName = `archive-test-${Date.now()}`
    const createRes = await authedApi.post('/api/hubs', { name: hubName })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(created).toHaveProperty('hub')

    // Navigate to the hub management page
    await navigateAfterLogin(adminPage, '/admin/hubs')

    // Confirm the hub appears in the active list (hub names are encrypted — need decryption time)
    await expect(adminPage.getByText(hubName)).toBeVisible({ timeout: 30000 })

    // Open the edit dialog for this hub, then navigate to the Danger tab
    const hubRow = adminPage.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    await hubRow.getByRole('button', { name: /edit/i }).click()

    // Edit dialog should appear
    await expect(adminPage.getByRole('dialog')).toBeVisible()

    // Switch to the Danger tab and click Archive
    await adminPage.getByTestId('admin-hubs-edit-dialog-tab-danger').click()
    await adminPage.getByTestId('admin-hubs-danger-archive-button').click()

    // Archive confirmation dialog should appear
    await expect(adminPage.getByRole('dialog').filter({ hasText: hubName })).toBeVisible()

    // Confirm the archive action (click the destructive Archive Hub button in dialog)
    await adminPage
      .getByRole('button', { name: /archive hub/i })
      .last()
      .click()

    // Dialog should close and hub should no longer appear in the active list
    await expect(adminPage.getByRole('dialog')).not.toBeVisible()
    await expect(adminPage.getByText(hubName)).not.toBeVisible()
  })

  test('hub delete requires typing hub name to confirm', async ({ adminPage, request }) => {
    const authedApi = createAdminApiFromStorageState(request)
    const hubName = `delete-confirm-test-${Date.now()}`

    // Create + archive a hub via API
    const createRes = await authedApi.post('/api/hubs', { name: hubName })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    const hubId = created.hub.id

    const archiveRes = await authedApi.patch(`/api/hubs/${hubId}`, { status: 'archived' })
    expect(archiveRes.ok()).toBe(true)

    await navigateAfterLogin(adminPage, '/admin/hubs')

    // The hub should appear in the list (with archived status)
    const hubRow = adminPage.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    await expect(hubRow).toBeVisible({ timeout: 10000 })
    // The row's delete button opens the edit dialog — navigate to Danger tab
    await hubRow.getByTestId('hub-delete-btn').click()
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await adminPage.getByTestId('admin-hubs-edit-dialog-tab-danger').click()
    await adminPage.getByTestId('admin-hubs-danger-delete-button').click()

    // Delete confirmation dialog opens
    await expect(adminPage.getByRole('dialog').filter({ hasText: /delete hub/i })).toBeVisible()

    // Confirm button disabled until name typed
    const confirmBtn = adminPage.getByTestId('delete-hub-confirm-btn')
    await expect(confirmBtn).toBeDisabled()

    // Type wrong name — still disabled
    await adminPage.getByTestId('delete-hub-confirm-input').fill('wrong-name')
    await expect(confirmBtn).toBeDisabled()

    // Type correct name — button enabled
    await adminPage.getByTestId('delete-hub-confirm-input').fill(hubName)
    await expect(confirmBtn).toBeEnabled()

    // Cancel without deleting — closes the inner delete-confirm dialog.
    // The outer edit dialog (admin-hubs-edit-dialog) remains open; verify the
    // inner confirm dialog's inputs/button are gone, then close the outer too.
    await adminPage.getByRole('button', { name: /cancel/i }).click()
    await expect(adminPage.getByTestId('delete-hub-confirm-btn')).not.toBeVisible()
    await adminPage.keyboard.press('Escape')
    await expect(adminPage.getByRole('dialog')).not.toBeVisible()
  })

  test('admin can permanently delete an archived hub', async ({ adminPage, request }) => {
    const authedApi = createAdminApiFromStorageState(request)
    const hubName = `perm-delete-test-${Date.now()}`

    // Create + archive via API
    const createRes = await authedApi.post('/api/hubs', { name: hubName })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    const hubId = created.hub.id

    const archiveRes = await authedApi.patch(`/api/hubs/${hubId}`, { status: 'archived' })
    expect(archiveRes.ok()).toBe(true)

    await navigateAfterLogin(adminPage, '/admin/hubs')

    const hubRow = adminPage.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    await expect(hubRow).toBeVisible()
    await hubRow.getByTestId('hub-delete-btn').click()
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await adminPage.getByTestId('admin-hubs-edit-dialog-tab-danger').click()
    await adminPage.getByTestId('admin-hubs-danger-delete-button').click()

    await expect(adminPage.getByRole('dialog').filter({ hasText: /delete hub/i })).toBeVisible()
    await adminPage.getByTestId('delete-hub-confirm-input').fill(hubName)
    await adminPage.getByTestId('delete-hub-confirm-btn').click()

    // Dialog closes and hub is removed from list
    await expect(adminPage.getByRole('dialog')).not.toBeVisible()
    await expect(
      adminPage.locator('[data-testid="hub-row"]').filter({ hasText: hubName })
    ).not.toBeVisible()

    // Verify hub is gone via API
    const getRes = await authedApi.get(`/api/hubs/${hubId}`)
    expect(getRes.status()).toBe(404)
  })
})
