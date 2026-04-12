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
      payload: { type: 'tier3_device_add' },
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
  test('accepts valid request', () => {
    const result = RevokeDeviceRequestSchema.safeParse({
      signedEntry: {
        id: UUID,
        hubId: UUID,
        payload: { type: 'tier3_device_remove' },
        prevEntryHash: HEX64,
        entryHash: HEX64,
        signerDeviceId: 'device-1',
        signerPubkey: HEX64,
        signature: HEX64,
        createdAt: NOW,
      },
      reason: 'user_revoked',
      newPukGeneration: 2,
      pukEnvelopes: [{ deviceId: 'device-1', generation: 2, envelope: 'envelope-data' }],
      oldGenWrappedUnderNew: HEX64,
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid reason', () => {
    const result = RevokeDeviceRequestSchema.safeParse({
      signedEntry: {
        id: UUID,
        hubId: UUID,
        payload: {},
        prevEntryHash: null,
        entryHash: HEX64,
        signerDeviceId: 'device-1',
        signerPubkey: HEX64,
        signature: HEX64,
        createdAt: NOW,
      },
      reason: 'invalid_reason',
      newPukGeneration: 2,
      pukEnvelopes: [],
      oldGenWrappedUnderNew: HEX64,
    })
    expect(result.success).toBe(false)
  })
})
