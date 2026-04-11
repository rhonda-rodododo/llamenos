import { describe, expect, test } from 'bun:test'
import { LABEL_REGISTRY } from './crypto-labels.js'
import { EnvelopeV3Schema, isEnvelopeV3 } from './envelope-v3.js'

describe('envelope-v3', () => {
  const valid = {
    v: 3 as const,
    labelId: 0,
    enc: 'AAAA',
    ct: 'BBBB',
  }

  test('accepts a valid V3 envelope', () => {
    const parsed = EnvelopeV3Schema.parse(valid)
    expect(parsed.v).toBe(3)
    expect(parsed.labelId).toBe(0)
  })

  test('isEnvelopeV3 narrows unknown values', () => {
    expect(isEnvelopeV3(valid)).toBe(true)
    expect(isEnvelopeV3({ ...valid, v: 2 })).toBe(false)
    expect(isEnvelopeV3({ ...valid, labelId: -1 })).toBe(false)
    expect(isEnvelopeV3({ ...valid, enc: '' })).toBe(false)
    expect(isEnvelopeV3(null)).toBe(false)
  })

  test('rejects a V2 envelope (wrong version)', () => {
    const v2 = { v: 2, labelId: 0, wrappedKey: 'x', ephemeralPubkey: 'y' }
    expect(EnvelopeV3Schema.safeParse(v2).success).toBe(false)
  })

  test('rejects labelId past LABEL_REGISTRY bounds', () => {
    expect(EnvelopeV3Schema.safeParse({ ...valid, labelId: LABEL_REGISTRY.length }).success).toBe(
      false
    )
  })

  test('rejects empty enc/ct strings', () => {
    expect(EnvelopeV3Schema.safeParse({ ...valid, enc: '' }).success).toBe(false)
    expect(EnvelopeV3Schema.safeParse({ ...valid, ct: '' }).success).toBe(false)
  })
})
