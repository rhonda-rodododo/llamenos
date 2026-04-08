import { expect } from '@playwright/test'
import { test } from '../fixtures/auth'
import {
  closeMobileNav,
  expectActiveNavItem,
  expectNavGroupHidden,
  expectNavGroupVisible,
  gotoAdminPath,
  gotoAdminSection,
  openMobileNav,
} from '../helpers/admin-settings'

test.describe('admin shell', () => {
  test('hub admin sees this-hub groups, not platform', async ({ hubAdminPage }) => {
    await gotoAdminPath(hubAdminPage, '/admin')
    await expectNavGroupVisible(hubAdminPage, 'general')
    await expectNavGroupVisible(hubAdminPage, 'people')
    await expectNavGroupHidden(hubAdminPage, 'platform')
  })

  test('super-admin sees platform group', async ({ adminPage }) => {
    await gotoAdminPath(adminPage, '/admin')
    await expectNavGroupVisible(adminPage, 'platform')
  })

  test('nav item click updates active state', async ({ hubAdminPage }) => {
    await gotoAdminPath(hubAdminPage, '/admin')
    await hubAdminPage.getByTestId('admin-sidebar-item-teams').click()
    await expectActiveNavItem(hubAdminPage, 'teams')
  })

  test('deeplink loads correct section', async ({ hubAdminPage }) => {
    await gotoAdminPath(hubAdminPage, '/admin/spam-protection')
    await gotoAdminSection(hubAdminPage, 'spam-protection')
  })

  test('mobile drawer opens + closes', async ({ hubAdminPage }) => {
    await hubAdminPage.setViewportSize({ width: 375, height: 667 })
    await gotoAdminPath(hubAdminPage, '/admin')
    await openMobileNav(hubAdminPage)
    await closeMobileNav(hubAdminPage)
  })

  test('legacy /admin/settings redirects', async ({ hubAdminPage }) => {
    await gotoAdminPath(hubAdminPage, '/admin/settings')
    await expect(hubAdminPage).toHaveURL(
      /\/admin\/(location-lookup|passkey-policy|hub-roles|teams|spam-protection|phone-provider)/
    )
  })
})
