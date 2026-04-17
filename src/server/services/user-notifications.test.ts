import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { Ciphertext } from '../../shared/crypto-types'
import type { AuthEventsService } from './auth-events'
import type { SecurityPrefsService } from './security-prefs'
import type { SignalContactsService } from './signal-contacts'
import {
  UserNotificationsService,
  formatDisappearingTimerSeconds,
  renderAlertMessage,
} from './user-notifications'

describe('user-notifications formatters', () => {
  test('formatDisappearingTimerSeconds converts days to seconds', () => {
    expect(formatDisappearingTimerSeconds(1)).toBe(86400)
    expect(formatDisappearingTimerSeconds(7)).toBe(7 * 86400)
  })

  test('renderAlertMessage for new_device includes city', () => {
    const msg = renderAlertMessage({
      type: 'new_device',
      city: 'Berlin',
      country: 'DE',
      userAgent: 'Firefox on macOS',
    })
    expect(msg).toContain('Berlin')
    expect(msg).toContain('Firefox')
  })

  test('renderAlertMessage for passkey_added includes label', () => {
    const msg = renderAlertMessage({ type: 'passkey_added', credentialLabel: 'MacBook' })
    expect(msg).toContain('MacBook')
  })

  test('renderAlertMessage for lockdown includes tier', () => {
    const msg = renderAlertMessage({ type: 'lockdown_triggered', tier: 'B' })
    expect(msg).toContain('tier B')
  })
})

// ---------------------------------------------------------------------------
// sendAlert channel routing tests
// ---------------------------------------------------------------------------

function makeMockContact() {
  return {
    userPubkey: 'test-pubkey',
    identifierHash: 'abc123',
    identifierCiphertext: 'enc' as Ciphertext,
    identifierEnvelope: [],
    identifierType: 'phone' as const,
    verifiedAt: new Date(),
    updatedAt: new Date(),
  }
}

function makePrefs(overrides: Record<string, unknown> = {}) {
  return {
    userPubkey: 'test-pubkey',
    autoLockMs: 900000,
    disappearingTimerDays: 1,
    digestCadence: 'weekly',
    alertOnNewDevice: true,
    alertOnPasskeyChange: true,
    alertOnPinChange: true,
    notificationChannel: 'signal',
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('sendAlert notification channel routing', () => {
  let originalFetch: typeof globalThis.fetch
  const notifierCalls: { url: string; body: unknown }[] = []

  beforeAll(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      notifierCalls.push({ url, body: null })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  function makeService(
    contactResult: Awaited<ReturnType<SignalContactsService['findByUser']>>,
    prefsOverrides: Record<string, unknown> = {}
  ) {
    const signalContacts = {
      findByUser: mock(async () => contactResult),
    } as unknown as SignalContactsService

    const prefs = {
      get: mock(async () => makePrefs(prefsOverrides)),
    } as unknown as SecurityPrefsService

    const authEvents = {
      record: mock(async () => {}),
    } as unknown as AuthEventsService

    return new UserNotificationsService(signalContacts, prefs, authEvents, {
      notifierUrl: 'http://notifier:9000',
      notifierApiKey: 'test-key',
    })
  }

  test('delivers when channel is signal and contact exists', async () => {
    notifierCalls.length = 0
    const svc = makeService(makeMockContact(), { notificationChannel: 'signal' })
    const result = await svc.sendAlert('test-pubkey', { type: 'pin_changed' })
    expect(result.delivered).toBe(true)
    expect(notifierCalls.length).toBeGreaterThan(0)
  })

  test('does not deliver when channel is web_push', async () => {
    notifierCalls.length = 0
    const svc = makeService(makeMockContact(), { notificationChannel: 'web_push' })
    const result = await svc.sendAlert('test-pubkey', { type: 'pin_changed' })
    expect(result.delivered).toBe(false)
    expect(notifierCalls.length).toBe(0)
  })

  test('does not deliver when channel is signal but no contact', async () => {
    notifierCalls.length = 0
    const svc = makeService(null, { notificationChannel: 'signal' })
    const result = await svc.sendAlert('test-pubkey', { type: 'pin_changed' })
    expect(result.delivered).toBe(false)
    expect(notifierCalls.length).toBe(0)
  })

  test('does not deliver digest when digestCadence is off', async () => {
    notifierCalls.length = 0
    const svc = makeService(makeMockContact(), {
      notificationChannel: 'signal',
      digestCadence: 'off',
    })
    const result = await svc.sendAlert('test-pubkey', {
      type: 'digest',
      periodDays: 7,
      loginCount: 3,
      alertCount: 1,
      failedCount: 0,
    })
    expect(result.delivered).toBe(false)
  })
})
