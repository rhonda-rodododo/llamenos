import { expect, test } from '../fixtures/auth'

test.describe('Panic Wipe (L-9)', () => {
  test('triple-Escape wipes storage and redirects to login', async ({ adminPage }) => {
    // Verify we're on the dashboard and storage has data
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
    const hasKeyBefore = await adminPage.evaluate(
      () => !!localStorage.getItem('llamenos-encrypted-key')
    )
    expect(hasKeyBefore).toBe(true)

    // Triple-tap Escape within 1 second
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(100)
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(100)
    await adminPage.keyboard.press('Escape')

    // Should see the red flash overlay briefly
    const overlay = adminPage.getByTestId('panic-wipe-overlay')
    await expect(overlay).toBeVisible({ timeout: 2000 })

    // The wipe does window.location.href = '/login' after 200ms, which is a
    // full-page navigation that destroys the execution context. Use
    // waitForURL which reliably handles full-page navigations including
    // those triggered by window.location.href assignment.
    await adminPage.waitForURL('**/login', { timeout: 15000 })

    // Now the new page is loaded. Verify URL and storage state.
    expect(adminPage.url()).toContain('/login')

    const storageState = await adminPage.evaluate(() => ({
      hasKey: !!localStorage.getItem('llamenos-encrypted-key'),
      localStorageLength: localStorage.length,
    }))
    expect(storageState.hasKey).toBe(false)
    expect(storageState.localStorageLength).toBe(0)
  })

  test('two Escapes then pause does not trigger wipe', async ({ adminPage }) => {
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Two Escapes, then wait > 1 second
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(100)
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(1200) // Wait > 1 second window

    // Third Escape after window expired — should NOT trigger wipe
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(500)

    // Should still be on the dashboard
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // Storage should still have the key
    const hasKey = await adminPage.evaluate(() => !!localStorage.getItem('llamenos-encrypted-key'))
    expect(hasKey).toBe(true)
  })
})
