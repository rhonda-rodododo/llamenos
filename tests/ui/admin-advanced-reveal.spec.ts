import { expect } from '@playwright/test'
import { test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'
import { gotoAdminSection, hideAdvanced, revealAdvanced } from '../helpers/admin-settings'

test('spam-protection advanced reveal shows/hides thresholds', async ({ hubAdminPage }) => {
  await navigateAfterLogin(hubAdminPage, '/admin/spam-protection')
  await gotoAdminSection(hubAdminPage, 'spam-protection')
  await expect(hubAdminPage.getByTestId('admin-advanced-panel-spam-protection')).not.toBeVisible()
  await revealAdvanced(hubAdminPage, 'spam-protection')
  await expect(
    hubAdminPage.getByTestId('admin-spam-protection-max-calls-per-minute-input')
  ).toBeVisible()
  await hideAdvanced(hubAdminPage, 'spam-protection')
  await expect(hubAdminPage.getByTestId('admin-advanced-panel-spam-protection')).not.toBeVisible()
})

test('phone-provider advanced reveal hides SIP URI by default', async ({ hubAdminPage }) => {
  await navigateAfterLogin(hubAdminPage, '/admin/phone-provider')
  await gotoAdminSection(hubAdminPage, 'phone-provider')
  await expect(hubAdminPage.getByTestId('admin-phone-provider-sip-uri-input')).not.toBeVisible()
  await revealAdvanced(hubAdminPage, 'phone-provider')
  await expect(hubAdminPage.getByTestId('admin-phone-provider-sip-uri-input')).toBeVisible()
})
