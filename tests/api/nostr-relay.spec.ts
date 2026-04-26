/**
 * Nostr Relay Event Tests (API-only)
 *
 * Verifies the real-time Nostr relay pipeline:
 *   1. Server publishes encrypted kind 1000 (CALL_RING) events to relay on inbound call
 *   2. Event content is ciphertext (not plaintext JSON)
 *   3. Events carry correct tags: ["t", "llamenos:event"], ["d", "global"]
 *   4. Event can be decrypted using the server event key (derived from SERVER_NOSTR_SECRET)
 *
 * The REST polling fallback test remains in tests/ui/nostr-relay.spec.ts
 * because it requires a browser context (adminPage).
 *
 * Expects: a running Nostr relay reachable at NOSTR_RELAY_URL (dev default 7778, CI 7777),
 *          SERVER_NOSTR_SECRET set, USE_TEST_ADAPTER=true for telephony.
 */

import { expect, test } from '@playwright/test'
import WebSocket from 'ws'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

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

/**
 * Find the KIND_CALL_RING event in the collector whose decrypted plaintext
 * `callSid` equals `expectedCallSid`.
 *
 * Why this exists: KIND_CALL_RING (1000) is in the NIP-01 *regular* range, so
 * strfry persists every ring event. The subscription `since` filter in
 * {@link subscribeToRelay} has 1-second resolution, so a subscription opened
 * in the same wall-clock second as a previous test's event will have that
 * previous event replayed to it. Under the shared test server, other spec
 * files that hit `/telephony/incoming` also publish ring events into the same
 * relay. The reliable way to pick "this test's event" out of the collector is
 * to decrypt each candidate and match on the plaintext callSid — a stable
 * per-test discriminator that can never collide.
 *
 * Returns `undefined` if no event with the matching callSid is present.
 */
type CollectedEvent = { kind: number; content: string; tags: string[][] }
type DecryptedCallRing = { event: CollectedEvent; plaintext: Record<string, unknown> }

async function findOwnCallRingEvent(
  events: CollectedEvent[],
  eventKey: Uint8Array,
  expectedCallSid: string,
  decryptFn: (ct: string, key: Uint8Array) => Promise<Record<string, unknown> | null>
): Promise<DecryptedCallRing | undefined> {
  for (const event of events) {
    if (event.kind !== KIND_CALL_RING) continue
    const plaintext = await decryptFn(event.content, eventKey)
    if (plaintext && plaintext.callSid === expectedCallSid) {
      return { event, plaintext }
    }
  }
  return undefined
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
    const adminApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    await adminApi.put('/api/settings/fallback-group', { pubkeys: [adminApi.pubkey] })
  })

  test.afterEach(async ({ request }) => {
    while (pendingCallSids.length > 0) {
      const sid = pendingCallSids.pop()
      if (sid) await hangupTestCall(request, sid)
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
    const { deriveServerEventKey, decryptHubEvent } = await import(
      '../../src/server/lib/hub-event-crypto'
    )
    const eventKey = deriveServerEventKey(SERVER_NOSTR_SECRET)
    const deadline = Date.now() + 3000
    while (
      (await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)) ===
        undefined &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const own = await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)
    expect(
      own,
      `Expected a KIND_CALL_RING event matching this test's callSid (${callSid}) on relay after inbound call`
    ).toBeDefined()
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

    const { deriveServerEventKey, decryptHubEvent } = await import(
      '../../src/server/lib/hub-event-crypto'
    )
    const eventKey = deriveServerEventKey(SERVER_NOSTR_SECRET)

    const deadline = Date.now() + 3000
    while (
      (await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)) ===
        undefined &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const own = await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)
    expect(own, `Expected a KIND_CALL_RING event matching callSid ${callSid}`).toBeDefined()

    // Content must NOT be parseable as JSON (it's hex-encoded ciphertext)
    let isPlaintext = false
    try {
      JSON.parse(own!.event.content)
      isPlaintext = true
    } catch {
      // Good — not JSON
    }
    expect(isPlaintext, 'Event content must be ciphertext, not plaintext JSON').toBe(false)

    // Content should be valid hex (XChaCha20 nonce || ciphertext)
    expect(
      isValidHex(own!.event.content),
      `Expected hex ciphertext, got: ${own!.event.content.slice(0, 40)}...`
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

    const { deriveServerEventKey, decryptHubEvent } = await import(
      '../../src/server/lib/hub-event-crypto'
    )
    const eventKey = deriveServerEventKey(SERVER_NOSTR_SECRET)

    const deadline = Date.now() + 3000
    while (
      (await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)) ===
        undefined &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const own = await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)
    expect(own, `Expected a KIND_CALL_RING event matching callSid ${callSid}`).toBeDefined()

    const tagMap = Object.fromEntries(own!.event.tags.map((t) => [t[0], t[1]]))
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

    const { deriveServerEventKey, decryptHubEvent } = await import(
      '../../src/server/lib/hub-event-crypto'
    )
    const eventKey = deriveServerEventKey(SERVER_NOSTR_SECRET)

    const deadline = Date.now() + 3000
    while (
      (await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)) ===
        undefined &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const own = await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)
    expect(own, `Expected a decryptable CALL_RING event matching callSid ${callSid}`).toBeDefined()
    expect(own!.plaintext.type, 'Decrypted event must have type "call:ring"').toBe('call:ring')
    expect(own!.plaintext.callSid, 'Decrypted event must contain the callSid').toBe(callSid)
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

    const { deriveServerEventKey, decryptHubEvent } = await import(
      '../../src/server/lib/hub-event-crypto'
    )
    const eventKey = deriveServerEventKey(SERVER_NOSTR_SECRET)

    const deadline = Date.now() + 3000
    while (
      (await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)) ===
        undefined &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100))
    }

    ws.close()

    const own = await findOwnCallRingEvent(collectedEvents, eventKey, callSid, decryptHubEvent)
    expect(own, `Expected a KIND_CALL_RING event matching callSid ${callSid}`).toBeDefined()

    // Without the key, content must not contain any semantic information
    expect(own!.event.content).not.toContain('call:ring')
    expect(own!.event.content).not.toContain('callSid')
    expect(own!.event.content).not.toContain(callSid)

    // All events carry the same generic tag — cannot distinguish types
    const tTag = own!.event.tags.find((t) => t[0] === 't')
    expect(tTag?.[1]).toBe('llamenos:event')
  })
})
