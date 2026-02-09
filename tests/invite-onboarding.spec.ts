import { test, expect } from '@playwright/test'
import { loginAsAdmin, uniquePhone } from './helpers'

test.describe('Invite-based onboarding', () => {
  let inviteLink: string

  test('admin creates invite and volunteer completes onboarding', async ({ page }) => {
    // --- Step 1: Admin creates invite ---
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

    const volName = `Onboard ${Date.now()}`
    const volPhone = uniquePhone()

    await page.getByRole('button', { name: /invite/i }).click()
    const form = page.locator('form')
    await form.locator('input').first().fill(volName)
    await form.locator('input[type="tel"]').fill(volPhone)
    await page.getByRole('button', { name: /create invite/i }).click()

    // Invite link should appear
    const linkEl = page.locator('code').first()
    await expect(linkEl).toBeVisible({ timeout: 10000 })
    inviteLink = (await linkEl.textContent())!
    expect(inviteLink).toContain('/onboarding?code=')

    // --- Step 2: Log out admin ---
    await page.getByRole('button', { name: /log out/i }).click()
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()

    // --- Step 3: Volunteer opens invite link ---
    await page.goto(inviteLink)
    await expect(page.getByText(/welcome/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(volName)).toBeVisible()

    // --- Step 4: Click Get Started ---
    await page.getByRole('button', { name: /get started/i }).click()

    // --- Step 5: Create PIN (6 digits via PIN input) ---
    await expect(page.getByText(/create a pin/i)).toBeVisible({ timeout: 5000 })
    for (let i = 0; i < 6; i++) {
      const input = page.locator(`input[aria-label="PIN digit ${i + 1}"]`)
      await input.click()
      await input.pressSequentially(`${(i + 1) % 10}`)
    }

    // --- Step 6: Confirm PIN ---
    await expect(page.getByText(/confirm your pin/i)).toBeVisible({ timeout: 5000 })
    for (let i = 0; i < 6; i++) {
      const input = page.locator(`input[aria-label="PIN digit ${i + 1}"]`)
      await input.click()
      await input.pressSequentially(`${(i + 1) % 10}`)
    }

    // --- Step 7: Backup page with secret key ---
    await expect(page.getByText(/back up your key/i)).toBeVisible({ timeout: 15000 })
    const nsecEl = page.locator('code').first()
    await expect(nsecEl).toBeVisible()
    const nsec = await nsecEl.textContent()
    expect(nsec).toMatch(/^nsec1/)

    // --- Step 8: Verify backup (fill in the 4 characters) ---
    const charInputs = page.locator('input[type="text"][maxlength="1"]')
    const charCount = await charInputs.count()
    expect(charCount).toBe(4)

    for (let i = 0; i < charCount; i++) {
      const label = charInputs.nth(i).locator('xpath=..').locator('label')
      const labelText = await label.textContent()
      // Extract position number from "Character #N"
      const match = labelText?.match(/#(\d+)/)
      if (match && nsec) {
        const position = parseInt(match[1]) - 1 // 0-indexed
        await charInputs.nth(i).fill(nsec[position])
      }
    }

    await page.getByRole('button', { name: /verify/i }).click()
    await expect(page.getByText(/backup verified/i)).toBeVisible({ timeout: 5000 })

    // --- Step 9: Continue to profile setup ---
    await page.getByRole('button', { name: /continue/i }).click()

    // Should land on profile-setup or dashboard
    await page.waitForURL(url => {
      const path = new URL(url.toString()).pathname
      return path === '/profile-setup' || path === '/'
    }, { timeout: 15000 })
  })

  test('invalid invite code shows error', async ({ page }) => {
    await page.goto('/onboarding?code=invalidcode123')
    await expect(page.getByText(/invalid invite/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /go to login/i })).toBeVisible()
  })

  test('missing invite code shows error', async ({ page }) => {
    await page.goto('/onboarding')
    await expect(page.getByText(/no invite code/i)).toBeVisible({ timeout: 10000 })
  })

  test('admin can see pending invites and revoke them', async ({ page }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Volunteers' }).click()
    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible()

    // Create an invite
    const volName = `Revoke ${Date.now()}`
    const volPhone = uniquePhone()

    await page.getByRole('button', { name: /invite/i }).click()
    const form = page.locator('form')
    await form.locator('input').first().fill(volName)
    await form.locator('input[type="tel"]').fill(volPhone)
    await page.getByRole('button', { name: /create invite/i }).click()

    // Close the invite link card
    await page.getByRole('button', { name: /close/i }).click()

    // Pending invites section should show our invite
    await expect(page.getByText(volName)).toBeVisible()

    // Revoke it — find the paragraph with the volunteer name, then go up to the parent container
    const inviteEntry = page.locator('p').filter({ hasText: volName }).locator('..').locator('..')
    await inviteEntry.getByRole('button', { name: /revoke/i }).click()

    // Invite should be removed
    await expect(page.locator('main').getByText(volName)).not.toBeVisible({ timeout: 5000 })
  })
})
