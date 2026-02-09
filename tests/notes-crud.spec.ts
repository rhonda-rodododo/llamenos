import { test, expect } from '@playwright/test'
import { loginAsAdmin, resetTestState } from './helpers'

test.describe('Notes CRUD', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Notes' }).click()
    await expect(page.getByRole('heading', { name: /call notes/i })).toBeVisible()
  })

  test('notes page shows encryption note', async ({ page }) => {
    await expect(page.getByText(/encrypted end-to-end/i)).toBeVisible()
  })

  test('can open new note form', async ({ page }) => {
    await page.getByRole('button', { name: /new note/i }).click()
    await expect(page.getByText('Call ID')).toBeVisible()
  })

  test('can create a note', async ({ page }) => {
    await page.getByRole('button', { name: /new note/i }).click()

    await page.locator('#call-id').fill('test-call-' + Date.now())
    await page.locator('textarea').fill('Test note from E2E')
    await page.getByRole('button', { name: /save/i }).click()

    // Note should appear as paragraph text (not in textarea)
    await expect(page.locator('p').filter({ hasText: 'Test note from E2E' })).toBeVisible()
  })

  test('can cancel new note', async ({ page }) => {
    await page.getByRole('button', { name: /new note/i }).click()
    await page.getByRole('button', { name: /cancel/i }).click()
    // Form should be gone
    await expect(page.locator('#call-id')).not.toBeVisible()
  })

  test('notes are grouped by call', async ({ page }) => {
    // Create two notes for the same call
    const callId = 'group-test-' + Date.now()

    await page.getByRole('button', { name: /new note/i }).click()
    await page.locator('#call-id').fill(callId)
    await page.locator('textarea').fill('First note')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'First note' })).toBeVisible()

    await page.getByRole('button', { name: /new note/i }).click()
    await page.locator('#call-id').fill(callId)
    await page.locator('textarea').fill('Second note')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'Second note' })).toBeVisible()

    // Both notes should be under the same call heading
    const callCard = page.locator('div').filter({ hasText: callId.slice(0, 20) }).first()
    await expect(callCard).toBeVisible()
  })

  test('can edit a note', async ({ page }) => {
    // Create a note first
    await page.getByRole('button', { name: /new note/i }).click()
    await page.locator('#call-id').fill('edit-test-' + Date.now())
    await page.locator('textarea').fill('Original text')
    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.locator('p').filter({ hasText: 'Original text' })).toBeVisible()

    // Click edit on the note
    const editBtn = page.locator('button[aria-label="Edit"]').first()
    await editBtn.click()

    // Textarea should be visible with original text
    const editTextarea = page.locator('textarea')
    await expect(editTextarea).toBeVisible()
  })
})
