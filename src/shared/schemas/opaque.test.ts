import { describe, expect, test } from 'bun:test'
import {
  OpaqueLoginFinishRequestSchema,
  OpaqueLoginStartRequestSchema,
  OpaqueLoginStartResponseSchema,
  OpaqueRegistrationFinishRequestSchema,
  OpaqueRegistrationStartRequestSchema,
  OpaqueRegistrationStartResponseSchema,
} from './opaque'

const UUID = '11111111-2222-4333-8444-555555555555'
const B64 = 'dGVzdA'

describe('OpaqueRegistrationStartRequestSchema', () => {
  test('accepts valid', () => {
    const res = OpaqueRegistrationStartRequestSchema.safeParse({
      purpose: 'root-kek',
      credentialIdentifier: `${UUID}:root-kek`,
      registrationRequest: B64,
    })
    expect(res.success).toBe(true)
  })

  test('rejects unknown purpose', () => {
    const res = OpaqueRegistrationStartRequestSchema.safeParse({
      purpose: 'login',
      credentialIdentifier: UUID,
      registrationRequest: B64,
    })
    expect(res.success).toBe(false)
  })

  test('rejects non-base64url bytes', () => {
    const res = OpaqueRegistrationStartRequestSchema.safeParse({
      purpose: 'root-kek',
      credentialIdentifier: UUID,
      registrationRequest: 'has spaces',
    })
    expect(res.success).toBe(false)
  })
})

describe('OpaqueRegistrationStartResponseSchema', () => {
  test('requires sessionId to be a UUID', () => {
    const ok = OpaqueRegistrationStartResponseSchema.safeParse({
      sessionId: UUID,
      registrationResponse: B64,
    })
    expect(ok.success).toBe(true)
    const bad = OpaqueRegistrationStartResponseSchema.safeParse({
      sessionId: 'not-a-uuid',
      registrationResponse: B64,
    })
    expect(bad.success).toBe(false)
  })
})

describe('OpaqueRegistrationFinishRequestSchema', () => {
  test('accepts valid', () => {
    const res = OpaqueRegistrationFinishRequestSchema.safeParse({
      sessionId: UUID,
      credentialIdentifier: UUID,
      registrationUpload: B64,
    })
    expect(res.success).toBe(true)
  })
})

describe('OpaqueLoginStartRequestSchema', () => {
  test('accepts valid', () => {
    const res = OpaqueLoginStartRequestSchema.safeParse({
      purpose: 'recovery-phrase',
      credentialIdentifier: UUID,
      credentialRequest: B64,
    })
    expect(res.success).toBe(true)
  })
})

describe('OpaqueLoginStartResponseSchema + FinishRequest', () => {
  test('sessionId threads through', () => {
    const startOk = OpaqueLoginStartResponseSchema.safeParse({
      sessionId: UUID,
      credentialResponse: B64,
    })
    expect(startOk.success).toBe(true)

    const finishOk = OpaqueLoginFinishRequestSchema.safeParse({
      sessionId: UUID,
      credentialFinalization: B64,
    })
    expect(finishOk.success).toBe(true)
  })
})
