import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Audit log', () => {
  test('page loads with heading and layout', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Audit Log' }).click()
    await expect(adminPage.getByTestId('audit-log-heading')).toBeVisible()
  })

  test('shows entries after hub-scoped admin actions', async ({ adminPage }) => {
    // Create a ban (hub-scoped action that generates audit entries for default-hub)
    await adminPage.getByRole('link', { name: 'Ban List' }).click()
    await expect(adminPage.getByRole('heading', { name: /ban list/i })).toBeVisible()
    await adminPage.getByRole('button', { name: /ban number/i }).click()
    await adminPage.getByLabel('Phone Number').fill('+15551234567')
    await adminPage.getByLabel('Phone Number').blur()
    await adminPage.getByLabel('Reason').fill('Audit test')
    await adminPage.getByRole('button', { name: /save/i }).click()
    await adminPage.waitForTimeout(1000)

    // Navigate to audit log — should now have entries
    await adminPage.getByRole('link', { name: 'Audit Log' }).click()
    await expect(adminPage.getByTestId('audit-log-heading')).toBeVisible()

    // Wait for entries to appear (ban action should create an audit entry)
    await expect(adminPage.getByText(/banned/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('filter bar is visible with all controls', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Audit Log' }).click()
    await expect(adminPage.getByTestId('audit-log-heading')).toBeVisible()

    // Filter controls should be present
    await expect(adminPage.getByPlaceholder(/search/i)).toBeVisible()
    // Event type dropdown
    await expect(adminPage.getByText(/all events/i).first()).toBeVisible()
  })

  test('volunteer sees access denied on audit page', async ({ volunteerPage }) => {
    // Try to access audit log as a volunteer
    await navigateAfterLogin(volunteerPage, '/audit')
    // User should either be redirected or see access denied / empty state
    const heading = volunteerPage.getByTestId('audit-log-heading')
    const isVisible = await heading.isVisible({ timeout: 3000 }).catch(() => false)
    // Whether redirected or shown the page, the user should not see real audit entries
    if (isVisible) {
      // If shown the page, entries should be empty or access denied
      await expect(
        volunteerPage.getByText(/no audit log entries|access denied|forbidden/i)
      ).toBeVisible({
        timeout: 5000,
      })
    }
    // If not visible (redirected), that's also correct behavior
  })

  test('search filter input works', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Audit Log' }).click()
    await expect(adminPage.getByTestId('audit-log-heading')).toBeVisible()

    // Type in search box
    const searchBox = adminPage.getByPlaceholder(/search/i)
    await searchBox.fill('nonexistent-event-xyz')
    await adminPage.waitForTimeout(500)

    // Should show "no entries" state since search won't match
    await expect(adminPage.getByText(/no audit log entries/i)).toBeVisible({ timeout: 5000 })
  })

  test('audit log API returns array', async ({ adminPage, request }) => {
    // Verify the audit log API returns the expected shape
    const res = await request.get('/api/audit')
    // Super admin can access global audit (may return entries or empty)
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('entries')
      expect(Array.isArray(body.entries)).toBe(true)
    } else {
      // 400 = hub context required (non-super-admin), 401 = not authenticated
      expect([400, 401]).toContain(res.status())
    }
  })
})
