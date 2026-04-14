import { describe, expect, test } from 'bun:test'
import { RecoveryCompleteSchema } from './recovery-group'
import type { RootKekEnvelope } from './root-kek-envelope'

// Tier 2 P0 — RecoveryCompleteSchema used to accept `newBundle: z.unknown()`,
// so the /api/auth/recovery-group/complete endpoint would happily take
// arbitrary JSON from an anonymous caller (it is unauthenticated by design).
// It is now tightened to RootKekEnvelopeBundleSchema so that anything that is
// not a valid v3 root-KEK bundle with ≥2 distinct factor envelopes is rejected
// at the route edge before the service sees it.

const hex = (len: number) => '0'.repeat(len)

const prfEnv = (factorId = 'cred-1'): RootKekEnvelope => ({
  v: 3,
  factorType: 'prf',
  factorId,
  hkdfSalt: hex(64),
  wrappedKey: hex(80),
  createdAt: '2026-04-11T00:00:00.000Z',
})

const opaqueEnv = (factorId = 'opaque-1'): RootKekEnvelope => ({
  ...prfEnv(),
  factorType: 'opaque',
  factorId,
})

const validBundle = () => ({
  v: 3 as const,
  userId: '11111111-2222-4333-8444-555555555555',
  rootKeyId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  envelopes: [prfEnv(), opaqueEnv()],
  createdAt: '2026-04-11T00:00:00.000Z',
})

describe('RecoveryCompleteSchema (Tier 2 P0 tightening)', () => {
  test('accepts a well-formed bundle', () => {
    const res = RecoveryCompleteSchema.safeParse({
      sessionId: '00000000-0000-4000-8000-000000000001',
      newBundle: validBundle(),
    })
    expect(res.success).toBe(true)
  })

  test('rejects arbitrary JSON for newBundle (the old z.unknown() hole)', () => {
    const res = RecoveryCompleteSchema.safeParse({
      sessionId: '00000000-0000-4000-8000-000000000001',
      newBundle: { lol: 'just some json' },
    })
    expect(res.success).toBe(false)
  })

  test('rejects a string for newBundle', () => {
    const res = RecoveryCompleteSchema.safeParse({
      sessionId: '00000000-0000-4000-8000-000000000001',
      newBundle: 'not-a-bundle',
    })
    expect(res.success).toBe(false)
  })

  test('rejects a bundle with only one envelope (min-2 factor invariant)', () => {
    const res = RecoveryCompleteSchema.safeParse({
      sessionId: '00000000-0000-4000-8000-000000000001',
      newBundle: { ...validBundle(), envelopes: [prfEnv()] },
    })
    expect(res.success).toBe(false)
  })

  test('rejects a bundle with a non-hex wrappedKey inside an envelope', () => {
    const bundle = validBundle()
    bundle.envelopes[0] = { ...bundle.envelopes[0], wrappedKey: 'not-hex-????' }
    const res = RecoveryCompleteSchema.safeParse({
      sessionId: '00000000-0000-4000-8000-000000000001',
      newBundle: bundle,
    })
    expect(res.success).toBe(false)
  })

  test('still requires a valid sessionId uuid', () => {
    const res = RecoveryCompleteSchema.safeParse({
      sessionId: 'not-a-uuid',
      newBundle: validBundle(),
    })
    expect(res.success).toBe(false)
  })

  test('accepts an optional emergencyOverride alongside a valid bundle', () => {
    const res = RecoveryCompleteSchema.safeParse({
      sessionId: '00000000-0000-4000-8000-000000000001',
      newBundle: validBundle(),
      emergencyOverride: {
        justification: 'caller lost all factors — on-call admin verification',
        coApproverPubkey: 'a'.repeat(64),
        coApproverSignature: 'b'.repeat(128),
      },
    })
    expect(res.success).toBe(true)
  })
})
