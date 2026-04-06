import { describe, expect, test } from 'bun:test'
import { formatDisappearingTimerSeconds, renderAlertMessage } from './user-notifications'

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
