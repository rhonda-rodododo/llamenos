import { expect, test } from '../fixtures/auth'
import { clearSessionCapsule, navigateAfterLogin, reenterPinAfterReload } from '../helpers'

test.describe('Profile self-service', () => {
  test('admin can edit profile name and it persists', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Profile card should be visible
    await expect(adminPage.getByRole('heading', { name: 'Profile' })).toBeVisible()

    // Change display name
    const nameInput = adminPage.locator('#profile-name')
    const oldName = await nameInput.inputValue()
    const newName = `Admin ${Date.now()}`
    await nameInput.fill(newName)

    // Save — name is sent to API
    await adminPage.getByRole('button', { name: /update profile/i }).click()
    await expect(adminPage.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })

    // Reload and verify name persisted via /auth/me; clear capsule so the
    // locked-key redirect fires and PIN re-entry validates the full decrypt cycle.
    await clearSessionCapsule(adminPage)
    await adminPage.reload()
    await reenterPinAfterReload(adminPage)
    // PIN unlock may redirect to profile-setup — handle it
    if (adminPage.url().includes('profile-setup')) {
      await adminPage.getByRole('button', { name: /complete setup/i }).click()
      await adminPage.waitForURL((u) => !u.toString().includes('profile-setup'), { timeout: 15000 })
    }
    // Navigate back to Settings
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click({ timeout: 15000 })
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()
    // After PIN unlock, the crypto worker needs time to decrypt envelope-encrypted fields.
    // The hub key must be fetched and decrypted before profile fields can be decrypted.
    // Wait for the profile name input to show the decrypted value (not [encrypted]).
    await expect(adminPage.locator('#profile-name')).not.toHaveValue('[encrypted]', {
      timeout: 30000,
    })
    await expect(adminPage.locator('#profile-name')).toHaveValue(newName, { timeout: 10000 })

    // Restore original name
    await adminPage.locator('#profile-name').fill(oldName || 'Admin')
    await adminPage.getByRole('button', { name: /update profile/i }).click()
    await expect(adminPage.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })
  })

  test('admin can save a valid phone number', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Enter a valid E.164 phone number
    const phoneInput = adminPage.locator('#profile-phone')
    await phoneInput.fill('+12125559999')
    await phoneInput.blur()
    await adminPage.getByRole('button', { name: /update profile/i }).click()

    // Should succeed
    await expect(adminPage.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })
  })

  test('profile rejects invalid phone', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Enter a too-short phone (PhoneInput strips non-digits)
    const phoneInput = adminPage.locator('#profile-phone')
    await phoneInput.fill('+123')
    await phoneInput.blur()
    await adminPage.getByRole('button', { name: /update profile/i }).click()

    // Should show error
    await expect(adminPage.getByText(/invalid phone/i)).toBeVisible({ timeout: 5000 })
  })

  test('volunteer sees profile card in settings', async ({ volunteerPage }) => {
    await volunteerPage.getByRole('link', { name: 'Settings' }).click()
    await expect(
      volunteerPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Profile card should be visible for all users
    await expect(volunteerPage.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(volunteerPage.locator('#profile-name')).toBeVisible()
    await expect(volunteerPage.locator('#profile-phone')).toBeVisible()

    // Public key should be shown
    await expect(volunteerPage.getByText(/npub1/).first()).toBeVisible()
  })

  test('admin sees key backup in user settings and spam in admin settings', async ({
    adminPage,
  }) => {
    // Key Backup is in user settings
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()
    await expect(adminPage.getByRole('heading', { name: /key backup/i })).toBeVisible()

    // Spam Mitigation is in admin settings
    await navigateAfterLogin(adminPage, '/admin/spam-protection')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'spam-protection'
    )
    await expect(adminPage.getByTestId('admin-section-heading')).toBeVisible()
  })

  test('admin sees passkeys in user settings', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Passkeys (WebAuthn) card
    await expect(adminPage.getByRole('heading', { name: /passkeys/i })).toBeVisible()
  })

  test('volunteer does not see admin settings link', async ({ volunteerPage }) => {
    await volunteerPage.getByRole('link', { name: 'Settings' }).click()
    await expect(
      volunteerPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Should NOT see Hub Settings nav link
    await expect(volunteerPage.getByRole('link', { name: 'Hub Settings' })).not.toBeVisible()

    // Should NOT see admin-only sections on user settings page
    await expect(volunteerPage.getByRole('heading', { name: /passkey policy/i })).not.toBeVisible()
    await expect(volunteerPage.getByRole('heading', { name: /spam mitigation/i })).not.toBeVisible()
  })

  test('volunteer can update name and phone', async ({ volunteerPage }) => {
    await volunteerPage.getByRole('link', { name: 'Settings' }).click()
    await expect(
      volunteerPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Update name
    const newName = `Vol ${Date.now()}`
    await volunteerPage.locator('#profile-name').fill(newName)

    // Update phone
    await volunteerPage.locator('#profile-phone').fill('+15551234567')
    await volunteerPage.locator('#profile-phone').blur()

    await volunteerPage.getByRole('button', { name: /update profile/i }).click()
    await expect(volunteerPage.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })

    // Verify name persists after reload; clear capsule so the locked-key
    // redirect fires and PIN re-entry validates the full decrypt cycle.
    await clearSessionCapsule(volunteerPage)
    await volunteerPage.reload()
    await reenterPinAfterReload(volunteerPage)
    // PIN unlock may redirect to profile-setup — handle it
    if (volunteerPage.url().includes('profile-setup')) {
      await volunteerPage.getByRole('button', { name: /complete setup/i }).click()
      await volunteerPage.waitForURL((u) => !u.toString().includes('profile-setup'), {
        timeout: 15000,
      })
    }
    // Navigate back to Settings
    await volunteerPage.getByRole('link', { name: 'Settings' }).click({ timeout: 15000 })
    await expect(
      volunteerPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()
    // After PIN unlock, the crypto worker needs time to decrypt envelope-encrypted fields.
    // The hub key must be fetched and decrypted before profile fields can be decrypted.
    await expect(volunteerPage.locator('#profile-name')).not.toHaveValue('[encrypted]', {
      timeout: 30000,
    })
    await expect(volunteerPage.locator('#profile-name')).toHaveValue(newName, { timeout: 10000 })
  })

  test('spoken language selection works', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Find the spoken languages section
    await expect(adminPage.getByText(/languages you can take calls in/i)).toBeVisible()

    // Click a language to toggle it (e.g., Español)
    const esButton = adminPage.locator('button').filter({ hasText: 'Español' }).last()
    await esButton.click()

    // Save button should appear
    const saveBtn = adminPage.getByRole('button', { name: /update profile/i })
    if (await saveBtn.isVisible()) {
      await saveBtn.click()
      await expect(adminPage.getByText(/profile updated/i)).toBeVisible({ timeout: 5000 })
    }
  })

  test('deep link expands and scrolls to section', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/settings?section=transcription')
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Transcription section should be expanded — content should be visible
    // When allowUserOptOut is false (default), shows "managed by admin" instead of toggle
    await expect(adminPage.getByText(/transcription is managed by your admin/i)).toBeVisible()
  })

  test('sections collapse and expand on click', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Profile is expanded by default — its content should be visible
    await expect(adminPage.locator('#profile-name')).toBeVisible()

    // Collapse profile by clicking its header
    await adminPage.getByRole('heading', { name: 'Profile' }).click()
    await expect(adminPage.locator('#profile-name')).not.toBeVisible()

    // Expand again
    await adminPage.getByRole('heading', { name: 'Profile' }).click()
    await expect(adminPage.locator('#profile-name')).toBeVisible()
  })

  test('multiple sections can be open simultaneously', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Profile is already expanded
    await expect(adminPage.locator('#profile-name')).toBeVisible()

    // Expand Transcription too
    await adminPage.getByRole('heading', { name: 'Transcription' }).click()
    await expect(adminPage.getByText(/transcription is managed by your admin/i)).toBeVisible()

    // Profile should still be expanded
    await expect(adminPage.locator('#profile-name')).toBeVisible()
  })

  test('copy link button is present on each section', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(
      adminPage.getByRole('heading', { name: 'Account Settings', exact: true })
    ).toBeVisible()

    // Each section header should have a copy link button (profile, passkeys, transcription, notifications)
    const copyButtons = adminPage.getByRole('button', { name: /copy link/i })
    const count = await copyButtons.count()
    expect(count).toBeGreaterThanOrEqual(4)
  })
})
