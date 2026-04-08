import { type Page, expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

/** Navigate to admin Report Types section */
async function gotoReportTypes(page: Page) {
  await navigateAfterLogin(page, '/admin/report-types')
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', 'report-types')
  await expect(page.getByTestId('admin-report-types-add')).toBeVisible({ timeout: 10000 })
}

/** Navigate to Reports page */
async function navigateToReports(page: Page) {
  await page.getByRole('link', { name: 'Reports' }).click()
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
    timeout: 10000,
  })
}

/** Create a report type via the UI. Returns after success indicator is visible. */
async function createReportType(
  page: Page,
  name: string,
  description: string,
  setAsDefault = true
) {
  await page.getByTestId('admin-report-types-add').click()
  await page.getByTestId('admin-report-types-name-input').fill(name)
  await page.getByTestId('admin-report-types-description-input').fill(description)

  const defaultSwitch = page.getByTestId('admin-report-types-default-switch')
  await expect(defaultSwitch).toBeVisible({ timeout: 5000 })
  const isChecked = await defaultSwitch.isChecked()
  if (setAsDefault && !isChecked) {
    await defaultSwitch.click()
  } else if (!setAsDefault && isChecked) {
    await defaultSwitch.click()
  }

  await page.getByTestId('admin-report-types-save').click()
  await expect(page.getByTestId('admin-report-types-save-success')).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(name).first()).toBeVisible()
}

test.describe('Report Types System', () => {
  test('report types section is accessible in admin', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)
    await expect(adminPage.getByTestId('admin-report-types-add')).toBeVisible()
  })

  test('admin can create a report type', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)

    const typeName = `Crisis Report ${Date.now()}`
    await adminPage.getByTestId('admin-report-types-add').click()
    await adminPage.getByTestId('admin-report-types-name-input').fill(typeName)
    await adminPage
      .getByTestId('admin-report-types-description-input')
      .fill('For immediate crisis situations')
    await adminPage.getByTestId('admin-report-types-save').click()

    await expect(adminPage.getByTestId('admin-report-types-save-success')).toBeVisible({
      timeout: 5000,
    })
    await expect(adminPage.getByText(typeName).first()).toBeVisible()
  })

  test('created report type shows default badge', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)

    const typeName = `Badge Test ${Date.now()}`
    await createReportType(adminPage, typeName, 'Badge visibility test', true)

    const typeRow = adminPage
      .getByTestId('admin-report-types-list')
      .locator('[data-testid^="admin-report-types-row-"]')
      .filter({ hasText: typeName })
    await expect(typeRow).toBeVisible({ timeout: 15000 })
    await expect(typeRow.locator('[data-testid^="admin-report-types-default-badge-"]')).toBeVisible(
      { timeout: 10000 }
    )
  })

  test('admin can create a second report type without default', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)

    const suffix = Date.now()
    // Create first type (will be default)
    await createReportType(adminPage, `First Type ${suffix}`, 'First type', true)

    // Create second type without default
    const secondName = `Second Type ${suffix}`
    await createReportType(adminPage, secondName, 'For general support requests', false)

    await expect(adminPage.getByText(secondName).first()).toBeVisible()
  })

  test('admin can set a different type as default', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)

    const suffix = Date.now()
    const firstName = `Crisis ${suffix}`
    const secondName = `Support ${suffix}`

    // Create two types - first is default
    await createReportType(adminPage, firstName, 'Crisis type', true)
    await createReportType(adminPage, secondName, 'Support type', false)

    // Set second as default
    const supportRow = adminPage
      .getByTestId('admin-report-types-list')
      .locator('[data-testid^="admin-report-types-row-"]')
      .filter({ hasText: secondName })
    await expect(supportRow).toBeVisible()
    await supportRow.locator('[data-testid^="admin-report-types-set-default-"]').click()

    // Support should now have Default badge
    await expect(
      supportRow.locator('[data-testid^="admin-report-types-default-badge-"]')
    ).toBeVisible({ timeout: 5000 })

    // Crisis should no longer have Default badge
    const crisisRow = adminPage
      .getByTestId('admin-report-types-list')
      .locator('[data-testid^="admin-report-types-row-"]')
      .filter({ hasText: firstName })
    await expect(
      crisisRow.locator('[data-testid^="admin-report-types-default-badge-"]')
    ).not.toBeVisible()
  })

  test('admin can archive a report type', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)

    const suffix = Date.now()
    const defaultName = `Default ${suffix}`
    const archiveName = `ToArchive ${suffix}`

    // Create default type, then one to archive
    await createReportType(adminPage, defaultName, 'Default', true)
    await createReportType(adminPage, archiveName, 'Will be archived', false)

    // Archive the second type
    const archiveRow = adminPage
      .getByTestId('admin-report-types-list')
      .locator('[data-testid^="admin-report-types-row-"]')
      .filter({ hasText: archiveName })
    await expect(archiveRow).toBeVisible()
    adminPage.once('dialog', (dialog) => dialog.accept())
    await archiveRow.locator('[data-testid^="admin-report-types-archive-"]').click()

    // Should disappear from active list
    await expect(archiveRow).not.toBeVisible({ timeout: 5000 })
  })

  test('archived report type can be shown and unarchived', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)

    const suffix = Date.now()
    const defaultName = `Default ${suffix}`
    const archiveName = `Archived ${suffix}`

    // Create two types, archive the second
    await createReportType(adminPage, defaultName, 'Default', true)
    await createReportType(adminPage, archiveName, 'Will be archived then unarchived', false)

    const archiveRow = adminPage
      .getByTestId('admin-report-types-list')
      .locator('[data-testid^="admin-report-types-row-"]')
      .filter({ hasText: archiveName })
    adminPage.once('dialog', (dialog) => dialog.accept())
    await archiveRow.locator('[data-testid^="admin-report-types-archive-"]').click()
    await expect(archiveRow).not.toBeVisible({ timeout: 5000 })

    // Show archived section
    await adminPage.getByTestId('admin-report-types-toggle-archived').click()
    const archivedRow = adminPage
      .locator('[data-testid^="admin-report-types-row-"]')
      .filter({ hasText: archiveName })
    await expect(archivedRow).toBeVisible({ timeout: 10000 })

    // Unarchive it — scope to the specific row to avoid strict mode with parallel tests
    await archivedRow.locator('[data-testid^="admin-report-types-unarchive-"]').click()
    await expect(adminPage.getByText(archiveName).first()).toBeVisible({ timeout: 10000 })
  })

  test('report form shows report type dropdown when types exist', async ({ adminPage }) => {
    // Create a report type first
    await gotoReportTypes(adminPage)
    const typeName = `FormType ${Date.now()}`
    await createReportType(adminPage, typeName, 'For form test', true)

    await navigateToReports(adminPage)

    // Open new report form
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible({
      timeout: 10000,
    })

    // Report type dropdown should be visible (CI may need time to fetch types)
    await expect(adminPage.getByTestId('report-type-select')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByTestId('report-type-label')).toBeVisible({ timeout: 5000 })
  })

  test('default type is pre-selected in report form', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)
    const typeName = `DefaultSelect ${Date.now()}`
    await createReportType(adminPage, typeName, 'Default select test', true)

    await navigateToReports(adminPage)
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByTestId('report-type-select')).toBeVisible({ timeout: 15000 })

    // The select should show the default type (may need time to fetch + decrypt report types)
    await expect(adminPage.getByTestId('report-type-select')).toContainText(typeName, {
      timeout: 15000,
    })
  })

  test('can change report type in form', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)
    const suffix = Date.now()
    const defaultName = `Default ${suffix}`
    const otherName = `Other ${suffix}`
    await createReportType(adminPage, defaultName, 'Default', true)
    await createReportType(adminPage, otherName, 'Other option', false)

    await navigateToReports(adminPage)
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByTestId('report-type-select')).toBeVisible({ timeout: 15000 })

    // Change to the other type
    await adminPage.getByTestId('report-type-select').click()
    await expect(adminPage.getByText(otherName)).toBeVisible({ timeout: 10000 })
    await adminPage.getByText(otherName).click()
    await expect(adminPage.getByTestId('report-type-select')).toContainText(otherName, {
      timeout: 10000,
    })
  })

  test('archived type not shown in report form dropdown', async ({ adminPage }) => {
    await gotoReportTypes(adminPage)

    const suffix = Date.now()
    const keepName = `Keep ${suffix}`
    const archName = `ArchDrop ${suffix}`

    // Create two types
    await createReportType(adminPage, keepName, 'Will stay active', true)
    await createReportType(adminPage, archName, 'Will be archived', false)

    // Archive the second type
    const archRow = adminPage
      .getByTestId('admin-report-types-list')
      .locator('[data-testid^="admin-report-types-row-"]')
      .filter({ hasText: archName })
    adminPage.once('dialog', (dialog) => dialog.accept())
    await archRow.locator('[data-testid^="admin-report-types-archive-"]').click()
    await expect(archRow).not.toBeVisible({ timeout: 5000 })

    // Open report form and verify archived type is not in dropdown
    await navigateToReports(adminPage)
    await adminPage.getByRole('button', { name: /new/i }).click()
    await expect(adminPage.getByTestId('report-type-select')).toBeVisible({ timeout: 5000 })

    // Open the dropdown and verify archived type is not there
    await adminPage.getByTestId('report-type-select').click()
    await expect(adminPage.getByText(archName)).not.toBeVisible()
  })
})
