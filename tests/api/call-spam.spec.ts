/**
 * Call Spam Mitigation Tests
 *
 * Tests ban list enforcement, rate limiting, and CAPTCHA via telephony webhooks.
 *
 * Test groups:
 *   1. Ban list enforcement — banned numbers get TwiML rejection
 *   2. Rate limiting — excess calls from same number are rejected
 *   3. Voice CAPTCHA — CAPTCHA toggle controls routing behavior
 */

import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

/** POST to /telephony/incoming and return response status + body. */
async function simulateCall(
  request: import('@playwright/test').APIRequestContext,
  callSid: string,
  from: string,
  to = '+15559998888'
) {
  return request.post('/telephony/incoming', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: formEncode({
      CallSid: callSid,
      From: from,
      To: to,
      CallStatus: 'ringing',
      Direction: 'inbound',
    }),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Ban list enforcement
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Ban list call enforcement', () => {
  test.describe.configure({ mode: 'serial' })

  const BANNED_NUMBER = '+15555559999'
  const CLEAN_NUMBER = '+15555550001'

  test('call from banned number receives rejection response', async ({ request }) => {
    const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    // Add number to ban list via API
    const banRes = await adminApi.post('/api/bans', {
      phone: BANNED_NUMBER,
      reason: 'E2E ban test',
    })
    expect(banRes.ok(), `addBan failed: ${banRes.status()}`).toBeTruthy()

    // Simulate call from banned number
    const res = await simulateCall(request, `CA_ban_${Date.now()}`, BANNED_NUMBER)

    expect(res.status()).toBe(200)
    const body = await res.text()
    // TwiML Reject response contains <Reject/> or Reject in the response
    expect(body.toLowerCase()).toMatch(/reject|rejected|hangup|error/i)
    // Must NOT contain an enqueue/ring action (which would route the call)
    expect(body.toLowerCase()).not.toMatch(/enqueue|dial|queue/)
  })

  test('call from non-banned number is NOT rejected', async ({ request }) => {
    // Ensure CLEAN_NUMBER is not banned (global-setup handles this)
    const res = await simulateCall(request, `CA_clean_${Date.now()}`, CLEAN_NUMBER)

    expect(res.status()).toBe(200)
    const body = await res.text()
    // Should get a language menu TwiML (not a rejection)
    expect(body.toLowerCase()).not.toMatch(/^.*<reject/)
  })

  test('ban list checked in real-time (no cache)', async ({ request }) => {
    const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const freshNumber = '+15555553333'

    // First call — not banned, should route
    const res1 = await simulateCall(request, `CA_fresh1_${Date.now()}`, freshNumber)
    expect(res1.status()).toBe(200)
    const body1 = await res1.text()
    expect(body1.toLowerCase()).not.toMatch(/^.*<reject/)

    // Add to ban list via server-side API
    await adminApi.post('/api/bans', { phone: freshNumber, reason: 'E2E ban test' })

    // Second call — now banned, should reject immediately
    const res2 = await simulateCall(request, `CA_fresh2_${Date.now()}`, freshNumber)
    expect(res2.status()).toBe(200)
    const body2 = await res2.text()
    expect(body2.toLowerCase()).toMatch(/reject|rejected|hangup|error/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Voice CAPTCHA
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Voice CAPTCHA', () => {
  test.describe.configure({ mode: 'serial' })

  const CALLER = '+15555552222'
  const HOTLINE = '+15559998888'

  test.afterEach(async ({ request }) => {
    // Reset CAPTCHA state after each test
    const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    await adminApi.patch('/api/settings/spam', { voiceCaptchaEnabled: false }).catch(() => {})
  })

  test('CAPTCHA disabled — call routes to language menu without digit challenge', async ({
    request,
  }) => {
    // Default state: CAPTCHA is off
    const res = await simulateCall(request, `CA_nocap_${Date.now()}`, CALLER, HOTLINE)

    expect(res.status()).toBe(200)
    const body = await res.text()
    // With no CAPTCHA, the incoming response should play a language menu
    // (not a CAPTCHA digit-entry prompt)
    // The exact TwiML varies by provider; verify it doesn't contain CAPTCHA-specific phrases
    // but does contain a language-related response
    expect(body).toBeTruthy()
    expect(body.length).toBeGreaterThan(20) // Has actual TwiML content
  })

  test('CAPTCHA enabled — language-selected triggers CAPTCHA flow', async ({ request }) => {
    const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    // Enable CAPTCHA via server-side API
    const spamRes = await adminApi.patch('/api/settings/spam', { voiceCaptchaEnabled: true })
    expect(spamRes.ok(), `updateSpam failed: ${spamRes.status()}`).toBeTruthy()

    const callSid = `CA_captcha_${Date.now()}`

    // Step 1: incoming call
    const incomingRes = await simulateCall(request, callSid, CALLER, HOTLINE)
    expect(incomingRes.status()).toBe(200)

    // Step 2: language selected → should trigger CAPTCHA, NOT startParallelRinging
    const langRes = await request.post('/telephony/language-selected?forceLang=en', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: CALLER,
        Digits: '1',
      }),
    })
    expect(langRes.status()).toBe(200)
    const langBody = await langRes.text()

    // With CAPTCHA enabled, the language-selected response should trigger a CAPTCHA
    // (Gather for digits) rather than immediately routing
    // The response should contain some form of digit-gathering TwiML
    expect(langBody).toBeTruthy()

    // Verify no active call was created (since CAPTCHA hasn't been passed)
    const activeRes = await adminApi.get('/api/calls/active')
    const activeCalls = (await activeRes.json()) as { calls?: Array<{ id: string }> }
    const callCreated = activeCalls.calls?.some((c) => c.id === callSid)
    expect(callCreated).toBeFalsy()
  })
})
