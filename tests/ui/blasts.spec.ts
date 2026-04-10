import { expect, test } from '../fixtures/auth'
import { Timeouts, navigateAfterLogin } from '../helpers'

test.describe('Blasts — UI', () => {
  // Under parallel execution (3 workers), concurrent browser sessions with PBKDF2
  // key derivation create significant CPU load. Allow 180s per test.
  test.setTimeout(180_000)

  test.describe('Volunteer access restrictions', () => {
    test('user cannot access the blasts page (redirected or denied)', async ({ volunteerPage }) => {
      // Try to navigate to the blasts page
      await navigateAfterLogin(volunteerPage, '/blasts')
      await volunteerPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

      // User should NOT see the Message Blasts heading — they should be
      // redirected away or shown an access denied state
      const blastsHeading = volunteerPage.getByRole('heading', { name: 'Message Blasts' })
      const isVisible = await blastsHeading.isVisible().catch(() => false)
      expect(isVisible).toBe(false)

      // Confirm the URL changed away from /blasts (redirected) OR an error/forbidden is shown
      const currentUrl = volunteerPage.url()
      const onBlastsPage = currentUrl.includes('/blasts')
      if (onBlastsPage) {
        // If still on blasts page, there should be a forbidden/access denied indicator
        const forbiddenIndicator = volunteerPage.getByText(
          /forbidden|access denied|not authorized|permission/i
        )
        await expect(forbiddenIndicator).toBeVisible({ timeout: Timeouts.ELEMENT })
      }
      // If redirected away, that's the expected behavior — test passes
    })

    test('user cannot access blasts API endpoint', async ({ volunteerPage }) => {
      // Inject authed fetch helper that uses keyManager for auth headers
      await volunteerPage.evaluate(() => {
        ;(window as Record<string, unknown>).__authedFetch = async (
          url: string,
          options: RequestInit = {}
        ) => {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...((options.headers as Record<string, string>) || {}),
          }
          const token =
            window.__TEST_AUTH_FACADE?.getAccessToken() ?? sessionStorage.getItem('__TEST_JWT')
          if (token) {
            headers.Authorization = `Bearer ${token}`
          }
          return fetch(url, { ...options, headers })
        }
      })

      const result = await volunteerPage.evaluate(async () => {
        const res = await (
          (window as Record<string, unknown>).__authedFetch as (url: string) => Promise<Response>
        )('/api/blasts')
        return { status: res.status, ok: res.ok }
      })

      // Should get 400 (hub context required) or 403 (permission denied)
      expect(result.ok).toBe(false)
      expect([400, 403]).toContain(result.status)
    })
  })

  test.describe('Admin blast management', () => {
    test('blast composer validates empty name field', async ({ adminPage }) => {
      await navigateAfterLogin(adminPage, '/blasts')
      await expect(adminPage.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })

      // Open the blast composer
      await adminPage.getByRole('button', { name: /new blast/i }).click()
      await expect(adminPage.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })

      // Leave name empty but fill text
      await adminPage.getByTestId('blast-text').fill('Some blast content')

      // The save button should be disabled when name is empty
      const saveButton = adminPage.getByRole('button', { name: /save|create/i })
      await expect(saveButton).toBeDisabled()
    })

    test('blast composer validates empty content field', async ({ adminPage }) => {
      await navigateAfterLogin(adminPage, '/blasts')
      await expect(adminPage.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })

      // Open the blast composer
      await adminPage.getByRole('button', { name: /new blast/i }).click()
      await expect(adminPage.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })

      // Fill name but leave text empty
      await adminPage.getByTestId('blast-name').fill('Validation Test Blast')

      // Save button should be disabled when text is empty
      const saveButton = adminPage.getByRole('button', { name: /save|create/i })
      await expect(saveButton).toBeDisabled()
    })

    test('blast composer save button enables only when both fields are filled', async ({
      adminPage,
    }) => {
      await navigateAfterLogin(adminPage, '/blasts')
      await expect(adminPage.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })

      await adminPage.getByRole('button', { name: /new blast/i }).click()
      await expect(adminPage.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })

      const saveButton = adminPage.getByRole('button', { name: /save|create/i })

      // Both empty — disabled
      await expect(saveButton).toBeDisabled()

      // Only name — still disabled
      await adminPage.getByTestId('blast-name').fill('Test')
      await expect(saveButton).toBeDisabled()

      // Clear name, fill text — still disabled
      await adminPage.getByTestId('blast-name').fill('')
      await adminPage.getByTestId('blast-text').fill('Content')
      await expect(saveButton).toBeDisabled()

      // Both filled — enabled
      await adminPage.getByTestId('blast-name').fill('Test')
      await expect(saveButton).toBeEnabled()
    })

    test('blast can be deleted after creation', async ({ adminPage }) => {
      await navigateAfterLogin(adminPage, '/blasts')
      await expect(adminPage.getByRole('heading', { name: 'Message Blasts' })).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })

      // Create a blast first
      const blastName = `Delete Test ${Date.now()}`
      await adminPage.getByRole('button', { name: /new blast/i }).click()
      await expect(adminPage.getByTestId('blast-name')).toBeVisible({ timeout: Timeouts.ELEMENT })
      await adminPage.getByTestId('blast-name').fill(blastName)
      await adminPage.getByTestId('blast-text').fill('This blast will be deleted')
      // Save/create the blast and wait for the API response
      await Promise.all([
        adminPage.waitForResponse(
          (res) =>
            res.url().includes('/blasts') && res.request().method() === 'POST' && res.status() < 400
        ),
        adminPage.getByRole('button', { name: /save|create/i }).click(),
      ])

      // Blast should appear in the list (may also appear in detail panel if auto-selected)
      await expect(adminPage.getByText(blastName).first()).toBeVisible({ timeout: Timeouts.API })

      // Click on the blast in the list to select it and see its details
      await adminPage.getByText(blastName).first().click()

      // Wait for the detail panel to fully render before clicking delete
      const deleteButton = adminPage.getByRole('button', { name: 'Delete', exact: true })
      await expect(deleteButton).toBeVisible({ timeout: Timeouts.ELEMENT })
      await expect(deleteButton).toBeEnabled()
      await deleteButton.click()

      // The blast should be removed from the list
      await expect(adminPage.getByText(blastName).first()).not.toBeVisible({
        timeout: Timeouts.API,
      })
    })
  })
})
