import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

// --- Role-based UI navigation ---

test.describe('Role-based UI visibility', () => {
  test('reporter sees reports UI, not call/user management', async ({ reporterPage }) => {
    // Reporter should see Reports link
    await expect(reporterPage.getByRole('link', { name: 'Reports' })).toBeVisible()

    // Reporter should NOT see user management links
    await expect(reporterPage.getByRole('link', { name: 'Users' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Shifts' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Ban List' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Audit Log' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Hub Settings' })).not.toBeVisible()

    // Reporter should NOT see call-related links
    await expect(reporterPage.getByRole('link', { name: 'Notes' })).not.toBeVisible()
    await expect(reporterPage.getByRole('link', { name: 'Call History' })).not.toBeVisible()
  })

  test('admin sees all navigation items', async ({ adminPage }) => {
    await expect(adminPage.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Notes' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Shifts' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Ban List' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Call History' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Audit Log' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Hub Settings' })).toBeVisible()
  })
})

// --- Role Assignment UI ---

test.describe('Role Assignment UI', () => {
  test.describe.configure({ mode: 'serial' })

  test('role selector dropdown in user list shows all default roles', async ({ adminPage }) => {
    // Navigate to users and find a user row with a role selector
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()

    // Find the role selector trigger (the Select with aria-label "Change role")
    const roleSelector = adminPage.getByRole('combobox', { name: /change role/i }).first()
    await expect(roleSelector).toBeVisible()
    await roleSelector.click()

    // All 5 default roles should be visible in the dropdown
    await expect(adminPage.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reporter' })).toBeVisible()

    // Close the dropdown by pressing Escape
    await adminPage.keyboard.press('Escape')
  })

  test('Add User form shows all available roles', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.getByRole('button', { name: /add user/i }).click()

    // Click the role dropdown
    const roleDropdown = adminPage.locator('#vol-role')
    await roleDropdown.click()

    // All default roles should be present
    await expect(adminPage.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reporter' })).toBeVisible()

    await adminPage.keyboard.press('Escape')
    await adminPage.getByRole('button', { name: /cancel/i }).click()
  })

  test('Invite form shows all available roles', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await adminPage.getByRole('button', { name: /invite user/i }).click()

    // Click the role dropdown
    const roleDropdown = adminPage.locator('#invite-role')
    await roleDropdown.click()

    // All default roles should be present
    await expect(adminPage.getByRole('option', { name: 'Super Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Hub Admin' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reviewer', exact: true })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Volunteer' })).toBeVisible()
    await expect(adminPage.getByRole('option', { name: 'Reporter' })).toBeVisible()

    await adminPage.keyboard.press('Escape')
    await adminPage.getByRole('button', { name: /cancel/i }).click()
  })
})

// --- Role Editor: Permission Metadata Rendering ---

test.describe('Role Editor — Permission Metadata UI', () => {
  test.describe.configure({ mode: 'serial' })

  test('Hub Roles section renders at /admin/hub-roles', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/hub-roles')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'hub-roles'
    )
    // Role list container should render
    await expect(adminPage.getByTestId('admin-hub-roles-list')).toBeVisible({ timeout: 15000 })
  })

  test('role list includes Case Manager and Voicemail Reviewer roles', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/hub-roles')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'hub-roles'
    )

    const firstRoleRow = adminPage.getByTestId('admin-hub-roles-row-role-case-manager')

    // Default roles should be listed — use data-testid for reliable selection,
    // then verify decrypted names appear (hub key decryption may take time)
    await expect(firstRoleRow).toBeVisible({
      timeout: 30000,
    })
    await expect(adminPage.getByTestId('admin-hub-roles-row-role-voicemail-reviewer')).toBeVisible({
      timeout: 15000,
    })
    await expect(adminPage.getByTestId('admin-hub-roles-row-role-volunteer')).toBeVisible({
      timeout: 15000,
    })
    await expect(adminPage.getByTestId('admin-hub-roles-row-role-hub-admin')).toBeVisible({
      timeout: 15000,
    })

    // Verify decrypted names render (hub key must be loaded)
    await expect(
      adminPage.getByTestId('admin-hub-roles-row-role-case-manager').getByText('Case Manager')
    ).toBeVisible({ timeout: 30000 })
    await expect(
      adminPage.getByTestId('admin-hub-roles-row-role-hub-admin').getByText('Hub Admin')
    ).toBeVisible({ timeout: 15000 })
  })

  test('Create Role button opens editor with permission domains', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/hub-roles')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'hub-roles'
    )

    const createBtn = adminPage.getByTestId('admin-hub-roles-create')
    await expect(createBtn).toBeVisible({ timeout: 15000 })
    await createBtn.click()

    // Permission group labels should render with human-friendly names, not raw domains
    // Scope to main content to avoid matching sidebar nav links (e.g. "Audit Log")
    const main = adminPage.locator('main')
    await expect(main.getByText('Contact Directory')).toBeVisible({ timeout: 15000 })
    await expect(main.getByText('User Management')).toBeVisible()
    await expect(main.getByText('Audit Log')).toBeVisible()
    await expect(main.getByText('GDPR / Privacy')).toBeVisible()

    // Domain sections should be present via data-testid
    await expect(adminPage.getByTestId('admin-hub-roles-domain-contacts')).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-domain-notes')).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-domain-calls')).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-domain-users')).toBeVisible()
  })

  test('expanding contacts domain shows scope radio buttons, tier checkboxes, and action checkboxes', async ({
    adminPage,
  }) => {
    await navigateAfterLogin(adminPage, '/admin/hub-roles')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'hub-roles'
    )

    const createBtn = adminPage.getByTestId('admin-hub-roles-create')
    await expect(createBtn).toBeVisible({ timeout: 15000 })
    await createBtn.click()

    // Expand the contacts domain
    const contactsDomain = adminPage.getByTestId('admin-hub-roles-domain-contacts')
    await contactsDomain.click()

    // Scope radio buttons should exist
    await expect(adminPage.getByTestId('admin-hub-roles-scope-contacts:read-own')).toBeVisible()
    await expect(
      adminPage.getByTestId('admin-hub-roles-scope-contacts:read-assigned')
    ).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-scope-contacts:read-all')).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-scope-contacts:update-own')).toBeVisible()
    await expect(
      adminPage.getByTestId('admin-hub-roles-scope-contacts:update-assigned')
    ).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-scope-contacts:update-all')).toBeVisible()

    // Tier checkboxes
    await expect(
      adminPage.getByTestId('admin-hub-roles-tier-contacts:envelope-summary')
    ).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-tier-contacts:envelope-full')).toBeVisible()

    // Action checkboxes
    await expect(adminPage.getByTestId('admin-hub-roles-action-contacts:create')).toBeVisible()
    await expect(
      adminPage.getByTestId('admin-hub-roles-action-contacts:update-summary')
    ).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-action-contacts:update-pii')).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-action-contacts:delete')).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-action-contacts:link')).toBeVisible()
  })

  test('cancel button closes the editor without creating a role', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/hub-roles')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'hub-roles'
    )

    const createBtn2 = adminPage.getByTestId('admin-hub-roles-create')
    await expect(createBtn2).toBeVisible({ timeout: 15000 })
    await createBtn2.click()

    // Editor should be visible
    await expect(adminPage.getByTestId('admin-hub-roles-save')).toBeVisible()

    // Click cancel
    await adminPage.getByTestId('admin-hub-roles-cancel').click()

    // Editor should be gone, create button back
    await expect(adminPage.getByTestId('admin-hub-roles-create')).toBeVisible()
    await expect(adminPage.getByTestId('admin-hub-roles-save')).not.toBeVisible()
  })
})
