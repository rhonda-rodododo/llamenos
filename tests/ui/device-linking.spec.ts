import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Device linking — /link-device page', () => {
  test('shows start linking button on initial load', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.removeItem('llamenos-encrypted-key'))
    await page.goto('/link-device')
    await expect(page.getByTestId('link-device-card')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('start-linking')).toBeVisible()
    await ctx.close()
  })

  test('redirects to /login if user already has a stored key', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    // Inject a fake encrypted key blob
    await page.addInitScript(() => {
      localStorage.setItem(
        'llamenos-encrypted-key',
        JSON.stringify({
          version: 2,
          kdf: 'pbkdf2-sha256',
          cipher: 'xchacha20-poly1305',
          salt: 'aa'.repeat(32),
          nonce: 'bb'.repeat(24),
          ciphertext: 'cc'.repeat(32),
          pubkeyHash: 'dd'.repeat(8),
          prfUsed: false,
          idpIssuer: 'device-link',
        })
      )
    })
    await page.goto('/link-device')
    await page.waitForURL((u) => u.toString().includes('/login'), { timeout: 10000 })
    await ctx.close()
  })

  test('shows QR code and short code after clicking start', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.removeItem('llamenos-encrypted-key'))
    await page.goto('/link-device')
    await expect(page.getByTestId('start-linking')).toBeVisible({ timeout: 10000 })

    await page.getByTestId('start-linking').click()
    await expect(page.getByTestId('provisioning-qr')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('short-code')).toBeVisible()

    // Short code should be 8 uppercase hex characters
    const shortCode = await page.getByTestId('short-code').textContent()
    expect(shortCode).toBeTruthy()
    expect(shortCode?.trim()).toMatch(/^[A-F0-9]{8}$/)
    await ctx.close()
  })

  test('has language selector and theme toggles', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.removeItem('llamenos-encrypted-key'))
    await page.goto('/link-device')
    await expect(page.getByTestId('link-device-card')).toBeVisible({ timeout: 10000 })

    await expect(page.getByRole('combobox', { name: /switch to/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /light/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /dark/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /system/i })).toBeVisible()
    await ctx.close()
  })
})

test.describe('Device linking — settings section', () => {
  async function goToLinkedDevices(page: import('@playwright/test').Page) {
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Account Settings', exact: true })).toBeVisible()
    await page.getByRole('heading', { name: /linked devices/i }).click()
  }

  test('settings page has linked devices section with code input', async ({ adminPage }) => {
    await goToLinkedDevices(adminPage)

    await expect(adminPage.getByTestId('link-code-input')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByTestId('link-device-button')).toBeVisible()
  })

  test('link device button is disabled when code input is empty', async ({ adminPage }) => {
    await goToLinkedDevices(adminPage)

    await expect(adminPage.getByTestId('link-device-button')).toBeVisible({ timeout: 10000 })
    await expect(adminPage.getByTestId('link-device-button')).toBeDisabled()
  })

  test('entering invalid JSON code shows error', async ({ adminPage }) => {
    await goToLinkedDevices(adminPage)

    await adminPage.getByTestId('link-code-input').fill('not-valid-json')
    await adminPage.getByTestId('link-device-button').click()

    await expect(adminPage.getByText(/invalid|expired|error/i)).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Device linking — login page integration', () => {
  test('recovery view shows link-this-device button when no stored key', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.removeItem('llamenos-encrypted-key'))
    await page.goto('/login')
    // No stored key → recovery view is default
    await expect(page.getByRole('link', { name: /link this device/i })).toBeVisible({
      timeout: 10000,
    })
    await ctx.close()
  })

  test('link-this-device button navigates to /link-device', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.removeItem('llamenos-encrypted-key'))
    await page.goto('/login')
    await expect(page.getByRole('link', { name: /link this device/i })).toBeVisible({
      timeout: 10000,
    })

    await page.getByRole('link', { name: /link this device/i }).click()
    await expect(page.getByTestId('link-device-card')).toBeVisible({ timeout: 10000 })
    await ctx.close()
  })

  test('recovery options from PIN view shows link-this-device', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    // Inject fake stored key for PIN view
    await page.addInitScript(() => {
      localStorage.setItem(
        'llamenos-encrypted-key',
        JSON.stringify({
          version: 2,
          kdf: 'pbkdf2-sha256',
          cipher: 'xchacha20-poly1305',
          salt: 'aa'.repeat(32),
          nonce: 'bb'.repeat(24),
          ciphertext: 'cc'.repeat(32),
          pubkeyHash: 'dd'.repeat(8),
          prfUsed: false,
          idpIssuer: 'device-link',
        })
      )
    })
    await page.goto('/login')

    // Switch to recovery view
    await page.getByRole('button', { name: /recovery options/i }).click()
    await expect(page.getByRole('link', { name: /link this device/i })).toBeVisible({
      timeout: 5000,
    })
    await ctx.close()
  })
})
