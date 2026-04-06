import { describe, expect, test } from 'bun:test'
import { AUTH_EVENT_TYPES, isValidEventType } from './auth-events'

describe('auth-events constants', () => {
  test('AUTH_EVENT_TYPES includes expected events', () => {
    expect(AUTH_EVENT_TYPES).toContain('login')
    expect(AUTH_EVENT_TYPES).toContain('login_failed')
    expect(AUTH_EVENT_TYPES).toContain('logout')
    expect(AUTH_EVENT_TYPES).toContain('session_revoked')
    expect(AUTH_EVENT_TYPES).toContain('sessions_revoked_others')
    expect(AUTH_EVENT_TYPES).toContain('passkey_added')
    expect(AUTH_EVENT_TYPES).toContain('passkey_removed')
    expect(AUTH_EVENT_TYPES).toContain('passkey_renamed')
    expect(AUTH_EVENT_TYPES).toContain('pin_changed')
    expect(AUTH_EVENT_TYPES).toContain('recovery_rotated')
    expect(AUTH_EVENT_TYPES).toContain('lockdown_triggered')
    expect(AUTH_EVENT_TYPES).toContain('alert_sent')
    expect(AUTH_EVENT_TYPES).toContain('signal_contact_changed')
  })

  test('isValidEventType accepts known types', () => {
    expect(isValidEventType('login')).toBe(true)
    expect(isValidEventType('lockdown_triggered')).toBe(true)
  })

  test('isValidEventType rejects unknown types', () => {
    expect(isValidEventType('foo')).toBe(false)
    expect(isValidEventType('')).toBe(false)
  })
})
