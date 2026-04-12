import { describe, expect, test } from 'bun:test'
import { assertKeyIdContiguous, freshSecretOnLeave, ratchetOnJoin } from './sframe-rotation.js'

describe('ratchetOnJoin', () => {
  test('is deterministic for a given (current, deviceId)', () => {
    const current = new Uint8Array(32).fill(0x11)
    const a = ratchetOnJoin(current, 'd1')
    const b = ratchetOnJoin(current, 'd1')
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  test('differs per joining device', () => {
    const current = new Uint8Array(32).fill(0x11)
    const a = ratchetOnJoin(current, 'd1')
    const b = ratchetOnJoin(current, 'd2')
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  test('differs from input (one-way check)', () => {
    const current = new Uint8Array(32).fill(0x11)
    const next = ratchetOnJoin(current, 'd1')
    expect(Array.from(next)).not.toEqual(Array.from(current))
  })

  test('produces 32-byte output', () => {
    const out = ratchetOnJoin(new Uint8Array(32), 'd1')
    expect(out.length).toBe(32)
  })
})

describe('freshSecretOnLeave', () => {
  test('returns 32 bytes', () => {
    expect(freshSecretOnLeave().length).toBe(32)
  })

  test('produces high-entropy output (all-distinct sanity)', () => {
    const samples = Array.from({ length: 20 }, () => freshSecretOnLeave())
    const seen = new Set(samples.map((s) => Array.from(s).join(',')))
    expect(seen.size).toBe(20)
  })
})

describe('assertKeyIdContiguous', () => {
  test('accepts current + 1', () => {
    expect(() => assertKeyIdContiguous(0, 1)).not.toThrow()
    expect(() => assertKeyIdContiguous(9, 10)).not.toThrow()
  })

  test('rejects gap forward', () => {
    expect(() => assertKeyIdContiguous(0, 2)).toThrow(/key_rotation_gap/)
  })

  test('rejects backward', () => {
    expect(() => assertKeyIdContiguous(5, 4)).toThrow(/key_rotation_gap/)
  })

  test('rejects equal', () => {
    expect(() => assertKeyIdContiguous(3, 3)).toThrow(/key_rotation_gap/)
  })
})
