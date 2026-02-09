import { expect, type Page, type APIRequestContext } from '@playwright/test'

export const ADMIN_NSEC = 'nsec174zsa94n3e7t0ugfldh9tgkkzmaxhalr78uxt9phjq3mmn6d6xas5jdffh'

export async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: /secret key/i }).fill(ADMIN_NSEC)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
}

export async function loginAsVolunteer(page: Page, nsec: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: /secret key/i }).fill(nsec)
  await page.getByRole('button', { name: /log in/i }).click()
  // Wait for login redirect to complete (away from /login)
  await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 })
  // Give redirects time to settle (profile-setup guard may fire)
  await page.waitForTimeout(500)
}

export async function logout(page: Page) {
  // On desktop, click the logout button in sidebar
  await page.getByRole('button', { name: /log out/i }).click()
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
}

export async function createVolunteerAndGetNsec(page: Page, name: string, phone: string): Promise<string> {
  await page.getByRole('link', { name: 'Volunteers' }).click()
  await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

  await page.getByRole('button', { name: /add volunteer/i }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Phone Number').fill(phone)
  // Blur the phone input so PhoneInput's onBlur re-render completes before clicking Save
  await page.getByLabel('Phone Number').blur()
  await page.getByRole('button', { name: /save/i }).click()

  // Wait for the nsec to appear
  await expect(page.locator('code').first()).toBeVisible({ timeout: 15000 })
  const nsec = await page.locator('code').first().textContent()
  if (!nsec) throw new Error('Failed to get nsec')
  return nsec
}

export async function completeProfileSetup(page: Page) {
  // If we're on profile-setup, complete it
  if (page.url().includes('profile-setup')) {
    await page.getByRole('button', { name: /complete setup/i }).click()
    await page.waitForURL(u => !u.toString().includes('profile-setup'), { timeout: 15000 })
  }
  // Wait for authenticated layout to render
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 })
}

export function uniquePhone(): string {
  const suffix = Date.now().toString().slice(-7)
  return `+1555${suffix}`
}

export async function resetTestState(request: APIRequestContext) {
  await request.post('/api/test-reset')
}
