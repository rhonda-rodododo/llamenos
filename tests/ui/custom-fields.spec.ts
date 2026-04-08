import { type Page, expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

/** Navigate to the Custom Note Fields admin section */
async function gotoCustomFields(page: Page) {
  await navigateAfterLogin(page, '/admin/custom-fields')
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', 'custom-fields')
  await expect(page.getByTestId('admin-custom-fields-add')).toBeVisible({ timeout: 10000 })
}

test.describe('Custom Note Fields', () => {
  test('custom fields section visible in admin settings', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/custom-fields')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'custom-fields'
    )
    await expect(adminPage.getByTestId('admin-custom-fields-add')).toBeVisible({ timeout: 10000 })
  })

  test('admin can add a text custom field', async ({ adminPage }) => {
    await gotoCustomFields(adminPage)

    const fieldName = `Severity ${Date.now()}`

    // Click Add Field
    await adminPage.getByTestId('admin-custom-fields-add').click()

    // Fill in field details — label input auto-generates the name field
    await adminPage.getByTestId('admin-custom-fields-label-input').fill(fieldName)

    // Save using the specific save button in the custom fields form
    await adminPage.getByTestId('admin-custom-fields-save').click()
    await expect(adminPage.getByTestId('admin-custom-fields-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Field should appear in the list
    await expect(adminPage.getByText(fieldName).first()).toBeVisible()
  })

  test('admin can add a select custom field with options', async ({ adminPage }) => {
    await gotoCustomFields(adminPage)

    const fieldName = `Category ${Date.now()}`

    // Click Add Field
    await adminPage.getByTestId('admin-custom-fields-add').click()

    // Fill in field details
    await adminPage.getByTestId('admin-custom-fields-label-input').fill(fieldName)

    // Change type to Select using the specific select element
    await adminPage.getByTestId('admin-custom-fields-type-select').selectOption('select')

    // Add options — each click adds a new empty text input for an option
    await adminPage.getByTestId('admin-custom-fields-add-option').click()
    await adminPage.getByRole('textbox').last().fill('Crisis')
    await adminPage.getByTestId('admin-custom-fields-add-option').click()
    await adminPage.getByRole('textbox').last().fill('Information')

    // Save
    await adminPage.getByTestId('admin-custom-fields-save').click()
    await expect(adminPage.getByTestId('admin-custom-fields-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Field should appear in the list
    await expect(adminPage.getByText(fieldName).first()).toBeVisible()
  })

  test('admin can delete a custom field', async ({ adminPage }) => {
    await gotoCustomFields(adminPage)

    const fieldName = `ToDelete ${Date.now()}`

    // First create a field to delete
    await adminPage.getByTestId('admin-custom-fields-add').click()
    await expect(adminPage.getByTestId('admin-custom-fields-label-input')).toBeVisible({
      timeout: 10000,
    })
    await adminPage.getByTestId('admin-custom-fields-label-input').fill(fieldName)
    await adminPage.getByTestId('admin-custom-fields-save').click()
    await expect(adminPage.getByTestId('admin-custom-fields-save-success')).toBeVisible({
      timeout: 5000,
    })
    await expect(adminPage.getByText(fieldName).first()).toBeVisible()

    // Delete it — accept the confirmation dialog
    adminPage.on('dialog', (dialog) => dialog.accept())
    const fieldRow = adminPage
      .getByTestId('admin-custom-fields-list')
      .locator('[data-testid^="admin-custom-fields-row-"]')
      .filter({ hasText: fieldName })
      .first()
    await fieldRow.locator('[data-testid^="admin-custom-fields-delete-"]').click()

    // Field should be removed
    await expect(adminPage.getByText(fieldName)).not.toBeVisible({ timeout: 5000 })
  })

  test('custom fields section deep link works', async ({ adminPage }) => {
    await gotoCustomFields(adminPage)

    // Custom Note Fields section should be loaded — "Add Field" button should be visible
    await expect(adminPage.getByTestId('admin-custom-fields-add')).toBeVisible()
  })
})
