import { describe, expect, test } from 'bun:test'
import { isInternalAddress, validateExternalUrl, validateExternalUrlWithDns } from './ssrf-guard'

describe('isInternalAddress', () => {
  test('blocks 127.0.0.1 (loopback)', () => expect(isInternalAddress('127.0.0.1')).toBe(true))
  test('blocks 127.255.255.255', () => expect(isInternalAddress('127.255.255.255')).toBe(true))
  test('allows 128.0.0.1', () => expect(isInternalAddress('128.0.0.1')).toBe(false))
  test('blocks 10.0.0.1 (class A)', () => expect(isInternalAddress('10.0.0.1')).toBe(true))
  test('allows 11.0.0.1', () => expect(isInternalAddress('11.0.0.1')).toBe(false))
  test('blocks 172.16.0.1', () => expect(isInternalAddress('172.16.0.1')).toBe(true))
  test('blocks 172.31.255.255', () => expect(isInternalAddress('172.31.255.255')).toBe(true))
  test('allows 172.15.255.255', () => expect(isInternalAddress('172.15.255.255')).toBe(false))
  test('allows 172.32.0.0', () => expect(isInternalAddress('172.32.0.0')).toBe(false))
  test('blocks 192.168.1.1', () => expect(isInternalAddress('192.168.1.1')).toBe(true))
  test('allows 192.169.0.1', () => expect(isInternalAddress('192.169.0.1')).toBe(false))
  test('blocks 169.254.1.1 (link-local)', () => expect(isInternalAddress('169.254.1.1')).toBe(true))
  test('allows 169.253.1.1', () => expect(isInternalAddress('169.253.1.1')).toBe(false))
  test('blocks 100.64.0.0 (CGNAT)', () => expect(isInternalAddress('100.64.0.0')).toBe(true))
  test('blocks 100.127.255.255', () => expect(isInternalAddress('100.127.255.255')).toBe(true))
  test('allows 100.63.255.255', () => expect(isInternalAddress('100.63.255.255')).toBe(false))
  test('allows 100.128.0.0', () => expect(isInternalAddress('100.128.0.0')).toBe(false))
  test('blocks 240.0.0.1 (reserved)', () => expect(isInternalAddress('240.0.0.1')).toBe(true))
  test('blocks 255.0.0.0', () => expect(isInternalAddress('255.0.0.0')).toBe(true))
  test('allows 239.255.255.255', () => expect(isInternalAddress('239.255.255.255')).toBe(false))
  test('blocks 0.0.0.0 (current)', () => expect(isInternalAddress('0.0.0.0')).toBe(true))
  test('allows 8.8.8.8 (public)', () => expect(isInternalAddress('8.8.8.8')).toBe(false))
  test('blocks ::1 (IPv6 loopback)', () => expect(isInternalAddress('::1')).toBe(true))
  test('blocks [::1] (bracketed)', () => expect(isInternalAddress('[::1]')).toBe(true))
  test('blocks fe80::1 (link-local)', () => expect(isInternalAddress('fe80::1')).toBe(true))
  test('blocks fc00::1 (ULA)', () => expect(isInternalAddress('fc00::1')).toBe(true))
  test('blocks fd12::1 (ULA)', () => expect(isInternalAddress('fd12::1')).toBe(true))
  test('blocks ::ffff:127.0.0.1 (mapped loopback)', () =>
    expect(isInternalAddress('::ffff:127.0.0.1')).toBe(true))
  test('blocks ::ffff:192.168.1.1 (mapped private)', () =>
    expect(isInternalAddress('::ffff:192.168.1.1')).toBe(true))
  test('allows ::ffff:8.8.8.8 (mapped public)', () =>
    expect(isInternalAddress('::ffff:8.8.8.8')).toBe(false))
  test('blocks :: (unspecified)', () => expect(isInternalAddress('::')).toBe(true))
  test('allows 2001:db8::1 (public IPv6)', () =>
    expect(isInternalAddress('2001:db8::1')).toBe(false))
  test('blocks localhost', () => expect(isInternalAddress('localhost')).toBe(true))
  test('blocks sub.localhost', () => expect(isInternalAddress('sub.localhost')).toBe(true))
  test('allows example.com', () => expect(isInternalAddress('example.com')).toBe(false))
  test('allows invalid octets', () => expect(isInternalAddress('999.999.999.999')).toBe(false))
  test('allows 3-octet string', () => expect(isInternalAddress('192.168.1')).toBe(false))
})

describe('validateExternalUrl', () => {
  test('allows https public', () => expect(validateExternalUrl('https://example.com')).toBeNull())
  test('allows http public', () => expect(validateExternalUrl('http://example.com')).toBeNull())
  test('blocks ftp', () =>
    expect(validateExternalUrl('ftp://example.com')).toContain('HTTP or HTTPS'))
  test('blocks internal IP', () =>
    expect(validateExternalUrl('https://192.168.1.1')).toContain('internal'))
  test('blocks localhost', () =>
    expect(validateExternalUrl('https://localhost:3000')).toContain('internal'))
  test('blocks IPv6 loopback', () =>
    expect(validateExternalUrl('https://[::1]:3000')).toContain('internal'))
  test('invalid URL error', () => expect(validateExternalUrl('not-a-url')).toContain('Invalid'))
  test('custom label', () =>
    expect(validateExternalUrl('ftp://x.com', 'Bridge URL')).toContain('Bridge URL'))
})

describe('validateExternalUrlWithDns', () => {
  test('blocks internal IP without DNS', async () => {
    const result = await validateExternalUrlWithDns('https://192.168.1.1')
    expect(result).toContain('internal')
  })

  test('blocks localhost', async () => {
    const result = await validateExternalUrlWithDns('https://localhost')
    expect(result).toContain('internal')
  })

  test('allows public URL', async () => {
    const result = await validateExternalUrlWithDns('https://example.com')
    expect(result).toBeNull()
  })

  test('blocks non-resolving hostname', async () => {
    const result = await validateExternalUrlWithDns(
      'https://this-domain-does-not-exist-xyzzy.example'
    )
    expect(result).toContain('does not resolve')
  })

  test('blocks invalid URL', async () => {
    const result = await validateExternalUrlWithDns('not-a-url')
    expect(result).toContain('Invalid')
  })

  test('IP literal skips DNS resolution', async () => {
    const result = await validateExternalUrlWithDns('https://8.8.8.8')
    expect(result).toBeNull()
  })
})
