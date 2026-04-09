import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

/**
 * Build a Twilio-style application/x-www-form-urlencoded body string.
 */
function twilioForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

test.describe('Voicemail UI', () => {
  test.describe.configure({ mode: 'serial' })

  test('voicemail badge appears in calls list UI when hasVoicemail is true', async ({
    adminPage,
    request,
  }) => {
    const callSid = `CA_test_vm_ui_${Date.now()}`

    // Force voicemailMode=always so the /telephony/language-selected handler
    // takes the voicemail path (upsertCallRecord) regardless of whether
    // parallel-worker tests have put users on shift. Without this, `auto`
    // mode skips the voicemail path whenever `hasAvailableUsers` is true,
    // and the call record is never created — leaving the history lookup
    // unable to find this test's callSid. Settings are platform-scoped
    // (mounted at `/api/settings`, not under `/api/hubs/:hubId/settings`);
    // hub-specific rows fall back to the global row, so writing global
    // `voicemailMode: 'always'` is sufficient to force the voicemail
    // branch for the test's hub regardless of whether it has its own row.
    const patchResult = await adminPage.evaluate(async () => {
      type AuthFacade = { getAccessToken(): string | null }
      const facade = (window as Record<string, unknown>).__TEST_AUTH_FACADE as
        | AuthFacade
        | undefined
      const token = facade?.getAccessToken()
      if (!token) return { ok: false, status: 0, error: 'no token' }
      const res = await fetch('/api/settings/call', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ voicemailMode: 'always' }),
      })
      const body = await res.text().catch(() => '')
      return { ok: res.ok, status: res.status, body: body.slice(0, 200) }
    })
    expect(patchResult.ok, `Failed to set voicemailMode: ${JSON.stringify(patchResult)}`).toBe(true)

    // Step 1: Simulate incoming call
    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        From: '+15554445555',
        To: '+15556667777',
        CallStatus: 'ringing',
        Direction: 'inbound',
      }),
    })
    expect(incomingRes.status()).toBe(200)

    // Step 1b: Simulate language selection — this triggers voicemail mode check
    // and creates a call record with hub context for the recording callback
    const langRes = await request.post('/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        From: '+15554445555',
        Digits: '',
        CallStatus: 'in-progress',
      }),
    })
    expect(langRes.status()).toBe(200)

    // Step 2: Simulate voicemail recording — await response to ensure
    // the handler's synchronous DB write (hasVoicemail=true) completes.
    const vmRes = await request.post(`/telephony/voicemail-recording?callSid=${callSid}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        RecordingStatus: 'completed',
        RecordingSid: `RE_ui_${Date.now()}`,
        CallSid: callSid,
      }),
    })
    expect(vmRes.status()).toBe(200)

    // Step 3: Wait for voicemail DB write to be fully committed, then
    // complete the call. The delay prevents a race where call-status
    // deletes the active call before the voicemail handler reads hubId.
    await adminPage.waitForTimeout(2000)

    const statusRes = await request.post('/telephony/call-status', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        CallStatus: 'completed',
        From: '+15554445555',
        To: '+15556667777',
        Duration: '30',
      }),
    })
    expect(statusRes.status()).toBe(200)

    // Step 4: Verify via authed browser fetch that hasVoicemail is set.
    // This confirms the DB state before we check the UI.
    // Uses the SPA's auth token and hub-scoped endpoint so the request is
    // authenticated and queries the correct hub.
    // Retry up to 5 times — parallel CI workers may delay DB commits or
    // other tests may temporarily hold locks on the calls table.
    await adminPage.waitForTimeout(3000)
    let apiCheck: {
      ok: boolean
      found?: boolean
      hasVoicemail?: boolean
      status?: number
      error?: string
    } = { ok: false }
    for (let attempt = 0; attempt < 5; attempt++) {
      apiCheck = await adminPage.evaluate(async (sid: string) => {
        type AuthFacade = { getAccessToken(): string | null }
        const facade = (window as Record<string, unknown>).__TEST_AUTH_FACADE as
          | AuthFacade
          | undefined
        const token = facade?.getAccessToken()
        if (!token) return { ok: false, status: 0, error: 'no token' }
        // Resolve active hub ID from config endpoint
        const configRes = await fetch('/api/config')
        if (!configRes.ok) return { ok: false, status: configRes.status, error: 'config failed' }
        const config = await configRes.json()
        const hubId = config.defaultHubId || config.hubs?.[0]?.id
        if (!hubId) return { ok: false, status: 0, error: 'no hub' }
        // Use hub-scoped endpoint matching what the SPA uses
        const res = await fetch(`/api/hubs/${hubId}/calls/history`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return { ok: false, status: res.status }
        const data = await res.json()
        const call = data.calls?.find(
          (c: { id?: string; callSid?: string }) => c.id === sid || c.callSid === sid
        )
        return { ok: true, found: !!call, hasVoicemail: call?.hasVoicemail }
      }, callSid)
      if (apiCheck.ok && apiCheck.found) break
      await adminPage.waitForTimeout(2000)
    }

    // If the API check fails, log diagnostics and skip the UI check
    if (!apiCheck.ok || !apiCheck.found) {
      console.log('API check failed:', JSON.stringify(apiCheck))
      // The call may not have been recorded — this can happen if the
      // test adapter doesn't fully support voicemail recording flow.
      // Fail with a clear message rather than a confusing UI timeout.
      expect(apiCheck.found, `Call ${callSid} not found in history`).toBe(true)
    }
    expect(apiCheck.hasVoicemail, 'Call should have hasVoicemail=true').toBe(true)

    // Step 5: Navigate to calls page and verify UI shows voicemail badge
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
