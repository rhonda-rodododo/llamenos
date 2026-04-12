import { describe, expect, test } from 'bun:test'
import {
  type AuditEntryPayload,
  AuditEntryPayloadSchema,
  DeviceFingerprintVerifiedPayloadSchema,
  SignedAuditEntrySchema,
} from './audit-entries'

const HEX64 = 'ab'.repeat(32)
const HEX128 = 'cd'.repeat(64)
const UUID = '00000000-0000-4000-8000-000000000001'

const payloadFixtures: Array<{ name: string; payload: AuditEntryPayload }> = [
  {
    name: 'membership_add',
    payload: { type: 'membership_add', userId: UUID, pubkey: HEX64, role: 'volunteer' },
  },
  {
    name: 'membership_remove',
    payload: { type: 'membership_remove', userId: UUID },
  },
  {
    name: 'role_change',
    payload: { type: 'role_change', userId: UUID, oldRole: 'volunteer', newRole: 'admin' },
  },
  {
    name: 'hub_key_rotate',
    payload: {
      type: 'hub_key_rotate',
      keyId: UUID,
      memberPubkeys: [HEX64],
      reason: 'member_removed',
    },
  },
  {
    name: 'hub_create',
    payload: { type: 'hub_create', hubId: UUID, founderPubkey: HEX64 },
  },
  {
    name: 'hub_delete',
    payload: { type: 'hub_delete', hubId: UUID },
  },
  {
    name: 'device_add',
    payload: { type: 'device_add', userId: UUID, devicePubkey: HEX64, label: 'laptop' },
  },
  {
    name: 'device_revoke',
    payload: { type: 'device_revoke', userId: UUID, devicePubkey: HEX64 },
  },
  {
    name: 'device_fingerprint_verified',
    payload: {
      type: 'device_fingerprint_verified',
      hubId: UUID,
      verifiedDeviceId: UUID,
      verifiedDevicePubkey: HEX64,
      verifierDeviceId: UUID,
    },
  },
]

describe('AuditEntryPayloadSchema', () => {
  for (const { name, payload } of payloadFixtures) {
    test(`accepts valid ${name}`, () => {
      const result = AuditEntryPayloadSchema.safeParse(payload)
      expect(result.success).toBe(true)
    })
  }

  test('rejects unknown type', () => {
    const result = AuditEntryPayloadSchema.safeParse({ type: 'unknown_event' })
    expect(result.success).toBe(false)
  })

  test('rejects membership_add with invalid pubkey', () => {
    const result = AuditEntryPayloadSchema.safeParse({
      type: 'membership_add',
      userId: UUID,
      pubkey: 'not-hex',
      role: 'volunteer',
    })
    expect(result.success).toBe(false)
  })

  test('rejects membership_add with invalid role', () => {
    const result = AuditEntryPayloadSchema.safeParse({
      type: 'membership_add',
      userId: UUID,
      pubkey: HEX64,
      role: 'owner',
    })
    expect(result.success).toBe(false)
  })

  test('rejects role_change with missing oldRole', () => {
    const result = AuditEntryPayloadSchema.safeParse({
      type: 'role_change',
      userId: UUID,
      newRole: 'admin',
    })
    expect(result.success).toBe(false)
  })
})

describe('device_fingerprint_verified payload', () => {
  test('round-trips through both schemas', () => {
    const payload = {
      type: 'device_fingerprint_verified' as const,
      hubId: UUID,
      verifiedDeviceId: UUID,
      verifiedDevicePubkey: HEX64,
      verifierDeviceId: UUID,
    }
    expect(DeviceFingerprintVerifiedPayloadSchema.safeParse(payload).success).toBe(true)
    expect(AuditEntryPayloadSchema.safeParse(payload).success).toBe(true)
  })

  test('rejects non-64-char hex pubkey', () => {
    const payload = {
      type: 'device_fingerprint_verified' as const,
      hubId: UUID,
      verifiedDeviceId: UUID,
      verifiedDevicePubkey: 'short',
      verifierDeviceId: UUID,
    }
    expect(DeviceFingerprintVerifiedPayloadSchema.safeParse(payload).success).toBe(false)
  })

  test('rejects non-UUID deviceId', () => {
    const payload = {
      type: 'device_fingerprint_verified' as const,
      hubId: UUID,
      verifiedDeviceId: 'not-a-uuid',
      verifiedDevicePubkey: HEX64,
      verifierDeviceId: UUID,
    }
    expect(DeviceFingerprintVerifiedPayloadSchema.safeParse(payload).success).toBe(false)
  })
})

describe('SignedAuditEntrySchema', () => {
  const validEntry = {
    id: UUID,
    hubId: UUID,
    payload: payloadFixtures[0].payload,
    prevEntryHash: null,
    entryHash: HEX64,
    signerDeviceId: 'device-1',
    signerPubkey: HEX64,
    signature: HEX128,
    createdAt: '2026-04-11T00:00:00.000Z',
  }

  test('accepts valid signed entry', () => {
    const result = SignedAuditEntrySchema.safeParse(validEntry)
    expect(result.success).toBe(true)
  })

  test('accepts entry with prevEntryHash', () => {
    const result = SignedAuditEntrySchema.safeParse({
      ...validEntry,
      prevEntryHash: HEX64,
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid entryHash', () => {
    const result = SignedAuditEntrySchema.safeParse({
      ...validEntry,
      entryHash: 'too-short',
    })
    expect(result.success).toBe(false)
  })

  test('rejects invalid signature length', () => {
    const result = SignedAuditEntrySchema.safeParse({
      ...validEntry,
      signature: HEX64,
    })
    expect(result.success).toBe(false)
  })

  test('rejects invalid createdAt', () => {
    const result = SignedAuditEntrySchema.safeParse({
      ...validEntry,
      createdAt: 'not-a-date',
    })
    expect(result.success).toBe(false)
  })

  test('rejects missing payload', () => {
    const { payload: _, ...rest } = validEntry
    const result = SignedAuditEntrySchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})
