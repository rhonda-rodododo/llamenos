import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Voice E2EE admin policy setting', () => {
  test('admin persists voice E2EE policy across reload', async ({ adminPage }) => {
    // Navigate to admin call settings section
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'call-settings'
    )

    // Find the voice E2EE policy select trigger
    const policySelect = adminPage.getByTestId('admin-call-settings-voice-e2ee-policy-select')
    await expect(policySelect).toBeVisible({ timeout: 10000 })

    // Open the select and change to "required"
    await policySelect.click()
    // Radix Select items render as role="option" — this is the permitted exception
    await adminPage.getByRole('option', { name: /Required/ }).click()

    // Wait for auto-save success indicator
    await expect(adminPage.getByTestId('admin-call-settings-save-success')).toBeVisible({
      timeout: 10000,
    })

    // Reload the page — session capsule auto-restores crypto state
    await adminPage.reload({ waitUntil: 'domcontentloaded' })

    // Re-navigate to call settings after reload
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'call-settings'
    )

    // Verify the policy select still shows "required" after reload
    const reloadedSelect = adminPage.getByTestId('admin-call-settings-voice-e2ee-policy-select')
    await expect(reloadedSelect).toBeVisible({ timeout: 10000 })
    await expect(reloadedSelect).toContainText(/Required/)
  })

  test('admin can set voice E2EE policy to off', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'call-settings'
    )

    const policySelect = adminPage.getByTestId('admin-call-settings-voice-e2ee-policy-select')
    await expect(policySelect).toBeVisible({ timeout: 10000 })

    // Change to "off"
    await policySelect.click()
    await adminPage.getByRole('option', { name: /Off/ }).click()

    await expect(adminPage.getByTestId('admin-call-settings-save-success')).toBeVisible({
      timeout: 10000,
    })

    // Verify the select shows the "off" option
    await expect(policySelect).toContainText(/Off/)
  })

  test('admin can set voice E2EE policy to preferred', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/call-settings')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'call-settings'
    )

    const policySelect = adminPage.getByTestId('admin-call-settings-voice-e2ee-policy-select')
    await expect(policySelect).toBeVisible({ timeout: 10000 })

    // Change to "preferred"
    await policySelect.click()
    await adminPage.getByRole('option', { name: /Preferred/ }).click()

    await expect(adminPage.getByTestId('admin-call-settings-save-success')).toBeVisible({
      timeout: 10000,
    })

    await expect(policySelect).toContainText(/Preferred/)
  })
})
