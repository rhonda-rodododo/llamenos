import { expect, test } from '../fixtures/auth'

test.describe('Note Replies Thread', () => {
  test('note detail page renders with content', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Call Notes' }).click()
    await adminPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible({
      timeout: 15000,
    })

    await adminPage.getByTestId('note-new-btn').click()
    const callId = `reply-test-${Date.now()}`
    await adminPage.locator('#call-id').fill(callId)
    await adminPage.locator('textarea').fill('Note for reply thread test')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })

    await expect(
      adminPage.locator('p').filter({ hasText: 'Note for reply thread test' })
    ).toBeVisible({ timeout: 30000 })

    const noteCard = adminPage
      .locator('p')
      .filter({ hasText: 'Note for reply thread test' })
      .first()
    await noteCard.click()

    await adminPage.waitForURL(/\/notes\//, { timeout: 10000 })
    await expect(adminPage.getByTestId('note-detail-page')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByTestId('note-detail-content')).toContainText(
      'Note for reply thread test'
    )
  })

  test('note detail shows call context when linked to a call', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Call Notes' }).click()
    await adminPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible({
      timeout: 15000,
    })

    await adminPage.getByTestId('note-new-btn').click()
    const callId = `call-context-${Date.now()}`
    await adminPage.locator('#call-id').fill(callId)
    await adminPage.locator('textarea').fill('Note with call context')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })

    await expect(adminPage.locator('p').filter({ hasText: 'Note with call context' })).toBeVisible({
      timeout: 30000,
    })

    const noteCard = adminPage.locator('p').filter({ hasText: 'Note with call context' }).first()
    await noteCard.click()

    await adminPage.waitForURL(/\/notes\//, { timeout: 10000 })
    await expect(adminPage.getByTestId('note-detail-page')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByTestId('note-detail-call-context')).toBeVisible()
    await expect(adminPage.getByTestId('note-detail-view-call')).toBeVisible()
  })

  test('note detail back button returns to notes list', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Call Notes' }).click()
    await adminPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible({
      timeout: 15000,
    })

    await adminPage.getByTestId('note-new-btn').click()
    await adminPage.locator('#call-id').fill(`back-test-${Date.now()}`)
    await adminPage.locator('textarea').fill('Note for back button test')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await expect(adminPage.locator('#call-id')).not.toBeVisible({ timeout: 15000 })

    await expect(
      adminPage.locator('p').filter({ hasText: 'Note for back button test' })
    ).toBeVisible({ timeout: 30000 })

    const noteCard = adminPage.locator('p').filter({ hasText: 'Note for back button test' }).first()
    await noteCard.click()

    await adminPage.waitForURL(/\/notes\//, { timeout: 10000 })
    await expect(adminPage.getByTestId('note-detail-page')).toBeVisible()

    await adminPage.getByTestId('note-detail-back').click()
    await adminPage.waitForURL(/\/notes/, { timeout: 10000 })
    await expect(adminPage.getByRole('heading', { name: /call notes/i })).toBeVisible()
  })
})
