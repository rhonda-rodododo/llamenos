import { describe, expect, test } from 'bun:test'
import { formatUserAgent } from './sessions'

describe('SessionService helpers', () => {
  test('formatUserAgent summarises Firefox on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0'
    expect(formatUserAgent(ua)).toBe('Firefox on macOS')
  })

  test('formatUserAgent summarises Safari on iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
    expect(formatUserAgent(ua)).toBe('Safari on iOS')
  })

  test('formatUserAgent summarises Chrome on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(formatUserAgent(ua)).toBe('Chrome on Windows')
  })

  test('formatUserAgent returns unknown for empty string', () => {
    expect(formatUserAgent('')).toBe('Unknown browser')
  })

  test('formatUserAgent returns unknown for garbage', () => {
    expect(formatUserAgent('xxxxxx')).toBe('Unknown browser')
  })
})
