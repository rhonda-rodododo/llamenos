import { describe, expect, test } from 'bun:test'
import {
  DeviceListResponseSchema,
  DeviceResponseSchema,
  FinalizeEnrollmentRequestSchema,
  RevokeDeviceRequestSchema,
  StartEnrollmentRequestSchema,
  StartEnrollmentResponseSchema,
} from './devices'

const HEX64 = 'ab'.repeat(32)
const UUID = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-04-12T00:00:00.000Z'

describe('StartEnrollmentRequestSchema', () => {
  test('accepts valid request', () => {
    const result = StartEnrollmentRequestSchema.safeParse({
      candidateSigningPubkey: HEX64,
      candidateEncryptionPubkey: HEX64,
      enrollmentNonce: HEX64,
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid hex pubkey', () => {
    const result = StartEnrollmentRequestSchema.safeParse({
      candidateSigningPubkey: 'not-hex',
      candidateEncryptionPubkey: HEX64,
      enrollmentNonce: HEX64,
    })
    expect(result.success).toBe(false)
  })

  test('rejects missing fields', () => {
    const result = StartEnrollmentRequestSchema.safeParse({
      candidateSigningPubkey: HEX64,
    })
    expect(result.success).toBe(false)
  })
})

describe('StartEnrollmentResponseSchema', () => {
  test('accepts valid response', () => {
    const result = StartEnrollmentResponseSchema.safeParse({
      sessionId: UUID,
      expiresAt: NOW,
    })
    expect(result.success).toBe(true)
  })

  test('rejects non-uuid sessionId', () => {
    const result = StartEnrollmentResponseSchema.safeParse({
      sessionId: 'not-a-uuid',
      expiresAt: NOW,
    })
    expect(result.success).toBe(false)
  })
})

describe('FinalizeEnrollmentRequestSchema', () => {
  const validRequest = {
    sessionId: UUID,
    signedEntry: {
      id: UUID,
      hubId: UUID,
      payload: {
        type: 'tier3_device_add',
        userId: UUID,
        newDeviceId: 'device-2',
        newDeviceSigningPubkey: HEX64,
        newDeviceEncryptionPubkey: HEX64,
        signedByDeviceId: 'device-1',
        newDeviceDisplayName: 'My Phone',
        pukGeneration: 1,
      },
      prevEntryHash: null,
      entryHash: HEX64,
      signerDeviceId: 'device-1',
      signerPubkey: HEX64,
      signature: HEX64,
      createdAt: NOW,
    },
    pukEnvelope: {
      deviceId: 'device-2',
      generation: 1,
      envelope: 'base64-envelope-data',
    },
  }

  test('accepts valid request', () => {
    const result = FinalizeEnrollmentRequestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
  })

  test('rejects missing signedEntry', () => {
    const result = FinalizeEnrollmentRequestSchema.safeParse({
      sessionId: UUID,
      pukEnvelope: validRequest.pukEnvelope,
    })
    expect(result.success).toBe(false)
  })

  test('rejects pukEnvelope with generation < 1', () => {
    const result = FinalizeEnrollmentRequestSchema.safeParse({
      ...validRequest,
      pukEnvelope: { ...validRequest.pukEnvelope, generation: 0 },
    })
    expect(result.success).toBe(false)
  })

  test('rejects payload with wrong discriminator type', () => {
    const result = FinalizeEnrollmentRequestSchema.safeParse({
      ...validRequest,
      signedEntry: {
        ...validRequest.signedEntry,
        payload: { ...validRequest.signedEntry.payload, type: 'tier3_device_remove' },
      },
    })
    expect(result.success).toBe(false)
  })

  test('rejects payload missing required tier3_device_add fields', () => {
    const result = FinalizeEnrollmentRequestSchema.safeParse({
      ...validRequest,
      signedEntry: {
        ...validRequest.signedEntry,
        payload: { type: 'tier3_device_add' },
      },
    })
    expect(result.success).toBe(false)
  })

  test('rejects payload with unstructured record (legacy z.record shape)', () => {
    const result = FinalizeEnrollmentRequestSchema.safeParse({
      ...validRequest,
      signedEntry: {
        ...validRequest.signedEntry,
        payload: { foo: 'bar', baz: 1 },
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('DeviceResponseSchema', () => {
  test('accepts valid device', () => {
    const result = DeviceResponseSchema.safeParse({
      deviceId: 'device-1',
      signingPubkey: HEX64,
      encryptionPubkey: HEX64,
      encryptedDisplayName: 'encrypted-name',
      createdAt: NOW,
      lastSeenAt: NOW,
      revokedAt: null,
      revokedReason: null,
      isCurrent: true,
    })
    expect(result.success).toBe(true)
  })

  test('accepts revoked device', () => {
    const result = DeviceResponseSchema.safeParse({
      deviceId: 'device-1',
      signingPubkey: HEX64,
      encryptionPubkey: HEX64,
      encryptedDisplayName: 'encrypted-name',
      createdAt: NOW,
      lastSeenAt: NOW,
      revokedAt: NOW,
      revokedReason: 'user_revoked',
      isCurrent: false,
    })
    expect(result.success).toBe(true)
  })
})

describe('DeviceListResponseSchema', () => {
  test('accepts valid list', () => {
    const result = DeviceListResponseSchema.safeParse({
      devices: [
        {
          deviceId: 'device-1',
          signingPubkey: HEX64,
          encryptionPubkey: HEX64,
          encryptedDisplayName: 'encrypted-name',
          createdAt: NOW,
          lastSeenAt: NOW,
          revokedAt: null,
          revokedReason: null,
          isCurrent: true,
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  test('accepts empty list', () => {
    const result = DeviceListResponseSchema.safeParse({ devices: [] })
    expect(result.success).toBe(true)
  })
})

describe('RevokeDeviceRequestSchema', () => {
  const validRemovePayload = {
    type: 'tier3_device_remove' as const,
    userId: UUID,
    removedDeviceId: 'device-1',
    removedSigningPubkey: HEX64,
    signedByDeviceId: 'device-2',
    reason: 'user_revoked' as const,
    pukGeneration: 2,
  }

  const validRequest = {
    signedEntry: {
      id: UUID,
      hubId: UUID,
      payload: validRemovePayload,
      prevEntryHash: HEX64,
      entryHash: HEX64,
      signerDeviceId: 'device-2',
      signerPubkey: HEX64,
      signature: HEX64,
      createdAt: NOW,
    },
    reason: 'user_revoked' as const,
    newPukGeneration: 2,
    pukEnvelopes: [{ deviceId: 'device-2', generation: 2, envelope: 'envelope-data' }],
    oldGenWrappedUnderNew: HEX64,
  }

  test('accepts valid request', () => {
    const result = RevokeDeviceRequestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
  })

  test('rejects invalid reason at top level', () => {
    const result = RevokeDeviceRequestSchema.safeParse({
      ...validRequest,
      reason: 'invalid_reason',
    })
    expect(result.success).toBe(false)
  })

  test('rejects payload with wrong discriminator type', () => {
    const result = RevokeDeviceRequestSchema.safeParse({
      ...validRequest,
      signedEntry: {
        ...validRequest.signedEntry,
        payload: { ...validRemovePayload, type: 'tier3_device_add' },
      },
    })
    expect(result.success).toBe(false)
  })

  test('rejects payload missing required tier3_device_remove fields', () => {
    const result = RevokeDeviceRequestSchema.safeParse({
      ...validRequest,
      signedEntry: {
        ...validRequest.signedEntry,
        payload: { type: 'tier3_device_remove' },
      },
    })
    expect(result.success).toBe(false)
  })

  test('rejects payload with empty record (legacy z.record shape)', () => {
    const result = RevokeDeviceRequestSchema.safeParse({
      ...validRequest,
      signedEntry: {
        ...validRequest.signedEntry,
        payload: {},
      },
    })
    expect(result.success).toBe(false)
  })
})
