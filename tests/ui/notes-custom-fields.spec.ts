import { type Page, expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

/**
 * End-to-end: custom fields defined in admin settings → used in notes forms.
 * Tests the full lifecycle: create field → create note with field value →
 * verify badge display → edit note → verify pre-fill → update value.
 */

/** Create a text custom field via admin settings UI */
async function createCustomTextField(page: Page, label: string) {
  await navigateAfterLogin(page, '/admin/custom-fields')
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', 'custom-fields')

  const addFieldBtn = page.getByTestId('admin-custom-fields-add')
  await expect(addFieldBtn).toBeVisible({ timeout: 10000 })

  // If a field with this label already exists, skip creation
  const existing = page
    .getByTestId('admin-custom-fields-list')
    .locator('[data-testid^="admin-custom-fields-row-"]')
    .filter({ hasText: label })
  if (
    await existing
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    return
  }

  await addFieldBtn.click()
  const fieldNameInput = page.getByTestId('admin-custom-fields-label-input')
  await expect(fieldNameInput).toBeVisible({ timeout: 10000 })
  await fieldNameInput.fill(label)
  await page.getByTestId('admin-custom-fields-save').click()
  await expect(page.getByTestId('admin-custom-fields-save-success')).toBeVisible({
    timeout: 10000,
  })

  // Wait for the field to appear in the settings list before navigating away
  await expect(page.getByText(label).first()).toBeVisible({ timeout: 5000 })
}

/** Create a note with a custom field value and return the note text for identification */
async function createNoteWithCustomField(
  page: Page,
  fieldLabel: string,
  fieldValue: string,
  noteText: string
) {
  await page.getByRole('link', { name: 'Notes' }).click()
  await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()

  await page.getByRole('button', { name: /new note/i }).click()
  await expect(page.getByLabel(fieldLabel)).toBeVisible({ timeout: 30000 })

  await page.locator('#call-id').fill(`cf-test-${Date.now()}`)
  await page.locator('textarea').first().fill(noteText)
  await page.getByLabel(fieldLabel).fill(fieldValue)
  await page.getByRole('button', { name: /save/i }).click()

  // Wait for form to close (mutation succeeded), then for decrypted text to appear
  await expect(page.locator('#call-id')).not.toBeVisible({ timeout: 15000 })
  await expect(page.locator('p').filter({ hasText: noteText })).toBeVisible({ timeout: 30000 })
}

test.describe('Custom Fields in Notes', () => {
  // Serial: updateCustomFields replaces ALL fields for a hub atomically.
  // Parallel workers would overwrite each other's fields.
  test.describe.configure({ mode: 'serial' })

  test('custom fields appear in new note form', async ({ adminPage }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(adminPage, fieldLabel)

    // Navigate to notes
    await adminPage.getByRole('link', { name: 'Notes' }).click()
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible()

    // Open new note form
    await adminPage.getByRole('button', { name: /new note/i }).click()

    // Custom field label should appear in the form (may need time for hub key decryption + query refetch)
    await expect(adminPage.getByLabel(fieldLabel)).toBeVisible({ timeout: 30000 })
  })

  test('create note with custom field value shows badge', async ({ adminPage }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(adminPage, fieldLabel)

    const noteText = `Note with ${fieldLabel}`
    await createNoteWithCustomField(adminPage, fieldLabel, 'High', noteText)

    // Custom field value should appear as a badge
    await expect(adminPage.getByText(`${fieldLabel}: High`)).toBeVisible()
  })

  test('edit form shows custom fields pre-filled', async ({ adminPage }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(adminPage, fieldLabel)

    const noteText = `Prefill test ${Date.now()}`
    await createNoteWithCustomField(adminPage, fieldLabel, 'High', noteText)

    // Click edit on the note
    const noteCard = adminPage.locator('.py-4').filter({ hasText: noteText }).first()
    await noteCard.locator('button[aria-label="Edit"]').click()

    // The custom field input should be pre-filled
    const fieldInput = adminPage.getByLabel(fieldLabel)
    await expect(fieldInput).toBeVisible()
    await expect(fieldInput).toHaveValue('High', { timeout: 10000 })
  })

  test('can update custom field value via edit', async ({ adminPage }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(adminPage, fieldLabel)

    const noteText = `Update test ${Date.now()}`
    await createNoteWithCustomField(adminPage, fieldLabel, 'High', noteText)

    // Click edit on the specific note
    const noteCard = adminPage.locator('.py-4').filter({ hasText: noteText }).first()
    await noteCard.locator('button[aria-label="Edit"]').click()

    // Change the field value
    const fieldInput = adminPage.getByLabel(fieldLabel)
    await fieldInput.clear()
    await fieldInput.fill('Critical')

    // Save
    await adminPage.getByRole('button', { name: /save/i }).click()

    // Badge should show updated value on the edited note
    await expect(noteCard.getByText(`${fieldLabel}: Critical`)).toBeVisible()
    await expect(noteCard.getByText(`${fieldLabel}: High`)).not.toBeVisible()
  })

  test('edit preserves note text when changing field value', async ({ adminPage }) => {
    const fieldLabel = `Priority ${Date.now()}`
    await createCustomTextField(adminPage, fieldLabel)

    const noteText = `Preserve test ${Date.now()}`
    await createNoteWithCustomField(adminPage, fieldLabel, 'High', noteText)

    // Click edit on the specific note
    const noteCard = adminPage.locator('.py-4').filter({ hasText: noteText }).first()
    await noteCard.locator('button[aria-label="Edit"]').click()

    // Verify textarea has existing text
    const textarea = adminPage.locator('textarea').first()
    await expect(textarea).toHaveValue(noteText)

    // Change field value without changing text
    const fieldInput = adminPage.getByLabel(fieldLabel)
    await fieldInput.clear()
    await fieldInput.fill('Low')
    await adminPage.getByRole('button', { name: /save/i }).click()

    // Both text and field should be preserved on the specific note
    await expect(noteCard.getByText(noteText)).toBeVisible()
    await expect(noteCard.getByText(`${fieldLabel}: Low`)).toBeVisible()
  })
})

test.describe('Notes Call Headers', () => {
  test('note card shows call ID in header (fallback)', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Notes' }).click()
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible()

    // Create a note with a known call ID
    const callId = `header-test-${Date.now()}`
    await adminPage.getByRole('button', { name: /new note/i }).click()
    await adminPage.locator('#call-id').fill(callId)
    await adminPage.locator('textarea').first().fill('Header test note')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })
    await expect(adminPage.locator('p').filter({ hasText: 'Header test note' })).toBeVisible({
      timeout: 30000,
    })

    // Card header should show truncated call ID (fallback when call not in history)
    // The format is "Call with <first 12 chars>..."
    await expect(adminPage.getByText(`Call with ${callId.slice(0, 12)}...`)).toBeVisible()
  })

  test('notes grouped under same call share one header', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Notes' }).click()
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible()

    const callId = `group-header-${Date.now()}`

    // Create first note
    await adminPage.getByRole('button', { name: /new note/i }).click()
    await adminPage.locator('#call-id').fill(callId)
    await adminPage.locator('textarea').first().fill('First grouped note')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })
    await expect(adminPage.locator('p').filter({ hasText: 'First grouped note' })).toBeVisible({
      timeout: 30000,
    })

    // Create second note for same call
    await adminPage.getByRole('button', { name: /new note/i }).click()
    await adminPage.locator('#call-id').fill(callId)
    await adminPage.locator('textarea').first().fill('Second grouped note')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })
    await expect(adminPage.locator('p').filter({ hasText: 'Second grouped note' })).toBeVisible({
      timeout: 30000,
    })

    // Both notes should be visible under one card
    const headerText = `Call with ${callId.slice(0, 12)}...`
    const headers = adminPage.getByText(headerText)
    await expect(headers).toHaveCount(1) // Only one header for the group
  })

  test('edit saves updated text correctly', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Notes' }).click()
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible()

    // Create a note to edit
    await adminPage.getByRole('button', { name: /new note/i }).click()
    await adminPage.locator('#call-id').fill(`edit-save-${Date.now()}`)
    await adminPage.locator('textarea').first().fill('Original content')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })
    await expect(adminPage.locator('p').filter({ hasText: 'Original content' })).toBeVisible({
      timeout: 30000,
    })

    // Edit the note
    await adminPage.locator('button[aria-label="Edit"]').first().click()
    const editTextarea = adminPage.locator('textarea').first()
    await editTextarea.clear()
    await editTextarea.fill('Updated content')
    await adminPage.getByRole('button', { name: /save/i }).click()

    // Original text gone, updated text visible
    await expect(adminPage.locator('p').filter({ hasText: 'Updated content' })).toBeVisible({
      timeout: 30000,
    })
    await expect(adminPage.locator('p').filter({ hasText: 'Original content' })).not.toBeVisible()
  })
})
