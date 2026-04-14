/**
 * Tier 6 device fingerprint verification — UI E2E.
 *
 * The admin-facing Devices section renders a list populated by
 * GET /hubs/:hubId/devices, a read endpoint that has not been
 * implemented yet (Tier 6 PR #2). The verify mutation in
 * `devices-section.tsx` also throws "not yet implemented".
 *
 * Until that PR lands we can only test the empty-state: the section
 * renders under the admin shell and the devices query returns an empty
 * list. Earlier copies of this spec included 4 "pick the SAS emoji"
 * interaction tests that skipped whenever no unverified device existed
 * — i.e. always. They were deleted here to avoid perpetually-skipped
 * dead tests. When Tier 6 PR #2 adds the list endpoint + real verify
 * signing, those interaction tests should be re-added together with a
 * fixture that seeds an unverified device row.
 */

import { expect, test } from '../fixtures/auth'
import { gotoAdminPath } from '../helpers/admin-settings'

test.describe('Device fingerprint verification UI', () => {
  test.beforeEach(async ({ adminPage }) => {
    // Admin sidebar only renders inside the admin shell; navigate there first
    // via the in-page router so crypto-worker state is preserved.
    await gotoAdminPath(adminPage, '/admin')
  })

  test('devices section renders in admin nav', async ({ adminPage }) => {
    await adminPage.getByTestId('admin-sidebar-item-devices').click()
    await expect(adminPage.getByTestId('devices-section')).toBeVisible({ timeout: 10000 })
  })
})
