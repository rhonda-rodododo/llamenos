import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Note Replies Thread', () => {
  test('note detail page renders when navigated directly', async ({ adminPage }) => {
    // Note detail page is a flat route at /notes_/$noteId (not nested under /notes layout).
    // The notes list page does NOT have clickable links to individual notes — notes are
    // displayed inline grouped by call. We verify the route exists by navigating directly.
    await navigateAfterLogin(adminPage, '/notes/test-note-id')
    // Should show either loading, not-found, or forbidden — confirming the route renders
    await expect(
      adminPage
        .getByTestId('note-detail-loading')
        .or(adminPage.getByTestId('note-detail-not-found'))
        .or(adminPage.getByTestId('note-detail-forbidden'))
    ).toBeVisible({ timeout: 10000 })
  })

  test('note detail page structure is correct', async ({ adminPage }) => {
    // Verify the note detail component structure by checking testids exist
    // in the DOM (even if the note is not found, the layout renders)
    await navigateAfterLogin(adminPage, '/notes/test-note-id')
    await expect(
      adminPage
        .getByTestId('note-detail-loading')
        .or(adminPage.getByTestId('note-detail-not-found'))
        .or(adminPage.getByTestId('note-detail-forbidden'))
    ).toBeVisible({ timeout: 10000 })

    // The back button is part of the layout and should be present once loaded
    await adminPage.waitForTimeout(2000)
    await expect(adminPage.getByTestId('note-detail-back')).toBeVisible()
  })

  test('note detail back button navigates to notes list', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/notes/test-note-id')
    await expect(
      adminPage
        .getByTestId('note-detail-loading')
        .or(adminPage.getByTestId('note-detail-not-found'))
        .or(adminPage.getByTestId('note-detail-forbidden'))
    ).toBeVisible({ timeout: 10000 })

    await adminPage.waitForTimeout(2000)
    await adminPage.getByTestId('note-detail-back').click()
    await adminPage.waitForURL(/\/notes/, { timeout: 10000 })
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible()
  })
})
