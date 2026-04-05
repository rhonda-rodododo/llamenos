import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function gotoAdminSection(page: Page, slug: string) {
  await page.goto(`/admin/${slug}`)
  await expect(page.getByTestId('admin-section')).toHaveAttribute('data-section', slug)
}

export async function expectActiveNavItem(page: Page, slug: string) {
  const item = page.getByTestId(`admin-sidebar-item-${slug}`)
  await expect(item).toHaveClass(/bg-accent/)
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
