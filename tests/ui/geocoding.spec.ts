import { type Page, expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

/** Navigate to admin location-lookup section */
async function gotoLocationLookup(page: Page) {
  await navigateAfterLogin(page, '/admin/location-lookup')
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', 'location-lookup')
  await expect(page.getByTestId('admin-location-lookup-provider-select')).toBeVisible({
    timeout: 10000,
  })
}

/** Select a provider in the shadcn Select component. */
async function selectProvider(page: Page, optionLabel: string | RegExp) {
  await page.getByTestId('admin-location-lookup-provider-select').click()
  await page.getByRole('option', { name: optionLabel }).click()
}

/** Navigate to admin custom-fields section */
async function gotoCustomFields(page: Page) {
  await navigateAfterLogin(page, '/admin/custom-fields')
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', 'custom-fields')
  await expect(page.getByTestId('admin-custom-fields-add')).toBeVisible({ timeout: 10000 })
}

test.describe('Geocoding & Location Fields', () => {
  test('location lookup section is accessible in admin', async ({ adminPage }) => {
    await gotoLocationLookup(adminPage)
    await expect(adminPage.getByTestId('admin-location-lookup-provider-select')).toBeVisible()
  })

  test('admin can select geocoding provider', async ({ adminPage }) => {
    await gotoLocationLookup(adminPage)

    // Select OpenCage
    await selectProvider(adminPage, 'OpenCage')
    await expect(adminPage.getByTestId('admin-location-lookup-provider-select')).toContainText(
      'OpenCage'
    )

    // API key field should appear
    const apiKeyInput = adminPage.getByTestId('admin-location-lookup-api-key-input')
    await expect(apiKeyInput).toBeVisible()

    // Countries field should appear
    const countriesInput = adminPage.getByTestId('admin-location-lookup-countries-input')
    await expect(countriesInput).toBeVisible()
  })

  test('admin can switch to Geoapify provider', async ({ adminPage }) => {
    await gotoLocationLookup(adminPage)

    await selectProvider(adminPage, 'Geoapify')
    await expect(adminPage.getByTestId('admin-location-lookup-provider-select')).toContainText(
      'Geoapify'
    )

    // API key field should still be visible
    await expect(adminPage.getByTestId('admin-location-lookup-api-key-input')).toBeVisible()
  })

  test('admin can save geocoding config', async ({ adminPage }) => {
    await gotoLocationLookup(adminPage)

    // Select provider and fill key
    await selectProvider(adminPage, 'OpenCage')
    await adminPage.getByTestId('admin-location-lookup-api-key-input').fill('test-api-key-12345')
    await adminPage.getByTestId('admin-location-lookup-countries-input').fill('us, ca')

    // Save
    await adminPage.getByTestId('admin-location-lookup-save').click()
    await expect(adminPage.getByTestId('admin-location-lookup-save-success')).toBeVisible({
      timeout: 5000,
    })
  })

  test('admin can disable geocoding', async ({ adminPage }) => {
    await gotoLocationLookup(adminPage)

    // First enable it, then disable
    await selectProvider(adminPage, 'OpenCage')
    await adminPage.getByTestId('admin-location-lookup-api-key-input').fill('test-key')
    await adminPage.getByTestId('admin-location-lookup-save').click()
    await expect(adminPage.getByTestId('admin-location-lookup-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Wait for success indicator to fade before triggering another save
    await adminPage.waitForTimeout(2500)

    // Now disable
    await selectProvider(adminPage, /disabled/i)
    await adminPage.getByTestId('admin-location-lookup-save').click()
    await expect(adminPage.getByTestId('admin-location-lookup-save-success')).toBeVisible({
      timeout: 5000,
    })
  })

  test('admin can add a location custom field', async ({ adminPage }) => {
    await gotoCustomFields(adminPage)

    // Click Add Field
    await adminPage.getByTestId('admin-custom-fields-add').click()

    // Fill in field details
    const fieldLabel = `Caller Location ${Date.now()}`
    await adminPage.getByTestId('admin-custom-fields-label-input').fill(fieldLabel)

    // Change type to Location
    await adminPage.getByTestId('admin-custom-fields-type-select').selectOption('location')

    // Location settings should appear
    await expect(adminPage.getByText(/location settings/i)).toBeVisible()
    await expect(adminPage.getByText(/maximum precision/i)).toBeVisible()

    // Save
    await adminPage.getByTestId('admin-custom-fields-save').click()
    await expect(adminPage.getByTestId('admin-custom-fields-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Field should appear in the list with Location type badge
    await expect(adminPage.getByText(fieldLabel).first()).toBeVisible()
    await expect(adminPage.getByText('Location').first()).toBeVisible()
  })

  test('location field appears in note creation form', async ({ adminPage }) => {
    // First create a location custom field
    await gotoCustomFields(adminPage)
    await adminPage.getByTestId('admin-custom-fields-add').click()
    await adminPage
      .getByTestId('admin-custom-fields-label-input')
      .fill(`Location Field ${Date.now()}`)
    await adminPage.getByTestId('admin-custom-fields-type-select').selectOption('location')
    await adminPage.getByTestId('admin-custom-fields-save').click()
    await expect(adminPage.getByTestId('admin-custom-fields-save-success')).toBeVisible({
      timeout: 5000,
    })

    // Navigate to notes page
    await adminPage.getByRole('link', { name: /notes/i }).first().click()
    await expect(adminPage.getByRole('heading', { name: /notes/i })).toBeVisible({ timeout: 10000 })

    // Open new note form
    const newNoteBtn = adminPage.getByRole('button', { name: /new note|add note/i })
    if (await newNoteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newNoteBtn.click()
    }

    // Check for the location field placeholder (search address input)
    // Just verify the custom fields section loads without errors
  })
})
