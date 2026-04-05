import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Navigate to an admin path via the in-page TanStack Router, preserving
 * in-memory auth/key state. Use this in tests that start from an
 * already-authenticated page fixture — avoids a full page reload (which
 * would wipe the crypto worker's unlocked key) and avoids
 * navigateAfterLogin's Dashboard-link probe.
 */
export async function gotoAdminPath(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    const router = (window as { __TEST_ROUTER?: { navigate: (opts: { to: string }) => void } })
      .__TEST_ROUTER
    if (!router) throw new Error('__TEST_ROUTER not exposed — app not in test mode')
    router.navigate({ to: p })
  }, path)
  await page.getByTestId('admin-shell').waitFor({ state: 'visible', timeout: 10000 })
}

export async function gotoAdminSection(page: Page, slug: string) {
  await page.goto(`/admin/${slug}`)
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', slug)
}

export async function expectActiveNavItem(page: Page, slug: string) {
  const item = page.getByTestId(`admin-sidebar-item-${slug}`)
  // TanStack Router sets aria-current="page" + data-status="active" on the
  // active Link. This is stable across styling changes, unlike class names.
  await expect(item).toHaveAttribute('data-status', 'active')
}

export async function openMobileNav(page: Page) {
  await page.getByTestId('admin-sidebar-toggle').click()
  await expect(page.getByTestId('admin-sidebar-drawer')).toBeVisible()
}

export async function closeMobileNav(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('admin-sidebar-drawer')).not.toBeVisible()
}

export async function expectSectionLoaded(page: Page, slug: string) {
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', slug)
  await expect(page.getByTestId('admin-section-heading')).toBeVisible()
}

export async function revealAdvanced(page: Page, sectionSlug: string) {
  await page.getByTestId(`admin-advanced-reveal-${sectionSlug}`).click()
  await expect(page.getByTestId(`admin-advanced-panel-${sectionSlug}`)).toBeVisible()
}

export async function hideAdvanced(page: Page, sectionSlug: string) {
  await page.getByTestId(`admin-advanced-reveal-${sectionSlug}`).click()
  await expect(page.getByTestId(`admin-advanced-panel-${sectionSlug}`)).not.toBeVisible()
}

export async function saveSection(page: Page, sectionSlug: string) {
  await page.getByTestId(`admin-${sectionSlug}-save`).click()
  // Success feedback: each section renders a stable testid when save succeeds.
  await expect(page.getByTestId(`admin-${sectionSlug}-save-success`)).toBeVisible({
    timeout: 5000,
  })
}

export async function expectNavGroupVisible(page: Page, groupSlug: string) {
  await expect(page.getByTestId(`admin-sidebar-group-${groupSlug}`)).toBeVisible()
}

export async function expectNavGroupHidden(page: Page, groupSlug: string) {
  await expect(page.getByTestId(`admin-sidebar-group-${groupSlug}`)).not.toBeVisible()
}
