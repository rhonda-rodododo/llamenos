/**
 * Tier 6 device fingerprint verification — UI E2E.
 *
 * Exercises the admin devices section and SAS emoji verification modal.
 *
 * Covers:
 *   1. Devices section renders in admin settings.
 *   2. Unverified device shows verify button for admins.
 *   3. SAS emoji modal opens, displays 7 emoji, and has a picker grid.
 *   4. Picking correct 7 emoji enables the confirm button.
 *   5. Picking a wrong emoji shows mismatch warning.
 *   6. Reset button clears the picked state.
 */

import { expect, test } from '../fixtures/auth'

test.describe('Device fingerprint verification UI', () => {
  test('devices section renders in admin nav', async ({ adminPage }) => {
    // Navigate to admin settings → devices
    await adminPage.getByTestId('admin-sidebar-item-devices').click()
    await expect(adminPage.getByTestId('devices-section')).toBeVisible({ timeout: 10000 })
  })

  test('verify button opens fingerprint modal for unverified device', async ({ adminPage }) => {
    await adminPage.getByTestId('admin-sidebar-item-devices').click()
    await expect(adminPage.getByTestId('devices-section')).toBeVisible({ timeout: 10000 })

    // If there are unverified devices, a verify button should exist
    const verifyButtons = adminPage.locator('[data-testid^="verify-device-"]')
    const count = await verifyButtons.count()
    if (count === 0) {
      // No unverified devices in test environment — skip interaction tests
      test.skip()
      return
    }

    // Click the first verify button
    await verifyButtons.first().click()

    // Modal should open
    await expect(adminPage.getByTestId('verify-fingerprint-modal')).toBeVisible({ timeout: 5000 })

    // Should display 7 SAS emoji
    for (let i = 0; i < 7; i++) {
      await expect(adminPage.getByTestId(`sas-emoji-${i}`)).toBeVisible()
    }

    // Picker grid should be visible
    await expect(adminPage.getByTestId('sas-picker')).toBeVisible()

    // Confirm button should be disabled (nothing picked yet)
    await expect(adminPage.getByTestId('sas-verify-confirm')).toBeDisabled()
  })

  test('picking correct 7 emoji enables confirm', async ({ adminPage }) => {
    await adminPage.getByTestId('admin-sidebar-item-devices').click()
    await expect(adminPage.getByTestId('devices-section')).toBeVisible({ timeout: 10000 })

    const verifyButtons = adminPage.locator('[data-testid^="verify-device-"]')
    const count = await verifyButtons.count()
    if (count === 0) {
      test.skip()
      return
    }

    await verifyButtons.first().click()
    await expect(adminPage.getByTestId('verify-fingerprint-modal')).toBeVisible({ timeout: 5000 })

    // Read the 7 displayed SAS emoji, then find and click the matching
    // picker buttons by emoji content (testids are now neutral sas-picker-N).
    for (let i = 0; i < 7; i++) {
      const emojiText = await adminPage.getByTestId(`sas-emoji-${i}`).textContent()
      // Find the picker button whose text matches the expected emoji
      const pickerButtons = adminPage.getByTestId('sas-picker').locator('button')
      const buttonCount = await pickerButtons.count()
      for (let b = 0; b < buttonCount; b++) {
        const btn = pickerButtons.nth(b)
        if ((await btn.textContent()) === emojiText && (await btn.isEnabled())) {
          await btn.click()
          break
        }
      }
    }

    // No mismatch warning
    await expect(adminPage.getByTestId('sas-mismatch-warning')).not.toBeVisible()

    // Confirm button should now be enabled
    await expect(adminPage.getByTestId('sas-verify-confirm')).toBeEnabled()
  })

  test('picking wrong emoji shows mismatch warning', async ({ adminPage }) => {
    await adminPage.getByTestId('admin-sidebar-item-devices').click()
    await expect(adminPage.getByTestId('devices-section')).toBeVisible({ timeout: 10000 })

    const verifyButtons = adminPage.locator('[data-testid^="verify-device-"]')
    const count = await verifyButtons.count()
    if (count === 0) {
      test.skip()
      return
    }

    await verifyButtons.first().click()
    await expect(adminPage.getByTestId('verify-fingerprint-modal')).toBeVisible({ timeout: 5000 })

    // Read the first expected emoji, then click a different one
    const firstExpected = await adminPage.getByTestId('sas-emoji-0').textContent()
    const pickerButtons = adminPage.getByTestId('sas-picker').locator('button')
    const buttonCount = await pickerButtons.count()
    for (let b = 0; b < buttonCount; b++) {
      const btn = pickerButtons.nth(b)
      if ((await btn.textContent()) !== firstExpected && (await btn.isEnabled())) {
        await btn.click()
        break
      }
    }

    // Mismatch warning should appear
    await expect(adminPage.getByTestId('sas-mismatch-warning')).toBeVisible()

    // Confirm should stay disabled
    await expect(adminPage.getByTestId('sas-verify-confirm')).toBeDisabled()
  })

  test('reset button clears picked state', async ({ adminPage }) => {
    await adminPage.getByTestId('admin-sidebar-item-devices').click()
    await expect(adminPage.getByTestId('devices-section')).toBeVisible({ timeout: 10000 })

    const verifyButtons = adminPage.locator('[data-testid^="verify-device-"]')
    const count = await verifyButtons.count()
    if (count === 0) {
      test.skip()
      return
    }

    await verifyButtons.first().click()
    await expect(adminPage.getByTestId('verify-fingerprint-modal')).toBeVisible({ timeout: 5000 })

    // Pick a wrong emoji to trigger mismatch
    const firstExpected = await adminPage.getByTestId('sas-emoji-0').textContent()
    const pickerButtons = adminPage.getByTestId('sas-picker').locator('button')
    const buttonCount = await pickerButtons.count()
    for (let b = 0; b < buttonCount; b++) {
      const btn = pickerButtons.nth(b)
      if ((await btn.textContent()) !== firstExpected && (await btn.isEnabled())) {
        await btn.click()
        break
      }
    }
    await expect(adminPage.getByTestId('sas-mismatch-warning')).toBeVisible()

    // Reset
    await adminPage.getByTestId('sas-reset').click()

    // Mismatch should clear
    await expect(adminPage.getByTestId('sas-mismatch-warning')).not.toBeVisible()

    // Confirm should be disabled again
    await expect(adminPage.getByTestId('sas-verify-confirm')).toBeDisabled()

    // Picker buttons should be re-enabled
    await expect(adminPage.getByTestId('sas-picker').locator('button').first()).toBeEnabled()
  })
})
