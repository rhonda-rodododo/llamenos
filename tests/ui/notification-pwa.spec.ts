import { expect, test } from '../fixtures/auth'
import { clearSessionCapsule, reenterPinAfterReload } from '../helpers'

test.describe('Notification prompt banner', () => {
  test('shows notification banner when permission is default', async ({ adminPage }) => {
    // Mock Notification API as 'default' permission
    await adminPage.addInitScript(() => {
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'default', requestPermission: () => Promise.resolve('default') },
        writable: true,
        configurable: true,
      })
    })

    // Notification banner should be visible
    await expect(
      adminPage.getByText('Enable notifications to get alerted when calls come in.')
    ).toBeVisible()
    await expect(adminPage.getByRole('button', { name: 'Enable', exact: true })).toBeVisible()
  })

  test('hides notification banner when permission is granted', async ({ adminPage }) => {
    await adminPage.addInitScript(() => {
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'granted', requestPermission: () => Promise.resolve('granted') },
        writable: true,
        configurable: true,
      })
    })

    // Banner should not appear
    await expect(
      adminPage.getByText('Enable notifications to get alerted when calls come in.')
    ).not.toBeVisible()
  })

  test('dismiss button hides notification banner permanently', async ({ adminPage }) => {
    await adminPage.addInitScript(() => {
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'default', requestPermission: () => Promise.resolve('default') },
        writable: true,
        configurable: true,
      })
    })

    // Banner visible
    const banner = adminPage.getByText('Enable notifications to get alerted when calls come in.')
    await expect(banner).toBeVisible()

    // Click dismiss (X button near the banner)
    const dismissBtn = banner.locator('..').locator('..').getByRole('button', { name: 'Close' })
    await dismissBtn.click()

    // Banner should be gone
    await expect(banner).not.toBeVisible()

    // Verify localStorage was set
    const dismissed = await adminPage.evaluate(() =>
      localStorage.getItem('llamenos-notification-prompt-dismissed')
    )
    expect(dismissed).toBe('true')
  })
})

test.describe('Settings notification permission status', () => {
  test('shows "Enabled" badge when notifications are granted', async ({ adminPage }) => {
    await adminPage.addInitScript(() => {
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'granted', requestPermission: () => Promise.resolve('granted') },
        writable: true,
        configurable: true,
      })
    })

    // Reload so the addInitScript takes effect; clear capsule first so the
    // locked-key redirect fires and PIN re-entry is required.
    await clearSessionCapsule(adminPage)
    await adminPage.reload()
    await reenterPinAfterReload(adminPage)

    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Expand notifications section
    const notifSection = adminPage.getByRole('heading', { name: 'Call Notifications' })
    await notifSection.click()

    // Should show the Enabled badge
    await expect(adminPage.getByText('Notifications are enabled.')).toBeVisible()
    await expect(adminPage.getByText('Enabled', { exact: true })).toBeVisible()
  })

  test('shows "Not enabled" badge and Enable button when permission is default', async ({
    adminPage,
  }) => {
    await adminPage.addInitScript(() => {
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'default', requestPermission: () => Promise.resolve('granted') },
        writable: true,
        configurable: true,
      })
    })

    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Expand notifications section
    const notifSection = adminPage.getByRole('heading', { name: 'Call Notifications' })
    await notifSection.click()

    // Should show the Not enabled badge and Enable button
    await expect(
      adminPage.getByText('Browser notifications have not been enabled yet.')
    ).toBeVisible()
    await expect(adminPage.getByText('Not enabled', { exact: true })).toBeVisible()
    await expect(adminPage.getByRole('button', { name: 'Enable Notifications' })).toBeVisible()
  })

  test('shows "Blocked" badge when notifications are denied', async ({ adminPage }) => {
    await adminPage.addInitScript(() => {
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'denied', requestPermission: () => Promise.resolve('denied') },
        writable: true,
        configurable: true,
      })
    })

    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Expand notifications section
    const notifSection = adminPage.getByRole('heading', { name: 'Call Notifications' })
    await notifSection.click()

    // Should show the Blocked badge
    await expect(
      adminPage.getByText(
        "Notifications are blocked. Update your browser's site settings to enable them."
      )
    ).toBeVisible()
    await expect(adminPage.getByText('Blocked', { exact: true })).toBeVisible()
  })
})

test.describe('PWA install banner', () => {
  // Under parallel execution, PBKDF2 contention can slow fixture setup.
  test.setTimeout(180_000)
  test('does not show PWA banner when beforeinstallprompt has not fired', async ({ adminPage }) => {
    // PWA banner should not be visible (no beforeinstallprompt event)
    await expect(adminPage.getByText('Install this app for quick access')).not.toBeVisible()
  })

  test('shows PWA banner when beforeinstallprompt fires', async ({ adminPage }) => {
    // Dispatch beforeinstallprompt after login (hook listener is already attached)
    await adminPage.evaluate(() => {
      const event = new Event('beforeinstallprompt')
      ;(event as any).prompt = () => Promise.resolve()
      ;(event as any).userChoice = Promise.resolve({ outcome: 'dismissed' })
      window.dispatchEvent(event)
    })

    // PWA banner should appear
    await expect(
      adminPage.getByText('Install this app for quick access and a better experience.')
    ).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByRole('button', { name: 'Install' })).toBeVisible()
  })

  test('dismiss button hides PWA banner permanently', async ({ adminPage }) => {
    // Dispatch beforeinstallprompt
    await adminPage.evaluate(() => {
      const event = new Event('beforeinstallprompt')
      ;(event as any).prompt = () => Promise.resolve()
      ;(event as any).userChoice = Promise.resolve({ outcome: 'dismissed' })
      window.dispatchEvent(event)
    })

    // Wait for banner
    const bannerText = adminPage.getByText(
      'Install this app for quick access and a better experience.'
    )
    await expect(bannerText).toBeVisible({ timeout: 10000 })

    // Click dismiss
    const dismissBtn = bannerText.locator('..').locator('..').getByRole('button', { name: 'Close' })
    await dismissBtn.click()

    // Banner gone
    await expect(bannerText).not.toBeVisible()

    // localStorage set
    const dismissed = await adminPage.evaluate(() =>
      localStorage.getItem('llamenos-pwa-install-dismissed')
    )
    expect(dismissed).toBe('true')
  })
})
