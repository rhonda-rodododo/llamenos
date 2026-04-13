import { describe, expect, test } from 'bun:test'
import { LABEL_REGISTRY } from './crypto-labels.js'
import { HpkeEnvelopeSchema, isHpkeEnvelope } from './hpke-envelope.js'

describe('hpke-envelope', () => {
  const valid = {
    v: 3 as const,
    labelId: 0,
    enc: 'AAAA',
    ct: 'BBBB',
  }

  test('accepts a valid V3 envelope', () => {
    const parsed = HpkeEnvelopeSchema.parse(valid)
    expect(parsed.v).toBe(3)
    expect(parsed.labelId).toBe(0)
  })

  test('isHpkeEnvelope narrows unknown values', () => {
    expect(isHpkeEnvelope(valid)).toBe(true)
    expect(isHpkeEnvelope({ ...valid, v: 2 })).toBe(false)
    expect(isHpkeEnvelope({ ...valid, labelId: -1 })).toBe(false)
    expect(isHpkeEnvelope({ ...valid, enc: '' })).toBe(false)
    expect(isHpkeEnvelope(null)).toBe(false)
  })

  test('rejects a V2 envelope (wrong version)', () => {
    const v2 = { v: 2, labelId: 0, wrappedKey: 'x', ephemeralPubkey: 'y' }
    expect(HpkeEnvelopeSchema.safeParse(v2).success).toBe(false)
  })

  test('rejects labelId past LABEL_REGISTRY bounds', () => {
    expect(HpkeEnvelopeSchema.safeParse({ ...valid, labelId: LABEL_REGISTRY.length }).success).toBe(
      false
    )
  })

  test('rejects empty enc/ct strings', () => {
    expect(HpkeEnvelopeSchema.safeParse({ ...valid, enc: '' }).success).toBe(false)
    expect(HpkeEnvelopeSchema.safeParse({ ...valid, ct: '' }).success).toBe(false)
  })
})
