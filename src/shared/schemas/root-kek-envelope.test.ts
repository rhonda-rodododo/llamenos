import { describe, expect, test } from 'bun:test'
import {
  type RootKekEnvelope,
  RootKekEnvelopeBundleSchema,
  RootKekEnvelopeSchema,
} from './root-kek-envelope'

const hex = (len: number) => '0'.repeat(len)
const SALT = hex(64)
const WRAPPED = hex(80)

const prfEnv = (factorId = 'cred-1'): RootKekEnvelope => ({
  v: 3,
  factorType: 'prf',
  factorId,
  hkdfSalt: SALT,
  wrappedKey: WRAPPED,
  createdAt: '2026-04-11T00:00:00.000Z',
})

const opaqueEnv = (factorId = 'opaque-1'): RootKekEnvelope => ({
  ...prfEnv(),
  factorType: 'opaque',
  factorId,
})

describe('RootKekEnvelopeSchema', () => {
  test('accepts a well-formed PRF envelope', () => {
    expect(RootKekEnvelopeSchema.safeParse(prfEnv()).success).toBe(true)
  })

  test('rejects non-hex wrappedKey', () => {
    const bad = { ...prfEnv(), wrappedKey: 'zzzz' }
    expect(RootKekEnvelopeSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects salt of wrong length', () => {
    const bad = { ...prfEnv(), hkdfSalt: hex(32) }
    expect(RootKekEnvelopeSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects unknown factorType', () => {
    const bad = { ...prfEnv(), factorType: 'pin' as unknown as 'prf' }
    expect(RootKekEnvelopeSchema.safeParse(bad).success).toBe(false)
  })
})

describe('RootKekEnvelopeBundleSchema', () => {
  const bundle = (envelopes: RootKekEnvelope[]) => ({
    v: 3 as const,
    userId: '11111111-2222-4333-8444-555555555555',
    rootKeyId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    envelopes,
    createdAt: '2026-04-11T00:00:00.000Z',
  })

  test('accepts a bundle with two distinct factors', () => {
    const res = RootKekEnvelopeBundleSchema.safeParse(bundle([prfEnv(), opaqueEnv()]))
    expect(res.success).toBe(true)
  })

  test('rejects a bundle with only one envelope (min-2 invariant)', () => {
    const res = RootKekEnvelopeBundleSchema.safeParse(bundle([prfEnv()]))
    expect(res.success).toBe(false)
  })

  test('rejects a bundle with duplicate (factorType, factorId)', () => {
    const res = RootKekEnvelopeBundleSchema.safeParse(bundle([prfEnv('dup'), prfEnv('dup')]))
    expect(res.success).toBe(false)
  })

  test('accepts same factorId under different factorTypes', () => {
    const res = RootKekEnvelopeBundleSchema.safeParse(bundle([prfEnv('x'), opaqueEnv('x')]))
    expect(res.success).toBe(true)
  })
})
