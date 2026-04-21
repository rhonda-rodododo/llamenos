/**
 * Nostr Relay — REST polling fallback (UI test)
 *
 * Verifies that the dashboard can discover active calls via REST polling
 * when the Nostr relay WebSocket is unreachable. This test requires a
 * browser context (adminPage) to block WebSocket routes and evaluate
 * in-page fetch calls.
 *
 * The API-only relay event tests (publish, encrypt, tags, decrypt) live
 * in tests/api/nostr-relay.spec.ts.
 *
 * Expects: SERVER_NOSTR_SECRET set, USE_TEST_ADAPTER=true for telephony.
 */

import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

/**
 * Hang up a test-simulated call via the Twilio-compatible status webhook so
 * the call does not linger in the server's active-calls cache and collide
 * with later call-flow/multi-hub tests that expect a single incoming call.
 */
async function hangupTestCall(
  request: import('@playwright/test').APIRequestContext,
  callSid: string
): Promise<void> {
  try {
    await request.post(`/telephony/call-status?parentCallSid=${encodeURIComponent(callSid)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({ CallSid: callSid, CallStatus: 'completed' }),
    })
  } catch {
    // cleanup is best-effort — never fail a test because teardown failed
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REST polling fallback (no relay required)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('REST polling fallback when relay unreachable', () => {
  test.describe.configure({ mode: 'serial' })

  const pendingCallSids: string[] = []

  test.afterEach(async ({ request }) => {
    while (pendingCallSids.length > 0) {
      const sid = pendingCallSids.pop()
      if (sid) await hangupTestCall(request, sid)
    }
  })

  test.beforeEach(async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/')
    await adminPage.evaluate(() => {
      window.__authedFetch = async (url: string, options: RequestInit = {}) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...((options.headers as Record<string, string>) || {}),
        }
        const token =
          window.__TEST_AUTH_FACADE?.getAccessToken() ?? sessionStorage.getItem('__TEST_JWT')
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }
        return fetch(url, { ...options, headers })
      }
    })
  })

  test('active call appears via REST polling when Nostr relay is blocked', async ({
    adminPage,
    request,
  }) => {
    // Block WebSocket connections to the relay — forces REST polling path
    await adminPage.route(/ws:\/\/.*:77[0-9]{2}/, (route) => route.abort())

    // Set up fallback group
    const adminPubkey = await adminPage.evaluate(() => {
      const km = (window as any).__TEST_KEY_MANAGER
      return km?.getPublicKeyHex?.() ?? null
    })
    if (adminPubkey) {
      await adminPage.evaluate(async (pubkey: string) => {
        await window.__authedFetch?.('/api/settings/fallback-group', {
          method: 'PUT',
          body: JSON.stringify({ pubkeys: [pubkey] }),
        })
      }, adminPubkey)
    }

    const callSid = `CA_rest_fallback_${Date.now()}`
    pendingCallSids.push(callSid)

    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: '+15551119999',
        To: '+15559998888',
        CallStatus: 'ringing',
        Direction: 'inbound',
      }),
    })

    expect(incomingRes.status()).toBe(200)

    await request.post('/telephony/language-selected?forceLang=en', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: '+15551119999',
        Digits: '1',
      }),
    })

    // Poll REST API for call appearance (simulating what the dashboard does)
    let callFound = false
    const deadline = Date.now() + 15_000
    while (!callFound && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000))
      callFound = await adminPage.evaluate(async (sid: string) => {
        const res = await window.__authedFetch?.('/api/calls/active')
        const data = (await res.json()) as { calls?: Array<{ id: string }> }
        return (data.calls ?? []).some((c) => c.id === sid)
      }, callSid)
    }

    expect(callFound, 'Active call should appear via REST polling within 15s').toBe(true)
  })
})
