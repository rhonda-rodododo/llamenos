import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Epic 24: Shift & Call Status Awareness', () => {
  test('sidebar shows shift status indicator', async ({ adminPage }) => {
    // The sidebar should show a shift status indicator (green or gray dot)
    const sidebar = adminPage.locator('nav')
    // Either "until" (on shift) or "Next shift" or "No shifts assigned"
    await expect(sidebar.getByText(/until|next shift|no shifts assigned/i)).toBeVisible()
  })

  test('dashboard shows calls today metric', async ({ adminPage }) => {
    await expect(adminPage.getByText(/calls today/i)).toBeVisible()
  })
})

test.describe('Epic 25: Command Palette Enhancements', () => {
  test('command palette opens with Ctrl+K', async ({ adminPage }) => {
    await adminPage.keyboard.press('Control+k')
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await expect(adminPage.getByPlaceholder(/type a command/i)).toBeVisible()
  })

  test('command palette shows search shortcuts when typing', async ({ adminPage }) => {
    await adminPage.keyboard.press('Control+k')
    await adminPage.getByPlaceholder(/type a command/i).fill('test query')
    // Should show search notes action
    await expect(adminPage.getByText(/search notes for/i)).toBeVisible()
    // Admin should also see search calls
    await expect(adminPage.getByText(/search calls for/i)).toBeVisible()
  })

  test('command palette has quick note action', async ({ adminPage }) => {
    await adminPage.keyboard.press('Control+k')
    await expect(adminPage.getByText(/new note/i).first()).toBeVisible()
  })

  test('command palette has keyboard shortcuts action', async ({ adminPage }) => {
    await adminPage.keyboard.press('Control+k')
    await expect(adminPage.getByText(/keyboard shortcuts/i).first()).toBeVisible()
  })
})

test.describe('Epic 26: Custom IVR Audio Recording', () => {
  test('admin voice-prompts section loads', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/voice-prompts')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'voice-prompts'
    )
    await expect(adminPage.getByTestId('admin-voice-prompts-section')).toBeVisible()
  })

  test('voice prompts section shows prompt types', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/voice-prompts')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'voice-prompts'
    )

    // Should show prompt type labels
    await expect(adminPage.getByText('Greeting').first()).toBeVisible()
    await expect(adminPage.getByText('Please Hold').first()).toBeVisible()
    await expect(adminPage.getByText('Wait Message').first()).toBeVisible()
  })

  test('admin phone-menu-languages section loads', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/phone-menu-languages')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'phone-menu-languages'
    )
  })
})

test.describe('Epic 27: Remaining Polish', () => {
  test('keyboard shortcuts dialog opens with ? key', async ({ adminPage }) => {
    await adminPage.keyboard.press('?')
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await expect(adminPage.getByText(/keyboard shortcuts/i).first()).toBeVisible()
    // Should list Ctrl+K shortcut
    await expect(adminPage.getByText(/Ctrl\+K/)).toBeVisible()
  })

  test('keyboard shortcuts dialog closes on Escape', async ({ adminPage }) => {
    await adminPage.keyboard.press('?')
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await adminPage.keyboard.press('Escape')
    await expect(adminPage.getByRole('dialog')).not.toBeVisible()
  })

  test('settings toggle shows confirmation dialog', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/spam-protection')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'spam-protection'
    )

    // Click the voice CAPTCHA switch
    const captchaSwitch = adminPage.getByTestId('admin-spam-protection-captcha-switch')
    await expect(captchaSwitch).toBeVisible()
    await captchaSwitch.click()

    // Should show confirmation dialog
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await expect(adminPage.getByText(/voice captcha/i).last()).toBeVisible()

    // Cancel should close dialog without changing
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: /cancel/i })
      .click()
    await expect(adminPage.getByRole('dialog')).not.toBeVisible()
  })

  test('settings confirmation dialog applies change on confirm', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/spam-protection')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'spam-protection'
    )

    // Toggle rate limiting
    const rlSwitch = adminPage.getByTestId('admin-spam-protection-rate-limit-switch')
    await expect(rlSwitch).toBeVisible()
    const wasChecked = await rlSwitch.isChecked()

    await rlSwitch.click()
    // Confirm
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: /confirm/i })
      .click()
    await expect(adminPage.getByRole('dialog')).not.toBeVisible()

    // Switch should have toggled
    const nowChecked = await rlSwitch.isChecked()
    expect(nowChecked).not.toBe(wasChecked)

    // Toggle back to restore state
    await rlSwitch.click()
    await expect(adminPage.getByRole('dialog')).toBeVisible()
    await adminPage
      .getByRole('dialog')
      .getByRole('button', { name: /confirm/i })
      .click()
  })

  test('toast has dismiss button', async ({ adminPage }) => {
    // Trigger a toast by saving profile
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    await adminPage.getByRole('button', { name: /update profile/i }).click()

    // Wait for toast to appear
    const toast = adminPage.locator('[role="status"]').first()
    await expect(toast).toBeVisible({ timeout: 5000 })

    // Toast should have a dismiss button
    const dismissBtn = toast.locator('button[aria-label="Dismiss"]')
    await expect(dismissBtn).toBeVisible()
    await dismissBtn.click()

    // Toast should disappear
    await expect(toast).not.toBeVisible()
  })
})
