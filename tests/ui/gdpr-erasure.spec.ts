import { expect, test } from '../fixtures/auth'
import { Timeouts, navigateAfterLogin } from '../helpers'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

test.describe('GDPR Erasure & Data Export', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/settings')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
  })

  test('user requests account erasure and sees pending state', async ({ volunteerPage }) => {
    await navigateAfterLogin(volunteerPage, '/settings')
    await volunteerPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    await volunteerPage.getByTestId('privacy-trigger').click()
    await volunteerPage.waitForTimeout(500)

    const requestBtn = volunteerPage.getByTestId('gdpr-request-erasure-button')
    await expect(requestBtn).toBeVisible({ timeout: Timeouts.ELEMENT })
    await requestBtn.click()

    const cancelBtn = volunteerPage.getByTestId('gdpr-cancel-erasure-button')
    await expect(cancelBtn).toBeVisible({ timeout: Timeouts.API })

    const countdown = volunteerPage.getByTestId('gdpr-erasure-countdown')
    await expect(countdown).toBeVisible()
  })

  test('user cancels erasure during grace period', async ({ volunteerPage }) => {
    await navigateAfterLogin(volunteerPage, '/settings')
    await volunteerPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    await volunteerPage.getByTestId('privacy-trigger').click()
    await volunteerPage.waitForTimeout(500)

    const requestBtn = volunteerPage.getByTestId('gdpr-request-erasure-button')
    const cancelBtn = volunteerPage.getByTestId('gdpr-cancel-erasure-button')

    const isPending = await cancelBtn.isVisible().catch(() => false)
    if (!isPending) {
      await expect(requestBtn).toBeVisible()
      await requestBtn.click()
      await expect(cancelBtn).toBeVisible({ timeout: Timeouts.API })
    }

    await cancelBtn.click()

    await expect(requestBtn).toBeVisible({ timeout: Timeouts.API })
    await expect(cancelBtn).not.toBeVisible()
  })

  test('data export button is present and clickable', async ({ adminPage }) => {
    await adminPage.getByTestId('privacy-trigger').click()
    await adminPage.waitForTimeout(500)

    const exportBtn = adminPage.getByTestId('gdpr-export-button')
    await expect(exportBtn).toBeVisible({ timeout: Timeouts.ELEMENT })
    await expect(exportBtn).toBeEnabled()
  })

  test('admin navigates to GDPR erasure section', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/admin/gdpr-erasure')
    await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
      'data-section',
      'gdpr-erasure'
    )
    await expect(adminPage.getByTestId('gdpr-admin-pubkey-input')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })
    await expect(adminPage.getByTestId('gdpr-admin-export-button')).toBeVisible()
    await expect(adminPage.getByTestId('gdpr-admin-erase-button')).toBeVisible()
  })

  test('admin force-erases a user via UI', async ({ adminPage, request }) => {
    const authedApi = createAdminApiFromStorageState(request)

    const hubName = `gdpr-erase-test-${Date.now()}`
    const createRes = await authedApi.post('/api/hubs', { name: hubName })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    const hubId = created.hub.id

    const userRes = await authedApi.post('/api/auth/enroll', {
      pubkey: 'a'.repeat(64),
    })
    expect(userRes.ok()).toBe(true)
    const userData = await userRes.json()
    const targetPubkey = userData.pubkey ?? 'a'.repeat(64)

    await navigateAfterLogin(adminPage, '/admin/gdpr-erasure')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    await adminPage.getByTestId('gdpr-admin-pubkey-input').fill(targetPubkey)

    await adminPage.getByTestId('gdpr-admin-erase-button').click()

    await expect(adminPage.getByTestId('gdpr-admin-erase-confirm-dialog')).toBeVisible({
      timeout: Timeouts.ELEMENT,
    })

    await adminPage.getByTestId('gdpr-admin-erase-confirm').click()

    await expect(adminPage.getByTestId('gdpr-admin-erase-confirm-dialog')).not.toBeVisible({
      timeout: Timeouts.API,
    })

    await authedApi.delete(`/api/hubs/${hubId}`)
  })

  test('admin exports user data via UI triggers download', async ({ adminPage, request }) => {
    const authedApi = createAdminApiFromStorageState(request)

    const userRes = await authedApi.post('/api/auth/enroll', {
      pubkey: 'b'.repeat(64),
    })
    expect(userRes.ok()).toBe(true)
    const userData = await userRes.json()
    const targetPubkey = userData.pubkey ?? 'b'.repeat(64)

    await navigateAfterLogin(adminPage, '/admin/gdpr-erasure')
    await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

    await adminPage.getByTestId('gdpr-admin-pubkey-input').fill(targetPubkey)

    const [download] = await Promise.all([
      adminPage.waitForEvent('download', { timeout: Timeouts.API }),
      adminPage.getByTestId('gdpr-admin-export-button').click(),
    ])

    expect(download.suggestedFilename()).toMatch(/llamenos-export/)
  })
})
