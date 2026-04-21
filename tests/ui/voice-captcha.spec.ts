import { expect, test } from '../fixtures/auth'
import { gotoAdminPath } from '../helpers/admin-settings'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

/**
 * Voice CAPTCHA E2E tests.
 *
 * These tests exercise the CAPTCHA flow via API requests that simulate
 * telephony webhooks, plus UI tests for the admin settings.
 */
test.describe('Voice CAPTCHA', () => {
  test.describe.configure({ mode: 'serial' })

  // --- Test 5.1: CAPTCHA disabled — call routes directly ---
  test('CAPTCHA disabled — language-selected returns enqueue (no CAPTCHA)', async ({ request }) => {
    const adminApi = createAdminApiFromStorageState(request)
    // Ensure CAPTCHA is disabled (default after reset)
    const spamRes = await adminApi.get('/api/settings/spam')
    expect(spamRes.ok()).toBeTruthy()
    const spam = await spamRes.json()
    expect(spam.voiceCaptchaEnabled).toBe(false)

    // Simulate inbound call webhook (Twilio format)
    const incomingRes = await request.post('/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-nocaptcha-001&From=%2B15551234567&To=%2B15559999999&Digits=2',
    })
    expect(incomingRes.ok()).toBeTruthy()

    const body = await incomingRes.text()
    // Should contain Enqueue (direct to queue) or voicemail (no volunteers on shift).
    // The key assertion is that CAPTCHA Gather is NOT present when CAPTCHA is disabled.
    const hasEnqueue = body.includes('Enqueue')
    const hasVoicemail = body.includes('Record') || body.includes('leave a message')
    expect(hasEnqueue || hasVoicemail).toBeTruthy()
    expect(body).not.toContain('<Gather')
  })

  // --- Test 5.2: CAPTCHA enabled — challenge presented ---
  test('CAPTCHA enabled — language-selected returns CAPTCHA Gather', async ({ request }) => {
    const adminApi = createAdminApiFromStorageState(request)
    // Enable CAPTCHA via API
    const enableRes = await adminApi.patch('/api/settings/spam', { voiceCaptchaEnabled: true })
    expect(enableRes.ok()).toBeTruthy()
    const updated = await enableRes.json()
    expect(updated.voiceCaptchaEnabled).toBe(true)

    // Simulate inbound call
    const callRes = await request.post('/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-captcha-002&From=%2B15551234567&To=%2B15559999999&Digits=2',
    })
    expect(callRes.ok()).toBeTruthy()

    const body = await callRes.text()
    // Should contain Gather for CAPTCHA digits
    expect(body).toContain('Gather')
    expect(body).toContain('numDigits="4"')
    expect(body).toContain('/telephony/captcha')
    // Should NOT contain Enqueue yet
    expect(body).not.toContain('Enqueue')
  })

  // --- Test 5.3: Correct DTMF passes CAPTCHA ---
  test('correct DTMF digits pass CAPTCHA and enqueue call', async ({ request }) => {
    // First generate a challenge by hitting language-selected
    const callRes = await request.post('/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-captcha-003&From=%2B15551234567&To=%2B15559999999&Digits=2',
    })
    expect(callRes.ok()).toBeTruthy()

    // Extract the expected digits from the TwiML response
    const twiml = await callRes.text()
    // Extract CAPTCHA digits — format varies by adapter:
    // TwilioAdapter: ">d, d, d, d.</Say>" — spoken with trailing period
    // TestAdapter: "digits: d, d, d, d</Say>" — spoken with prefix
    const digitMatch = twiml.match(/(\d), (\d), (\d), (\d)/)
    expect(digitMatch).toBeTruthy()
    const expectedDigits = `${digitMatch?.[1]}${digitMatch?.[2]}${digitMatch?.[3]}${digitMatch?.[4]}`

    // Verify it's a 4-digit number (1000-9999)
    expect(Number(expectedDigits)).toBeGreaterThanOrEqual(1000)
    expect(Number(expectedDigits)).toBeLessThanOrEqual(9999)

    // Submit correct CAPTCHA digits
    const captchaRes = await request.post('/telephony/captcha?callSid=test-captcha-003&lang=en', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `CallSid=test-captcha-003&From=%2B15551234567&Digits=${expectedDigits}`,
    })
    expect(captchaRes.ok()).toBeTruthy()

    const captchaBody = await captchaRes.text()
    // CAPTCHA passed — call proceeds to either Enqueue (volunteers on shift)
    // or voicemail Record (no volunteers available). Either outcome proves
    // the CAPTCHA was accepted. The key assertion: no re-gather (retry) and
    // no bare Hangup (rejection without voicemail).
    const passedCaptcha = captchaBody.includes('Enqueue') || captchaBody.includes('Record')
    expect(passedCaptcha).toBeTruthy()
    // Should NOT contain a Gather (CAPTCHA retry prompt)
    expect(captchaBody).not.toContain('Gather')
  })

  // --- Test 5.4: Incorrect DTMF triggers retry, then rejection ---
  test('incorrect DTMF triggers retry then rejection after max attempts', async ({ request }) => {
    const adminApi = createAdminApiFromStorageState(request)
    // Enable CAPTCHA with max attempts of 2
    const settingsRes = await adminApi.patch('/api/settings/spam', {
      voiceCaptchaEnabled: true,
      captchaMaxAttempts: 2,
    })
    expect(settingsRes.ok()).toBeTruthy()

    // Verify settings took effect
    const checkRes = await adminApi.get('/api/settings/spam')
    const spamCheck = await checkRes.json()
    expect(spamCheck.voiceCaptchaEnabled).toBe(true)
    expect(spamCheck.captchaMaxAttempts).toBe(2)

    // Use unique callSid and caller number to avoid rate limiting and stale state
    const callSid = `test-captcha-retry-${Date.now()}`
    const callerNumber = `%2B1555${String(Date.now()).slice(-7)}`

    // Generate challenge — must contain Gather (CAPTCHA active)
    const callRes = await request.post('/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `CallSid=${callSid}&From=${callerNumber}&To=%2B15559999999&Digits=2`,
    })
    expect(callRes.ok()).toBeTruthy()
    const challengeTwiml = await callRes.text()
    expect(challengeTwiml, 'CAPTCHA should be enabled — expecting Gather').toContain('Gather')

    // First wrong attempt — should get retry
    const attempt1 = await request.post(`/telephony/captcha?callSid=${callSid}&lang=en`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `CallSid=${callSid}&From=${callerNumber}&Digits=0000`,
    })
    expect(attempt1.ok()).toBeTruthy()
    const body1 = await attempt1.text()
    // Should be a retry (re-gather)
    expect(body1).toContain('Gather')
    expect(body1).not.toContain('Enqueue')
    expect(body1).not.toContain('Hangup')

    // Second wrong attempt — should get rejection (hangup)
    const attempt2 = await request.post(`/telephony/captcha?callSid=${callSid}&lang=en`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `CallSid=${callSid}&From=${callerNumber}&Digits=0000`,
    })
    expect(attempt2.ok()).toBeTruthy()
    const body2 = await attempt2.text()
    // Should contain hangup (rejected after max attempts)
    expect(body2).toContain('Hangup')
    expect(body2).not.toContain('Enqueue')
    expect(body2).not.toContain('Gather')
  })

  // --- Test 5.5: Expired challenge rejects ---
  test('expired challenge returns rejection', async ({ request }) => {
    // Submit CAPTCHA for a callSid that was never generated (simulates expiry)
    const captchaRes = await request.post(
      '/telephony/captcha?callSid=test-captcha-expired&lang=en',
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: 'CallSid=test-captcha-expired&From=%2B15551234567&Digits=1234',
      }
    )
    expect(captchaRes.ok()).toBeTruthy()

    const body = await captchaRes.text()
    // Should reject (no stored challenge = expired)
    expect(body).toContain('Hangup')
    expect(body).not.toContain('Enqueue')
  })

  // --- Admin UI: captchaMaxAttempts setting ---
  test('admin can set captchaMaxAttempts in spam settings UI', async ({ adminPage, request }) => {
    // Navigate via SPA router to preserve crypto worker state (page.goto wipes it)
    await gotoAdminPath(adminPage, '/admin/spam-protection')

    const captchaSwitch = adminPage.getByTestId('admin-spam-protection-captcha-switch')
    await expect(captchaSwitch).toBeVisible({ timeout: 10000 })
    const isChecked = await captchaSwitch.isChecked()
    if (!isChecked) {
      // Toggling opens a confirmation dialog
      await captchaSwitch.click()
      const confirmBtn = adminPage.getByRole('button', { name: /confirm|enable/i })
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click()
      }
      // Wait for save indicator
      await expect(adminPage.getByTestId('admin-spam-protection-save-success')).toBeVisible({
        timeout: 5000,
      })
    }

    // Reveal advanced thresholds panel
    await adminPage.getByTestId('admin-advanced-reveal-spam-protection').click()

    const maxAttemptsInput = adminPage.getByTestId(
      'admin-spam-protection-captcha-max-attempts-input'
    )
    await expect(maxAttemptsInput).toBeVisible({ timeout: 5000 })

    // Change value to 3
    await maxAttemptsInput.clear()
    await maxAttemptsInput.fill('3')
    await maxAttemptsInput.press('Tab') // trigger onChange
    // Wait for the mutation to persist (async save)
    await adminPage.waitForTimeout(1500)

    // Verify it was saved via API
    const adminApi = createAdminApiFromStorageState(request)
    const spamRes = await adminApi.get('/api/settings/spam')
    const spam = await spamRes.json()
    expect(spam.captchaMaxAttempts).toBe(3)

    // Cleanup: disable CAPTCHA
    await adminApi.patch('/api/settings/spam', { voiceCaptchaEnabled: false })
  })
})
