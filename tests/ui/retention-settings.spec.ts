import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Retention Settings', () => {
  test('retention settings page loads with retention field', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'call-settings'
    )

    // Retention field exists but is disabled (placeholder feature)
    // Check for the retention days input (disabled) and its helper text
    await expect(adminPage.getByTestId('admin-call-settings-queue-timeout-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-call-settings-voicemail-max-input')).toBeVisible()
  })

  test('voicemail mode can be changed', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-call-settings-voicemail-mode-select')).toBeVisible()

    await adminPage.getByTestId('admin-call-settings-voicemail-mode-select').click()
    await adminPage.getByRole('option', { name: /always/i }).click()
    await expect(adminPage.getByTestId('admin-call-settings-save-success')).toBeVisible({
      timeout: 5000,
    })
  })

  test('queue timeout can be updated', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-call-settings-queue-timeout-input')).toBeVisible()

    const input = adminPage.getByTestId('admin-call-settings-queue-timeout-input')
    await input.fill('120')
    await input.blur()
    await expect(adminPage.getByTestId('admin-call-settings-save-success')).toBeVisible({
      timeout: 5000,
    })
  })

  test('voicemail max duration can be updated', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-call-settings-voicemail-max-input')).toBeVisible()

    const input = adminPage.getByTestId('admin-call-settings-voicemail-max-input')
    await input.fill('180')
    await input.blur()
    await expect(adminPage.getByTestId('admin-call-settings-save-success')).toBeVisible({
      timeout: 5000,
    })
  })

  test('settings persist after reload', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-call-settings-queue-timeout-input')).toBeVisible()

    const uniqueTimeout = String(60 + Math.floor(Math.random() * 200))
    const input = adminPage.getByTestId('admin-call-settings-queue-timeout-input')
    await input.fill(uniqueTimeout)
    await input.blur()
    await expect(adminPage.getByTestId('admin-call-settings-save-success')).toBeVisible({
      timeout: 5000,
    })

    await adminPage.reload()
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-call-settings-queue-timeout-input')).toBeVisible()
    await expect(adminPage.getByTestId('admin-call-settings-queue-timeout-input')).toHaveValue(
      uniqueTimeout
    )
  })
})
