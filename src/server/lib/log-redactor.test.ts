import { describe, expect, test } from 'bun:test'
import { redact } from './log-redactor'

describe('redact', () => {
  test('replaces values of sensitive keys', () => {
    const input = { hubId: 'h1', phone: '+12025550100', name: 'Alice' }
    expect(redact(input)).toEqual({ hubId: 'h1', phone: '[redacted]', name: '[redacted]' })
  })

  test('is case-insensitive on keys', () => {
    expect(redact({ PhoneNumber: 'x', EmailAddress: 'y' })).toEqual({
      PhoneNumber: '[redacted]',
      EmailAddress: '[redacted]',
    })
  })

  test('matches partial keys', () => {
    expect(redact({ encryptedName: 'cipher', userContent: 'raw' })).toEqual({
      encryptedName: '[redacted]',
      userContent: '[redacted]',
    })
  })

  test('redacts nsec/hex-pubkey/ciphertext patterns in string values', () => {
    const out = redact({ note: `leaked nsec1${'q'.repeat(58)}` }) as { note: string }
    expect(out.note).toContain('[redacted:nsec]')
  })

  test('recurses into nested objects up to depth 2', () => {
    const input = { a: { b: { phone: 'x' } } }
    expect(redact(input)).toEqual({ a: { b: { phone: '[redacted]' } } })
  })

  test('does not recurse deeper than 2 (safety)', () => {
    const input = { a: { b: { c: { phone: 'x' } } } } as Record<string, unknown>
    const out = redact(input) as { a: { b: { c: { phone: string } } } }
    // depth 3 is left as-is; type gate is primary defense
    expect(out.a.b.c.phone).toBe('x')
  })

  test('replaces circular refs with [circular]', () => {
    const input: Record<string, unknown> = { name: 'Alice' }
    input.self = input
    const out = redact(input) as Record<string, unknown>
    expect(out.name).toBe('[redacted]')
    expect(out.self).toBe('[circular]')
  })

  test('handles arrays', () => {
    expect(redact({ items: [{ phone: 'x' }, { phone: 'y' }] })).toEqual({
      items: [{ phone: '[redacted]' }, { phone: '[redacted]' }],
    })
  })

  test('passes through safe values', () => {
    expect(redact({ hubId: 'h1', count: 5, active: true })).toEqual({
      hubId: 'h1',
      count: 5,
      active: true,
    })
  })
})
