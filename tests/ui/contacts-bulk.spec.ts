import * as path from 'node:path'
import { expect, test } from '../fixtures/auth'
import { Timeouts, navigateAfterLogin } from '../helpers'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

test.describe('Contacts Bulk Import / Merge / Export', () => {
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

  test('submit JSON import and see success', async ({ adminPage }) => {
    await adminPage.getByTestId('import-contacts-btn').click()

    const fileInput = adminPage.getByTestId('import-file-input')
    const jsonPath = path.resolve(import.meta.dirname, '../fixtures/contacts-import.json')
    await fileInput.setInputFiles(jsonPath)

    await expect(adminPage.getByTestId('import-preview-row')).toHaveCount(2, {
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

  test('reject CSV upload with error', async ({ adminPage }) => {
    await adminPage.getByTestId('import-contacts-btn').click()

    const fileInput = adminPage.getByTestId('import-file-input')
    const csvPath = path.resolve(import.meta.dirname, '../fixtures/contacts-import.csv')
    await fileInput.setInputFiles(csvPath)

    await expect(adminPage.getByTestId('import-parse-error')).toBeVisible({
      timeout: Timeouts.API,
    })

    await adminPage.getByTestId('import-cancel-btn').click()
  })

  test('bulk select contacts and delete with confirmation', async ({ adminPage }) => {
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

  test('bulk merge two contacts from list', async ({ adminPage }) => {
    const nameA = `Merge A ${Date.now()}`
    const nameB = `Merge B ${Date.now()}`

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
    await adminPage.waitForURL(/\/contacts\/[^/]+/, { timeout: Timeouts.NAVIGATION })
    await navigateAfterLogin(adminPage, '/contacts')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

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
    await adminPage.waitForURL(/\/contacts\/[^/]+/, { timeout: Timeouts.NAVIGATION })
    await navigateAfterLogin(adminPage, '/contacts')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    const checkboxes = adminPage.getByTestId('contact-row-checkbox')
    const rowA = adminPage.getByTestId('contact-row').filter({ hasText: nameA }).first()
    const rowB = adminPage.getByTestId('contact-row').filter({ hasText: nameB }).first()

    const checkboxA = rowA.locator('..').locator('[data-testid="contact-row-checkbox"]')
    const checkboxB = rowB.locator('..').locator('[data-testid="contact-row-checkbox"]')
    await checkboxA.click()
    await checkboxB.click()

    await expect(adminPage.getByTestId('bulk-toolbar')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    await expect(adminPage.getByTestId('bulk-merge-btn')).toBeEnabled()
    await adminPage.getByTestId('bulk-merge-btn').click()

    await expect(adminPage.getByTestId('merge-confirm-btn')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    await adminPage.locator(`[data-testid^="merge-option-"]`).first().click()

    await adminPage.getByTestId('merge-confirm-btn').click()

    await expect(adminPage.getByTestId('bulk-toolbar')).not.toBeVisible({
      timeout: Timeouts.API,
    })

    await expect(adminPage.getByTestId('contact-row').filter({ hasText: nameB })).not.toBeVisible()
  })

  test('bulk export selected contacts', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/contacts')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    const rows = adminPage.getByTestId('contact-row')
    const count = await rows.count()
    if (count < 1) {
      test.skip(true, 'Need at least 1 contact for export test')
      return
    }

    const checkboxes = adminPage.getByTestId('contact-row-checkbox')
    await checkboxes.nth(0).click()

    await expect(adminPage.getByTestId('bulk-toolbar')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    await adminPage.getByTestId('bulk-export-btn').click()

    await expect(adminPage.getByTestId('bulk-toolbar')).not.toBeVisible({
      timeout: Timeouts.API,
    })
  })
})
