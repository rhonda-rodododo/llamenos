import { expect, test } from '../fixtures/auth'
import { uniquePhone } from '../helpers'

test.describe('Invite-based onboarding', () => {
  let inviteLink: string

  test('admin creates invite and user completes onboarding', async ({ adminPage, browser }) => {
    // --- Step 1: Admin creates invite ---
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()

    const userName = `Onboard ${Date.now()}`
    const userPhone = uniquePhone()

    await adminPage.getByRole('button', { name: /invite user/i }).click()

    // Wait for the invite form to render
    const nameInput = adminPage.locator('#invite-name')
    await expect(nameInput).toBeVisible({ timeout: 10000 })
    await nameInput.fill(userName)

    // PhoneInput is a complex component — use the input with the invite-phone id
    const phoneInput = adminPage.locator('#invite-phone')
    await expect(phoneInput).toBeVisible({ timeout: 5000 })
    await phoneInput.fill(userPhone)
    await phoneInput.blur()

    await adminPage.getByRole('button', { name: /create invite/i }).click()

    // Invite link should appear
    const linkEl = adminPage.getByTestId('invite-link-code')
    await expect(linkEl).toBeVisible({ timeout: 15000 })
    inviteLink = (await linkEl.textContent())!
    expect(inviteLink).toContain('/onboarding?code=')

    // Close the send invite dialog that auto-opens after creation
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(300)

    // --- Step 2: User opens invite link in a fresh browser context ---
    const userContext = await browser.newContext()
    const page = await userContext.newPage()

    await page.goto(inviteLink)
    await expect(page.getByText(/welcome/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(userName)).toBeVisible()

    // A11y: language selector should be a radiogroup with roving tabindex
    const langGroup = page.locator('[role="radiogroup"]')
    await expect(langGroup).toBeVisible()
    await expect(langGroup.locator('[role="radio"][aria-checked="true"]')).toBeVisible()

    // --- Step 3: Click Get Started ---
    await page.getByRole('button', { name: /get started/i }).click()

    // --- Step 4: Create PIN (6 digits via PIN input, then Enter for 8-box input) ---
    await expect(page.getByText(/create a pin/i)).toBeVisible({ timeout: 5000 })
    for (let i = 0; i < 6; i++) {
      const input = page.locator(`input[aria-label="PIN digit ${i + 1}"]`)
      await input.click()
      await input.pressSequentially(`${(i + 1) % 10}`)
    }
    await page.keyboard.press('Enter')

    // --- Step 5: Confirm PIN ---
    await expect(page.getByText(/confirm your pin/i)).toBeVisible({ timeout: 5000 })
    for (let i = 0; i < 6; i++) {
      const input = page.locator(`input[aria-label="PIN digit ${i + 1}"]`)
      await input.click()
      await input.pressSequentially(`${(i + 1) % 10}`)
    }
    await page.keyboard.press('Enter')

    // --- Step 6: Recovery key page (nsec is NOT shown) ---
    await expect(page.getByText(/save your recovery key/i)).toBeVisible({ timeout: 15000 })
    const recoveryKeyEl = page.getByTestId('recovery-key')
    await expect(recoveryKeyEl).toBeVisible()
    const recoveryKey = await recoveryKeyEl.textContent()
    expect(recoveryKey).toMatch(/^[A-Z2-7]{4}-/)

    // Download backup (mandatory before continue)
    await page.getByRole('button', { name: /download encrypted backup/i }).click()

    // --- Step 7: Acknowledge backup saved ---
    await page.getByText('I have saved my recovery key').click()

    // --- Step 8: Continue to profile setup ---
    await page.getByRole('button', { name: /continue/i }).click()

    // Should land on profile-setup or dashboard
    await page.waitForURL(
      (url) => {
        const path = new URL(url.toString()).pathname
        return path === '/profile-setup' || path === '/'
      },
      { timeout: 15000 }
    )

    await userContext.close()
  })

  test('invalid invite code shows error', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/onboarding?code=invalidcode123')
    await expect(page.getByText(/invalid invite/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /go to login/i })).toBeVisible()
    await ctx.close()
  })

  test('missing invite code shows error', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto('/onboarding')
    await expect(page.getByText(/no invite code/i)).toBeVisible({ timeout: 10000 })
    await ctx.close()
  })

  test('admin can see pending invites and revoke them', async ({ adminPage }) => {
    await adminPage.getByRole('link', { name: 'Users' }).click()
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible()

    // Create an invite
    const userName = `Revoke ${Date.now()}`
    const userPhone = uniquePhone()

    await adminPage.getByRole('button', { name: /invite user/i }).click()

    // Wait for the invite form to render
    const nameInput = adminPage.locator('#invite-name')
    await expect(nameInput).toBeVisible({ timeout: 10000 })
    await nameInput.fill(userName)

    // PhoneInput is a complex component — use the input with the invite-phone id
    const phoneInput = adminPage.locator('#invite-phone')
    await expect(phoneInput).toBeVisible({ timeout: 5000 })
    await phoneInput.fill(userPhone)
    await phoneInput.blur()

    await adminPage.getByRole('button', { name: /create invite/i }).click()

    // Wait for invite link to appear, then close the send invite dialog
    await expect(adminPage.getByTestId('invite-link-code')).toBeVisible({ timeout: 15000 })
    await adminPage.keyboard.press('Escape')
    await adminPage.waitForTimeout(300)

    // Close the invite link card
    await adminPage.getByTestId('dismiss-invite').click()

    // Pending invites section should show our invite
    await expect(adminPage.getByText(userName)).toBeVisible()

    // Revoke it — find the paragraph with the user name, then go up to the parent container
    const inviteEntry = adminPage
      .locator('p')
      .filter({ hasText: userName })
      .locator('..')
      .locator('..')
    await inviteEntry.getByRole('button', { name: /revoke/i }).click()

    // Invite should be removed
    await expect(adminPage.locator('main').getByText(userName)).not.toBeVisible({ timeout: 5000 })
  })
})
