/**
 * Nostr Relay Event Tests
 *
 * Verifies the real-time Nostr relay pipeline:
 *   1. Server publishes encrypted kind 1000 (CALL_RING) events to relay on inbound call
 *   2. Event content is ciphertext (not plaintext JSON)
 *   3. Events carry correct tags: ["t", "llamenos:event"], ["d", "global"]
 *   4. Event can be decrypted using the server event key (derived from SERVER_NOSTR_SECRET)
 *   5. REST polling fallback works when relay is unreachable
 *
 * Expects: a running Nostr relay reachable at NOSTR_RELAY_URL (dev default 7778, CI 7777),
 *          SERVER_NOSTR_SECRET set, USE_TEST_ADAPTER=true for telephony.
 */

import WebSocket from 'ws'
import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'
import { createAdminApiFromStorageState } from '../helpers/authed-request'

// Force the whole file to run on a single worker. The Call-ring and
// REST-polling describes both drive /telephony/incoming against the same
// shared server state; letting Playwright schedule them on different workers
// (they are independent top-level describes) lets the two describes race and
// leaves the Call-ring tests flaky under CI load.
test.describe.configure({ mode: 'serial' })

const RELAY_URL = process.env.NOSTR_RELAY_URL || 'ws://localhost:7778'
// Default matches the value baked into playwright.config.ts webServer env and
// the TEST_SERVER_NOSTR_SECRET constant in .github/workflows/ci.yml. The
// decrypt test needs to run against the same secret the server was started
// with; the CI "Run UI E2E tests" step does not re-export SERVER_NOSTR_SECRET
// to the test runner process, so without this fallback the decrypt test fails
// every run with "SERVER_NOSTR_SECRET must be set in the test env".
const SERVER_NOSTR_SECRET =
  process.env.SERVER_NOSTR_SECRET ??
  '0000000000000000000000000000000000000000000000000000000000000001'

/** Kind 1000 — incoming call ring (from @shared/nostr-events) */
const KIND_CALL_RING = 1000

/**
 * Subscribe to relay and collect events matching the filter.
 * Returns a cleanup function. Events are pushed to the `events` array.
 *
 * KIND_CALL_RING (1000) is in the NIP-01 regular (persisted) range, so strfry
 * replays every historical ring event to a new subscriber. To avoid picking up
 * events from earlier tests in the same file, the default filter includes a
 * `since` of "now" (seconds) so only events published after subscription flow
 * into the collector.
 */
function subscribeToRelay(
  events: Array<{ kind: number; content: string; tags: string[][] }>,
  filter: Record<string, unknown>
): WebSocket {
  const subId = `test-${Date.now()}`
  const ws = new WebSocket(RELAY_URL)
  const defaultedFilter = { since: Math.floor(Date.now() / 1000), ...filter }

  ws.on('open', () => {
    ws.send(JSON.stringify(['REQ', subId, defaultedFilter]))
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as unknown[]
      if (Array.isArray(msg) && msg[0] === 'EVENT' && msg[2]) {
        const event = msg[2] as { kind: number; content: string; tags: string[][] }
        events.push(event)
      }
    } catch {
      // ignore malformed
    }
  })

  return ws
}

/** Decode hex string (returns null if invalid hex) */
function isValidHex(s: string): boolean {
  return /^[0-9a-f]+$/i.test(s) && s.length >= 48 // at least 24-byte nonce
}

function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

// ─────────────────────────────────────────────────────────────────────────────
// Call ring event publishing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hang up a test-simulated call via the Twilio-compatible status webhook so
 * the call does not linger in the server's active-calls cache and collide
 * with later call-flow/multi-hub tests that expect a single incoming call.
 *
 * The `/telephony/call-status` handler reads the call to end from the
 * `parentCallSid` URL query param (that is what TelephonyAdapter wires into
 * the StatusCallback URL when it places the leg), not from the form body, so
 * the cleanup request must encode the sid in the query string.
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

test.describe('Call ring Nostr events', () => {
  test.describe.configure({ mode: 'serial' })

  // Track callSids created during the describe so afterEach can hang them up.
  const pendingCallSids: string[] = []

  test.beforeAll(async ({ request }) => {
    // Set admin as fallback ring group so calls trigger ringing + events
    const adminApi = createAdminApiFromStorageState(request)
    await adminApi.put('/api/settings/fallback-group', { pubkeys: [adminApi.pubkey] })
  })

  test.afterEach(async ({ request }) => {
    while (pendingCallSids.length > 0) {
      const sid = pendingCallSids.pop()
      if (sid) await hangupTestCall(request, sid)
    }
  })

  test.beforeEach(async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/')

    // Inject authedFetch for API calls
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

    // Set up fallback group so calls proceed
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
  })

  test('server publishes kind 1000 event to relay on inbound call', async ({ request }) => {
    const callSid = `CA_nostr_ring_${Date.now()}`
    pendingCallSids.push(callSid)
    const collectedEvents: Array<{ kind: number; content: string; tags: string[][] }> = []

    // Subscribe BEFORE triggering the call
    const ws = subscribeToRelay(collectedEvents, {
      kinds: [KIND_CALL_RING],
      '#t': ['llamenos:event'],
    })

    // Wait for subscription to be established
    await new Promise((r) => setTimeout(r, 500))

    // Step 1: incoming call
    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: '+15551110001',
        To: '+15559998888',
        CallStatus: 'ringing',
        Direction: 'inbound',
      }),
    })

    expect(incomingRes.status()).toBe(200)

    // Step 2: language selected → triggers startParallelRinging → publishes Nostr event
    const langRes = await request.post('/telephony/language-selected?forceLang=en', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: '+15551110001',
        Digits: '1',
      }),
    })

    expect(langRes.status()).toBe(200)

    // Wait up to 3s for event to arrive
    const deadline = Date.now() + 3000
    while (
      collectedEvents.filter((e) => e.kind === KIND_CALL_RING).length === 0 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const ringEvents = collectedEvents.filter((e) => e.kind === KIND_CALL_RING)
    expect(
      ringEvents.length,
      'Expected at least one KIND_CALL_RING event on relay after inbound call'
    ).toBeGreaterThan(0)
  })

  test('call ring event content is ciphertext (not plaintext)', async ({ request }) => {
    const callSid = `CA_nostr_enc_${Date.now()}`
    pendingCallSids.push(callSid)
    const collectedEvents: Array<{ kind: number; content: string; tags: string[][] }> = []

    const ws = subscribeToRelay(collectedEvents, {
      kinds: [KIND_CALL_RING],
      '#t': ['llamenos:event'],
    })
    await new Promise((r) => setTimeout(r, 500))

    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: '+15551110002',
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
        From: '+15551110002',
        Digits: '1',
      }),
    })

    const deadline = Date.now() + 3000
    while (
      collectedEvents.filter((e) => e.kind === KIND_CALL_RING).length === 0 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const ringEvent = collectedEvents.find((e) => e.kind === KIND_CALL_RING)
    expect(ringEvent, 'Expected a KIND_CALL_RING event on relay').toBeDefined()

    // Content must NOT be parseable as JSON (it's hex-encoded ciphertext)
    let isPlaintext = false
    try {
      JSON.parse(ringEvent!.content)
      isPlaintext = true
    } catch {
      // Good — not JSON
    }
    expect(isPlaintext, 'Event content must be ciphertext, not plaintext JSON').toBe(false)

    // Content should be valid hex (XChaCha20 nonce || ciphertext)
    expect(
      isValidHex(ringEvent!.content),
      `Expected hex ciphertext, got: ${ringEvent!.content.slice(0, 40)}...`
    ).toBe(true)
  })

  test('call ring event has correct tags', async ({ request }) => {
    const callSid = `CA_nostr_tags_${Date.now()}`
    pendingCallSids.push(callSid)
    const collectedEvents: Array<{ kind: number; content: string; tags: string[][] }> = []

    const ws = subscribeToRelay(collectedEvents, {
      kinds: [KIND_CALL_RING],
      '#t': ['llamenos:event'],
    })
    await new Promise((r) => setTimeout(r, 500))

    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: '+15551110003',
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
        From: '+15551110003',
        Digits: '1',
      }),
    })

    const deadline = Date.now() + 3000
    while (
      collectedEvents.filter((e) => e.kind === KIND_CALL_RING).length === 0 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const ringEvent = collectedEvents.find((e) => e.kind === KIND_CALL_RING)
    expect(ringEvent, 'Expected a KIND_CALL_RING event on relay').toBeDefined()

    const tagMap = Object.fromEntries(ringEvent!.tags.map((t) => [t[0], t[1]]))
    expect(tagMap.t, 'Expected "llamenos:event" tag').toBe('llamenos:event')
    // Hub ID is either "global" (no hub setup) or "default-hub" (after test-reset creates default hub)
    expect(tagMap.d, 'Expected hub ID in d tag').toBeTruthy()
  })

  test('call ring event decrypts correctly with SERVER_NOSTR_SECRET', async ({ request }) => {
    const callSid = `CA_nostr_dec_${Date.now()}`
    pendingCallSids.push(callSid)
    const collectedEvents: Array<{ kind: number; content: string; tags: string[][] }> = []

    const ws = subscribeToRelay(collectedEvents, {
      kinds: [KIND_CALL_RING],
      '#t': ['llamenos:event'],
    })
    await new Promise((r) => setTimeout(r, 500))

    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: '+15551110004',
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
        From: '+15551110004',
        Digits: '1',
      }),
    })

    const deadline = Date.now() + 3000
    while (
      collectedEvents.filter((e) => e.kind === KIND_CALL_RING).length === 0 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const ringEvent = collectedEvents.find((e) => e.kind === KIND_CALL_RING)
    expect(ringEvent, 'Expected a KIND_CALL_RING event on relay').toBeDefined()

    // Derive server event key and decrypt
    const { deriveServerEventKey, decryptHubEvent } = await import(
      '../../src/server/lib/hub-event-crypto'
    )
    const eventKey = deriveServerEventKey(SERVER_NOSTR_SECRET)
    const decrypted = decryptHubEvent(ringEvent!.content, eventKey)

    expect(decrypted, 'Event content must decrypt to a valid object').not.toBeNull()
    expect(decrypted?.type, 'Decrypted event must have type "call:ring"').toBe('call:ring')
    expect(decrypted?.callSid, 'Decrypted event must contain the callSid').toBe(callSid)
  })

  test('unauthenticated subscriber cannot determine event type from content', async ({
    request,
  }) => {
    const callSid = `CA_nostr_opaque_${Date.now()}`
    pendingCallSids.push(callSid)
    const collectedEvents: Array<{ kind: number; content: string; tags: string[][] }> = []

    const ws = subscribeToRelay(collectedEvents, {
      kinds: [KIND_CALL_RING],
      '#t': ['llamenos:event'],
    })
    await new Promise((r) => setTimeout(r, 500))

    const incomingRes = await request.post('/telephony/incoming', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formEncode({
        CallSid: callSid,
        From: '+15551110005',
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
        From: '+15551110005',
        Digits: '1',
      }),
    })

    const deadline = Date.now() + 3000
    while (
      collectedEvents.filter((e) => e.kind === KIND_CALL_RING).length === 0 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const ringEvent = collectedEvents.find((e) => e.kind === KIND_CALL_RING)
    expect(ringEvent, 'Expected a KIND_CALL_RING event on relay').toBeDefined()

    // Without the key, content must not contain any semantic information
    expect(ringEvent!.content).not.toContain('call:ring')
    expect(ringEvent!.content).not.toContain('callSid')
    expect(ringEvent!.content).not.toContain(callSid)

    // All events carry the same generic tag — cannot distinguish types
    const tTag = ringEvent!.tags.find((t) => t[0] === 't')
    expect(tTag?.[1]).toBe('llamenos:event')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: REST polling fallback (no relay required)
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
