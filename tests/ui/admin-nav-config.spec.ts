import { adminNavConfig } from '../../src/client/components/admin-shell/admin-nav-config'
import { expect, test } from '../fixtures/auth'

test.describe('admin nav config snapshot', () => {
  for (const group of adminNavConfig.groups) {
    for (const item of group.items) {
      // super-admin-only items skipped for regular admin
      if (item.requiredRole === 'role-super-admin') continue

      test(`renders section: ${item.slug}`, async ({ adminPage }) => {
        await adminPage.goto(`/admin/${item.slug}`)
        await expect(adminPage.getByTestId('admin-section')).toHaveAttribute(
          'data-section',
          item.slug
        )
      })
    }
  }
})
