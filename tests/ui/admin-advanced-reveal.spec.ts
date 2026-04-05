import { expect } from '@playwright/test'
import { test } from '../fixtures/auth'
import {
  gotoAdminPath,
  gotoAdminSection,
  hideAdvanced,
  revealAdvanced,
} from '../helpers/admin-settings'

test('spam-protection advanced reveal shows/hides thresholds', async ({ hubAdminPage }) => {
  await gotoAdminPath(hubAdminPage, '/admin/spam-protection')
  await gotoAdminSection(hubAdminPage, 'spam-protection')
  await expect(hubAdminPage.getByTestId('admin-advanced-panel-spam-protection')).not.toBeVisible()
  await revealAdvanced(hubAdminPage, 'spam-protection')
  await expect(hubAdminPage.getByTestId('admin-advanced-panel-spam-protection')).toBeVisible()
  await hideAdvanced(hubAdminPage, 'spam-protection')
  await expect(hubAdminPage.getByTestId('admin-advanced-panel-spam-protection')).not.toBeVisible()
})

test('phone-provider advanced reveal hides credentials by default', async ({ hubAdminPage }) => {
  await gotoAdminPath(hubAdminPage, '/admin/phone-provider')
  await gotoAdminSection(hubAdminPage, 'phone-provider')
  await expect(hubAdminPage.getByTestId('admin-advanced-panel-phone-provider')).not.toBeVisible()
  await revealAdvanced(hubAdminPage, 'phone-provider')
  await expect(hubAdminPage.getByTestId('admin-advanced-panel-phone-provider')).toBeVisible()
})
