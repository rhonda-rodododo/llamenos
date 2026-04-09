import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const TEST_SECRET =
  process.env.DEV_RESET_SECRET || process.env.E2E_TEST_SECRET || 'test-reset-secret'

test.describe('Voicemail UI', () => {
  test.describe.configure({ mode: 'serial' })

  test('voicemail badge appears in calls list UI when hasVoicemail is true', async ({
    adminPage,
  }) => {
    const callSid = `CA_test_vm_ui_${Date.now()}`

    // Seed a call record directly against the admin's active hub via the
    // dev test endpoint. Previously this test drove the full Twilio webhook
    // simulation (/telephony/incoming → /language-selected → /voicemail-
    // recording → /call-status), but under parallel worker execution
    // /telephony/incoming's hub resolution races against multi-hub.spec.ts
    // — while that file is mid-create-then-archive there are briefly two
    // `active` hubs, the sole-active-hub fallback fails, and the call lands
    // in the `global` hub fallback where the hub-scoped /calls UI can't see
    // it. The webhook flow is covered by the API E2E suite; this test only
    // needs a deterministic voicemail-flagged call record in the hub the
    // admin is actually viewing.
    const configResp = await adminPage.evaluate(() => fetch('/api/config').then((r) => r.json()))
    const hubId = configResp.defaultHubId || configResp.hubs?.[0]?.id
    expect(hubId, 'Admin hub must exist').toBeTruthy()

    const seedRes = await fetch(`${BASE_URL}/api/test-seed-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Secret': TEST_SECRET,
      },
      body: JSON.stringify({
        callSid,
        hubId,
        hasVoicemail: true,
        status: 'voicemail',
        callerLast4: '5555',
      }),
    })
    expect(seedRes.ok, `Seed call failed: ${seedRes.status}`).toBe(true)

    // Navigate to calls page and verify UI shows voicemail badge
    await navigateAfterLogin(adminPage, '/calls')
    await expect(adminPage.getByRole('heading', { name: /call history/i })).toBeVisible({
      timeout: 15000,
    })
    await expect(adminPage.locator('[data-testid="call-history-row"]').first()).toBeVisible({
      timeout: 15000,
    })

    // Use voicemail-badge (always rendered when hasVoicemail=true) rather
    // than voicemail-player (may be empty without audio fileId)
    await expect(adminPage.locator('[data-testid="voicemail-badge"]').first()).toBeVisible({
      timeout: 10000,
    })
  })
})
