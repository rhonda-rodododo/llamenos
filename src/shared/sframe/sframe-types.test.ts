import { describe, expect, test } from 'bun:test'
import {
  type CiphertextBytes,
  type PlaintextBytes,
  type SealedFrame,
  asCiphertextBytes,
  asPlaintextBytes,
  asSealedFrame,
} from './sframe-types.js'

describe('SFrame byte brands', () => {
  test('asCiphertextBytes / asPlaintextBytes are runtime identity', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03])
    // Brands are compile-time only — runtime reference equality is preserved.
    expect(asCiphertextBytes(bytes) === bytes).toBe(true)
    expect(asPlaintextBytes(bytes) === bytes).toBe(true)
  })

  test('branded types structurally remain Uint8Array at runtime', () => {
    const ct = asCiphertextBytes(new Uint8Array([0xaa]))
    const pt = asPlaintextBytes(new Uint8Array([0xbb]))
    expect(ct).toBeInstanceOf(Uint8Array)
    expect(pt).toBeInstanceOf(Uint8Array)
    expect(ct.byteLength).toBe(1)
    expect(pt.byteLength).toBe(1)
  })

  test('CiphertextBytes and PlaintextBytes are not assignable to each other (compile-time)', () => {
    const ct = asCiphertextBytes(new Uint8Array([0x01]))
    const pt = asPlaintextBytes(new Uint8Array([0x02]))
    // @ts-expect-error — CiphertextBytes is not assignable to PlaintextBytes
    const _badA: PlaintextBytes = ct
    // @ts-expect-error — PlaintextBytes is not assignable to CiphertextBytes
    const _badB: CiphertextBytes = pt
    // Silence unused-var lint without touching runtime. Compare at the
    // underlying Uint8Array level to sidestep the cross-brand identity.
    expect((_badA as Uint8Array) === (ct as Uint8Array)).toBe(true)
    expect((_badB as Uint8Array) === (pt as Uint8Array)).toBe(true)
  })
})

describe('SealedFrame brand', () => {
  test('asSealedFrame is a runtime identity', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03])
    expect(asSealedFrame(bytes) === bytes).toBe(true)
  })

  test('SealedFrame remains a Uint8Array at runtime', () => {
    const sf = asSealedFrame(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    expect(sf).toBeInstanceOf(Uint8Array)
    expect(sf.byteLength).toBe(4)
  })

  test('SealedFrame is not assignable to raw Uint8Array without cast (compile-time)', () => {
    const raw = new Uint8Array([0x01])
    // A raw Uint8Array is not assignable to SealedFrame — the caller must
    // explicitly brand it with asSealedFrame() to assert it came from seal().
    // @ts-expect-error — Uint8Array is not assignable to SealedFrame
    const _bad: SealedFrame = raw
    expect((_bad as Uint8Array) === raw).toBe(true)
  })

  test('SealedFrame is not assignable to CiphertextBytes (compile-time)', () => {
    const sf = asSealedFrame(new Uint8Array([0x01]))
    // @ts-expect-error — SealedFrame is not assignable to CiphertextBytes
    const _bad: CiphertextBytes = sf
    expect((_bad as Uint8Array) === (sf as Uint8Array)).toBe(true)
  })
})
