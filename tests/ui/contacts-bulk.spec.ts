import * as path from 'node:path'
import { expect, test } from '../fixtures/auth'
import { Timeouts, navigateAfterLogin } from '../helpers'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

test.describe('Contacts Bulk Import / Merge', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/contacts')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
  })

  test('open import dialog', async ({ adminPage }) => {
    await adminPage.getByTestId('import-contacts-btn').click()
    await expect(adminPage.getByTestId('import-file-dropzone')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })
    await expect(adminPage.getByTestId('import-file-input')).toBeAttached()

    await adminPage.getByTestId('import-cancel-btn').click()
    await expect(adminPage.getByTestId('import-file-dropzone')).not.toBeVisible()
  })

  test('upload CSV and verify preview', async ({ adminPage }) => {
    await adminPage.getByTestId('import-contacts-btn').click()

    const fileInput = adminPage.getByTestId('import-file-input')
    const csvPath = path.resolve(import.meta.dirname, '../fixtures/contacts-import.csv')
    await fileInput.setInputFiles(csvPath)

    await expect(adminPage.getByTestId('import-preview-row')).toHaveCount(3, {
      timeout: Timeouts.API,
    })
    await expect(adminPage.getByTestId('import-confirm-btn')).toBeVisible()
    await expect(adminPage.getByTestId('import-cancel-preview-btn')).toBeVisible()

    await adminPage.getByTestId('import-cancel-preview-btn').click()
  })

  test('upload JSON and verify preview', async ({ adminPage }) => {
    await adminPage.getByTestId('import-contacts-btn').click()

    const fileInput = adminPage.getByTestId('import-file-input')
    const jsonPath = path.resolve(import.meta.dirname, '../fixtures/contacts-import.json')
    await fileInput.setInputFiles(jsonPath)

    await expect(adminPage.getByTestId('import-preview-row')).toHaveCount(2, {
      timeout: Timeouts.API,
    })

    await adminPage.getByTestId('import-cancel-preview-btn').click()
  })

  test('submit CSV import and see success', async ({ adminPage }) => {
    await adminPage.getByTestId('import-contacts-btn').click()

    const fileInput = adminPage.getByTestId('import-file-input')
    const csvPath = path.resolve(import.meta.dirname, '../fixtures/contacts-import.csv')
    await fileInput.setInputFiles(csvPath)

    await expect(adminPage.getByTestId('import-preview-row')).toHaveCount(3, {
      timeout: Timeouts.API,
    })

    await adminPage.getByTestId('import-confirm-btn').click()

    await expect(adminPage.getByTestId('import-progress')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    await expect(adminPage.getByTestId('import-result')).toBeVisible({
      timeout: 60000,
    })

    await adminPage.getByTestId('import-done-btn').click()
    await expect(adminPage.getByTestId('import-file-dropzone')).not.toBeVisible()
  })

  test('bulk select contacts and delete with confirmation', async ({ adminPage, request }) => {
    const authedApi = createAdminApiFromStorageState(request)

    await navigateAfterLogin(adminPage, '/contacts')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    const rows = adminPage.getByTestId('contact-row')
    const count = await rows.count()
    if (count < 2) {
      test.skip(true, 'Need at least 2 contacts for bulk delete test')
      return
    }

    const checkboxes = adminPage.getByTestId('contact-row-checkbox')
    await checkboxes.nth(0).click()
    await checkboxes.nth(1).click()

    await expect(adminPage.getByTestId('bulk-toolbar')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    const selectedCount = adminPage.getByTestId('bulk-selected-count')
    await expect(selectedCount).toContainText('2')

    await adminPage.getByTestId('bulk-delete-btn').click()

    await adminPage.getByTestId('bulk-delete-confirm').click()

    await expect(adminPage.getByTestId('bulk-toolbar')).not.toBeVisible({
      timeout: Timeouts.API,
    })
  })

  test('merge two contacts', async ({ adminPage }) => {
    const nameA = `Merge A ${Date.now()}`
    const nameB = `Merge B ${Date.now()}`

    // Create contact A via UI
    await adminPage.getByTestId('new-contact-btn').click()
    await adminPage.locator('#displayName').fill(nameA)
    await adminPage.locator('#riskLevel').click()
    const lowOption = adminPage.getByRole('option', { name: /low/i })
    await expect(lowOption).toBeVisible({ timeout: Timeouts.ELEMENT })
    await lowOption.click()
    await adminPage.getByRole('button', { name: /create contact/i }).click()
    await expect(adminPage.getByTestId('create-contact-dialog')).not.toBeVisible({
      timeout: Timeouts.API,
    })

    // Create contact B via UI
    await adminPage.getByTestId('new-contact-btn').click()
    await adminPage.locator('#displayName').fill(nameB)
    await adminPage.locator('#riskLevel').click()
    const mediumOption = adminPage.getByRole('option', { name: /medium/i })
    await expect(mediumOption).toBeVisible({ timeout: Timeouts.ELEMENT })
    await mediumOption.click()
    await adminPage.getByRole('button', { name: /create contact/i }).click()
    await expect(adminPage.getByTestId('create-contact-dialog')).not.toBeVisible({
      timeout: Timeouts.API,
    })

    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    // Click into contact B
    const rowB = adminPage.getByTestId('contact-row').filter({ hasText: nameB }).first()
    await expect(rowB).toBeVisible({ timeout: Timeouts.API })
    await rowB.click()

    await adminPage.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    await expect(adminPage.getByTestId('contact-merge-btn')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })
    await adminPage.getByTestId('contact-merge-btn').click()

    await expect(adminPage.getByTestId('merge-confirm-btn')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    const selectTrigger = adminPage.getByTestId('merge-contact-select')
    await selectTrigger.click()

    const option = adminPage.getByRole('option').filter({ hasText: nameA }).first()
    await expect(option).toBeVisible({ timeout: Timeouts.ELEMENT })
    await option.click()

    await adminPage.getByTestId('merge-confirm-btn').click()

    await expect(adminPage).toHaveURL(/\/contacts\/[^/]+$/, {
      timeout: Timeouts.NAVIGATION,
    })

    // Verify contact B no longer appears in the list
    await navigateAfterLogin(adminPage, '/contacts')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
    await expect(adminPage.getByTestId('contact-row').filter({ hasText: nameB })).not.toBeVisible()
  })
})
