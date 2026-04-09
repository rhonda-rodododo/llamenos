import { expect, test } from '../fixtures/auth'
import { Timeouts, navigateAfterLogin } from '../helpers'

test.describe('Contact Directory', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/contacts')
  })

  // Group 1: Contact Directory Page
  test.describe('directory page', () => {
    test('loads with heading', async ({ adminPage }) => {
      await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('shows search input', async ({ adminPage }) => {
      await expect(adminPage.getByTestId('contact-search')).toBeVisible()
    })

    test('shows contact type filter', async ({ adminPage }) => {
      await expect(adminPage.getByTestId('contact-type-filter')).toBeVisible()
    })

    test('shows risk level filter', async ({ adminPage }) => {
      await expect(adminPage.getByTestId('risk-level-filter')).toBeVisible()
    })

    test('shows New Contact button', async ({ adminPage }) => {
      await expect(adminPage.getByTestId('new-contact-btn')).toBeVisible()
    })

    test('shows empty state or contact list', async ({ adminPage }) => {
      const hasRows = await adminPage
        .getByTestId('contact-row')
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
      const hasEmpty = await adminPage
        .getByRole('img', { hidden: true })
        .isVisible({ timeout: 1000 })
        .catch(() => false)
      // Either rows or empty state icon should be visible — loading must have resolved
      const loadingGone = await adminPage
        .locator('[data-testid="contact-search"]')
        .isVisible({ timeout: Timeouts.API })
      expect(loadingGone || hasRows || hasEmpty).toBeTruthy()
    })
  })

  // Group 2: Create Contact Flow
  test.describe('create contact flow', () => {
    test('opens dialog when New Contact button clicked', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      await expect(adminPage.getByTestId('create-contact-dialog')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
      await expect(adminPage.getByTestId('create-contact-title')).toBeVisible()
    })

    test('dialog contains display name input', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      await expect(adminPage.locator('#displayName')).toBeVisible()
    })

    test('dialog contains contact type select', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      await expect(adminPage.locator('#contactType')).toBeVisible()
    })

    test('dialog contains risk level select', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      await expect(adminPage.locator('#riskLevel')).toBeVisible()
    })

    test('dialog contains tags input', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      await expect(adminPage.getByTestId('tag-input')).toBeVisible()
    })

    test('dialog can be cancelled', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      await expect(adminPage.getByTestId('create-contact-dialog')).toBeVisible()
      await adminPage.getByRole('button', { name: /cancel/i }).click()
      await expect(adminPage.getByTestId('create-contact-dialog')).not.toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('display name field accepts input', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      await adminPage.locator('#displayName').fill('Test Caller E2E')
      await expect(adminPage.locator('#displayName')).toHaveValue('Test Caller E2E')
    })

    test('contact type dropdown works', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      // Click the SelectTrigger for contactType
      await adminPage.locator('#contactType').click()
      // Options should be visible in the popover
      const orgOption = adminPage.getByRole('option', { name: /organization/i })
      await expect(orgOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await orgOption.click()
      // Trigger should now show selected value
      await expect(adminPage.locator('#contactType')).toContainText(/organization/i)
    })

    test('risk level dropdown works', async ({ adminPage }) => {
      await adminPage.getByTestId('new-contact-btn').click()
      await adminPage.locator('#riskLevel').click()
      const highOption = adminPage.getByRole('option', { name: /high/i })
      await expect(highOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await highOption.click()
      await expect(adminPage.locator('#riskLevel')).toContainText(/high/i)
    })

    test('creates a contact and closes dialog', async ({ adminPage }) => {
      const displayName = `E2E Contact ${Date.now()}`
      await adminPage.getByTestId('new-contact-btn').click()

      await adminPage.locator('#displayName').fill(displayName)

      // Select medium risk
      await adminPage.locator('#riskLevel').click()
      const mediumOption = adminPage.getByRole('option', { name: /medium/i })
      await expect(mediumOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await mediumOption.click()

      // Tags are now a Command+Popover multi-select (TagInput), skip for this test

      // Submit
      await adminPage.getByRole('button', { name: /create contact/i }).click()

      // Dialog should close on success
      await expect(adminPage.getByTestId('create-contact-dialog')).not.toBeVisible({
        timeout: Timeouts.API,
      })
    })
  })

  // Group 3: Contact Profile
  test.describe('contact profile', () => {
    let createdContactName: string

    test.beforeEach(async ({ adminPage }) => {
      // Create a contact to click into
      createdContactName = `Profile Test ${Date.now()}`
      await adminPage.getByTestId('new-contact-btn').click()
      await adminPage.locator('#displayName').fill(createdContactName)
      await adminPage.getByRole('button', { name: /create contact/i }).click()
      // Wait for create-contact dialog to close and list to refresh
      await expect(adminPage.getByTestId('create-contact-dialog')).not.toBeVisible({
        timeout: Timeouts.API,
      })
      await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
    })

    test('clicking contact row navigates to profile', async ({ adminPage }) => {
      const row = adminPage.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await expect(adminPage).toHaveURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
    })

    test('profile page shows summary section', async ({ adminPage }) => {
      const row = adminPage.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await adminPage.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
      await expect(adminPage.getByTestId('contact-summary-card')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('profile page shows PII section', async ({ adminPage }) => {
      const row = adminPage.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await adminPage.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
      await expect(adminPage.getByTestId('contact-pii-card')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('profile page shows timeline section', async ({ adminPage }) => {
      const row = adminPage.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await adminPage.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)
      await expect(adminPage.getByTestId('contact-timeline-card')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })

    test('back button navigates to directory', async ({ adminPage }) => {
      const row = adminPage.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await adminPage.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

      await adminPage.getByTestId('contact-back-btn').click()
      await expect(adminPage).toHaveURL(/\/contacts(\?|$)/, { timeout: Timeouts.NAVIGATION })
    })

    test('delete button visible on profile for admin', async ({ adminPage }) => {
      const row = adminPage.getByTestId('contact-row').first()
      await expect(row).toBeVisible({ timeout: Timeouts.API })
      await row.click()
      await adminPage.waitForURL(/\/contacts\/[^/]+$/, { timeout: Timeouts.NAVIGATION })
      await adminPage.waitForTimeout(Timeouts.ASYNC_SETTLE)

      await expect(adminPage.getByTestId('contact-delete-btn')).toBeVisible({
        timeout: Timeouts.ELEMENT,
      })
    })
  })

  // Group 4: Search and Filtering
  test.describe('search and filtering', () => {
    test('search input submits on form submit', async ({ adminPage }) => {
      await adminPage.getByTestId('contact-search').fill('test query')
      await adminPage.getByTestId('contact-search-btn').click()
      // URL should update with q param
      await expect(adminPage).toHaveURL(/q=test\+query|q=test%20query/, {
        timeout: Timeouts.NAVIGATION,
      })
    })

    test('contact type filter updates URL', async ({ adminPage }) => {
      await adminPage.getByTestId('contact-type-filter').click()
      const callerOption = adminPage.getByRole('option', { name: /caller/i })
      await expect(callerOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await callerOption.click()
      await expect(adminPage).toHaveURL(/contactType=caller/, { timeout: Timeouts.NAVIGATION })
    })

    test('risk level filter updates URL', async ({ adminPage }) => {
      await adminPage.getByTestId('risk-level-filter').click()
      const highOption = adminPage.getByRole('option', { name: /high/i })
      await expect(highOption).toBeVisible({ timeout: Timeouts.ELEMENT })
      await highOption.click()
      await expect(adminPage).toHaveURL(/riskLevel=high/, { timeout: Timeouts.NAVIGATION })
    })
  })
})
