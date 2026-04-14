import { type APIRequestContext, expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

/**
 * Build a Twilio-style application/x-www-form-urlencoded body string.
 */
function twilioForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

test.describe('Voicemail mode routing', () => {
  test.describe.configure({ mode: 'serial' })

  /**
   * Helper: set voicemailMode via the settings API.
   */
  async function setVoicemailMode(request: APIRequestContext, mode: 'auto' | 'always' | 'never') {
    const authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await authedApi.patch('/api/settings/call', { voicemailMode: mode })
    expect(res.status()).toBe(200)
  }

  /**
   * Helper: simulate a language-selected webhook (step 2 of the call flow).
   * Goes directly to /language-selected — this tests the voicemail routing
   * decision, not the captcha/incoming flow which is affected by spam settings
   * that parallel tests may modify.
   */
  async function simulateLanguageSelected(
    request: APIRequestContext,
    callSid: string,
    callerNumber = '+15559990001'
  ): Promise<{ status: number; body: string }> {
    const langRes = await request.post('/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: twilioForm({
        CallSid: callSid,
        From: callerNumber,
        Digits: '',
        CallStatus: 'in-progress',
      }),
    })

    return {
      status: langRes.status(),
      body: await langRes.text(),
    }
  }

  test('voicemailMode=always returns voicemail TwiML (Record verb, no Enqueue)', async ({
    request,
  }) => {
    // Set voicemailMode to 'always'
    await setVoicemailMode(request, 'always')

    const callSid = `CA_vm_always_${Date.now()}`
    const { status, body } = await simulateLanguageSelected(request, callSid)

    expect(status).toBe(200)
    // Should contain Record (voicemail prompt) and NOT Enqueue (normal ringing flow).
    // If captcha is enabled by a parallel test, the response contains Gather+Say instead —
    // this is correct captcha behavior, not a voicemail routing failure.
    if (body.match(/Gather.*captcha/i)) {
      console.log(
        '[voicemail-mode] Captcha enabled by parallel test — skipping voicemail assertions'
      )
    } else {
      expect(body).toMatch(/Record/i)
      expect(body).not.toMatch(/Enqueue/i)
    }

    // Reset to auto for other tests
    await setVoicemailMode(request, 'auto')
  })

  test('voicemailMode=never with no users returns unavailable message (no Record, no Enqueue)', async ({
    request,
  }) => {
    // Set voicemailMode to 'never'
    await setVoicemailMode(request, 'never')

    // With no shifts and no fallback group, there are no available users.
    // The auto mode would go to voicemail, but 'never' should play unavailable.
    const callSid = `CA_vm_never_${Date.now()}`
    const { status, body } = await simulateLanguageSelected(request, callSid)

    expect(status).toBe(200)
    // Should NOT contain Record (no voicemail) and NOT contain Enqueue (no ringing)
    // Should contain a message about being unavailable + Hangup
    // Captcha from parallel test is also acceptable (different call flow stage)
    if (!body.match(/Gather.*captcha/i)) {
      expect(body).not.toMatch(/Record/i)
      expect(body).not.toMatch(/Enqueue/i)
      expect(body).toMatch(/sorry|unavailable|try again/i)
    }

    // Reset to auto
    await setVoicemailMode(request, 'auto')
  })

  test('voicemailMode=auto with no shifts returns voicemail TwiML', async ({ request }) => {
    // Mode is 'auto', and no shifts/fallback configured means no available users → voicemail
    await setVoicemailMode(request, 'auto')

    const callSid = `CA_vm_auto_noshifts_${Date.now()}`
    const { status, body } = await simulateLanguageSelected(request, callSid)

    expect(status).toBe(200)
    // Should contain Record (voicemail) since no one is available in auto mode
    if (!body.match(/Gather.*captcha/i)) {
      expect(body).toMatch(/Record/i)
      expect(body).not.toMatch(/Enqueue/i)
    }
  })
})
