import { expect, test } from '../fixtures/auth'
import { Timeouts, navigateAfterLogin } from '../helpers'

test.describe('Signal Contact Registration', () => {
  test.describe.configure({ mode: 'serial' })

  const signalPhone = '+15559998888'

  test.beforeEach(async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/settings')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
  })

  test('Signal contact section is present and expandable', async ({ adminPage }) => {
    const signalCard = adminPage.getByTestId('signal-contact')
    await expect(signalCard).toBeVisible({ timeout: Timeouts.ELEMENT })

    await adminPage.getByTestId('signal-contact-trigger').click()
    await adminPage.waitForTimeout(500)

    const registerBtn = adminPage.getByTestId('signal-register-button')
    const deleteBtn = adminPage.getByTestId('signal-contact-delete')
    const eitherVisible =
      (await registerBtn.isVisible().catch(() => false)) ||
      (await deleteBtn.isVisible().catch(() => false))
    expect(eitherVisible).toBe(true)
  })

  test('register a Signal phone contact', async ({ adminPage }) => {
    await adminPage.getByTestId('signal-contact-trigger').click()
    await adminPage.waitForTimeout(500)

    const deleteBtn = adminPage.getByTestId('signal-contact-delete')
    const isRegistered = await deleteBtn.isVisible().catch(() => false)
    if (isRegistered) {
      await deleteBtn.click()
      await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
    }

    await adminPage.getByTestId('signal-type-phone').click()

    const input = adminPage.getByTestId('signal-identifier-input')
    await expect(input).toBeVisible()
    await input.fill(signalPhone)

    const registerBtn = adminPage.getByTestId('signal-register-button')
    await registerBtn.click()

    // Wait for loading state to finish (registering spinner)
    await expect(registerBtn).not.toHaveAttribute('disabled', '', {
      timeout: Timeouts.API,
    })

    // Check if registration succeeded (delete button visible) or failed (register still visible)
    const hasContact = await adminPage
      .getByTestId('signal-contact-delete')
      .isVisible()
      .catch(() => false)
    if (!hasContact) {
      test.skip(true, 'Signal notifier not configured in test environment')
      return
    }

    await expect(adminPage.getByTestId('signal-contact-delete')).toBeVisible()
  })

  test('registered Signal contact shows type label', async ({ adminPage }) => {
    await adminPage.getByTestId('signal-contact-trigger').click()
    await adminPage.waitForTimeout(500)

    const deleteBtn = adminPage.getByTestId('signal-contact-delete')
    const isRegistered = await deleteBtn.isVisible().catch(() => false)
    if (!isRegistered) {
      await adminPage.getByTestId('signal-type-phone').click()
      await adminPage.getByTestId('signal-identifier-input').fill(signalPhone)
      const registerBtn = adminPage.getByTestId('signal-register-button')
      await registerBtn.click()
      // Wait for loading state to finish
      await expect(registerBtn).not.toHaveAttribute('disabled', '', {
        timeout: Timeouts.API,
      })
      const hasContact = await adminPage
        .getByTestId('signal-contact-delete')
        .isVisible()
        .catch(() => false)
      if (!hasContact) {
        test.skip(true, 'Signal notifier not configured in test environment')
        return
      }
      await expect(deleteBtn).toBeVisible()
    }

    await expect(adminPage.getByText(/phone/i).first()).toBeVisible()
  })

  test('delete Signal contact', async ({ adminPage }) => {
    await adminPage.getByTestId('signal-contact-trigger').click()
    await adminPage.waitForTimeout(500)

    const deleteBtn = adminPage.getByTestId('signal-contact-delete')
    const isRegistered = await deleteBtn.isVisible().catch(() => false)
    if (!isRegistered) {
      await adminPage.getByTestId('signal-type-phone').click()
      await adminPage.getByTestId('signal-identifier-input').fill(signalPhone)
      const registerBtn = adminPage.getByTestId('signal-register-button')
      await registerBtn.click()
      // Wait for loading state to finish
      await expect(registerBtn).not.toHaveAttribute('disabled', '', {
        timeout: Timeouts.API,
      })
      const hasContact = await adminPage
        .getByTestId('signal-contact-delete')
        .isVisible()
        .catch(() => false)
      if (!hasContact) {
        test.skip(true, 'Signal notifier not configured in test environment')
        return
      }
      await expect(deleteBtn).toBeVisible()
    }

    await deleteBtn.click()

    await expect(adminPage.getByTestId('signal-register-button')).toBeVisible({
      timeout: Timeouts.API,
    })
    await expect(adminPage.getByTestId('signal-contact-delete')).not.toBeVisible()
  })

  test('notification channel preference toggle reflects Signal contact state', async ({
    adminPage,
  }) => {
    const channelCard = adminPage.getByTestId('notification-channel')
    await expect(channelCard).toBeVisible()
    await adminPage.getByTestId('notification-channel-trigger').click()
    await adminPage.waitForTimeout(500)

    const webPushOption = adminPage.getByTestId('notification-channel-web_push')
    const signalOption = adminPage.getByTestId('notification-channel-signal')

    await expect(webPushOption).toBeVisible()
    await expect(signalOption).toBeVisible()

    const signalDisabled = await signalOption.evaluate((el: HTMLElement) => el.disabled)

    await adminPage.getByTestId('signal-contact-trigger').click()
    await adminPage.waitForTimeout(500)
    const hasContact = await adminPage
      .getByTestId('signal-contact-delete')
      .isVisible()
      .catch(() => false)

    if (hasContact) {
      expect(signalDisabled).toBe(false)
    } else {
      expect(signalDisabled).toBe(true)
    }
  })
})
