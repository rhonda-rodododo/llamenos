import { describe, expect, test } from 'bun:test'
import { canonicalize } from './canonical-json'

describe('canonicalize', () => {
  test('null + primitives', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(true)).toBe('true')
    expect(canonicalize(false)).toBe('false')
    expect(canonicalize(42)).toBe('42')
    expect(canonicalize(0)).toBe('0')
    expect(canonicalize(-1.5)).toBe('-1.5')
    expect(canonicalize('hi')).toBe('"hi"')
    expect(canonicalize('')).toBe('""')
  })

  test('sorts object keys deeply', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(canonicalize({ x: { b: 2, a: 1 } })).toBe('{"x":{"a":1,"b":2}}')
  })

  test('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })

  test('nested arrays and objects', () => {
    expect(canonicalize({ a: [{ z: 1, a: 2 }] })).toBe('{"a":[{"a":2,"z":1}]}')
  })

  test('empty containers', () => {
    expect(canonicalize({})).toBe('{}')
    expect(canonicalize([])).toBe('[]')
  })

  test('throws on undefined, NaN, Infinity', () => {
    expect(() => canonicalize(undefined)).toThrow('Cannot canonicalize undefined')
    expect(() => canonicalize(Number.NaN)).toThrow('Cannot canonicalize non-finite number')
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(
      'Cannot canonicalize non-finite number'
    )
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(
      'Cannot canonicalize non-finite number'
    )
  })

  test('determinism — identical input always produces identical output', () => {
    const obj = { hubId: 'abc', payload: { type: 'membership_add', userId: 'u1' }, v: 1 }
    const a = canonicalize(obj)
    const b = canonicalize(obj)
    expect(a).toBe(b)
  })

  test('key order does not affect output', () => {
    const a = canonicalize({ z: 1, a: 2, m: 3 })
    const b = canonicalize({ a: 2, z: 1, m: 3 })
    expect(a).toBe(b)
  })
})
