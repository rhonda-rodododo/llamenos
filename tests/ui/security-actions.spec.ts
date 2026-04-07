import { expect, test } from '../fixtures/auth'

test.describe('Security actions UI', () => {
  test('lockdown modal shows tier choices', async ({ adminPage }) => {
    // Navigate via client-side link to preserve crypto worker state
    await adminPage.getByRole('link', { name: /^Security$/ }).click()
    await expect(adminPage).toHaveURL(/\/security\/sessions$/)
    await expect(adminPage.getByTestId('sessions-page')).toBeVisible({ timeout: 30000 })
    await adminPage.getByTestId('open-lockdown').click()
    await expect(adminPage.getByTestId('lockdown-modal')).toBeVisible()
    await expect(adminPage.getByTestId('tier-A')).toBeVisible()
    await expect(adminPage.getByTestId('tier-B')).toBeVisible()
    await expect(adminPage.getByTestId('tier-C')).toBeVisible()
    await adminPage.keyboard.press('Escape')
  })

  test('lockdown requires typing LOCKDOWN', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: /^Security$/ }).click()
    await expect(adminPage).toHaveURL(/\/security\/sessions$/)
    await expect(adminPage.getByTestId('sessions-page')).toBeVisible({ timeout: 30000 })
    await adminPage.getByTestId('open-lockdown').click()
    await adminPage.getByTestId('tier-A').click()
    await adminPage.getByTestId('confirmation-input').fill('wrong')
    await adminPage.getByTestId('pin-input').fill('123456')
    await adminPage.getByTestId('submit-lockdown').click()
    await expect(adminPage.getByTestId('lockdown-error')).toBeVisible()
    await adminPage.keyboard.press('Escape')
  })

  test('factors page renders PIN + recovery + lock sections', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: /^Security$/ }).click()
    await expect(adminPage).toHaveURL(/\/security\/sessions$/)
    await adminPage.getByTestId('tab-factors').click()
    await expect(adminPage).toHaveURL(/\/security\/factors$/)
    await expect(adminPage.getByTestId('factors-page')).toBeVisible()
    await expect(adminPage.getByTestId('pin-change-form')).toBeVisible()
    await expect(adminPage.getByTestId('recovery-rotate-form')).toBeVisible()
    await expect(adminPage.getByTestId('idle-lock-slider')).toBeVisible()
  })

  test('factors tab is reachable from security navigation', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: /^Security$/ }).click()
    await expect(adminPage).toHaveURL(/\/security\/sessions$/)
    await adminPage.getByTestId('tab-factors').click()
    await expect(adminPage).toHaveURL(/\/security\/factors$/)
    await expect(adminPage.getByTestId('factors-page')).toBeVisible()
  })
})
