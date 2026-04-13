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
    name: 'factor_add',
    payload: {
      type: 'factor_add',
      userId: UUID,
      rootKeyId: UUID,
      factorType: 'prf',
      factorId: 'cred-1',
    },
  },
  {
    name: 'factor_remove',
    payload: {
      type: 'factor_remove',
      userId: UUID,
      rootKeyId: UUID,
      factorType: 'opaque',
      factorId: 'opaque-1',
    },
  },
  {
    name: 'root_kek_rotate',
    payload: {
      type: 'root_kek_rotate',
      userId: UUID,
      oldRootKeyId: null,
      newRootKeyId: UUID,
      reason: 'manual',
    },
  },
  // Tier 3: sigchain payload variants
  {
    name: 'user_init',
    payload: {
      type: 'user_init',
      userId: UUID,
      deviceId: 'device-1',
      signingPubkey: HEX64,
      encryptionPubkey: HEX64,
      pukGeneration: 1,
      pukSignPubkey: HEX64,
      pukDhPubkey: HEX64,
    },
  },
  {
    name: 'tier3_device_add',
    payload: {
      type: 'tier3_device_add',
      userId: UUID,
      newDeviceId: 'device-2',
      newDeviceSigningPubkey: HEX64,
      newDeviceEncryptionPubkey: HEX64,
      signedByDeviceId: 'device-1',
      newDeviceDisplayName: 'encrypted-name',
      pukGeneration: 1,
    },
  },
  {
    name: 'tier3_device_remove',
    payload: {
      type: 'tier3_device_remove',
      userId: UUID,
      removedDeviceId: 'device-2',
      removedSigningPubkey: HEX64,
      signedByDeviceId: 'device-1',
      reason: 'compromised',
      pukGeneration: 2,
    },
  },
  {
    name: 'puk_rotate',
    payload: {
      type: 'puk_rotate',
      userId: UUID,
      oldGeneration: 1,
      newGeneration: 2,
      newPukSignPubkey: HEX64,
      newPukDhPubkey: HEX64,
      signedByDeviceId: 'device-1',
    },
  },
  {
    name: 'user_master_signing_update',
    payload: {
      type: 'user_master_signing_update',
      userId: UUID,
      newMasterSigningPubkey: HEX64,
      signedByDeviceId: 'device-1',
    },
  },
  {
    name: 'device_cross_sign',
    payload: {
      type: 'device_cross_sign',
      signerDeviceId: 'device-1',
      targetDeviceId: 'device-2',
      targetSigningPubkey: HEX64,
      signature: HEX128,
    },
  },
  {
    name: 'user_cross_sign',
    payload: {
      type: 'user_cross_sign',
      signerUserId: UUID,
      targetUserId: UUID,
      targetMasterPubkey: HEX64,
      signature: HEX128,
    },
  },
  {
    name: 'hub_ptk_rotate',
    payload: {
      type: 'hub_ptk_rotate',
      hubId: UUID,
      oldGeneration: 1,
      newGeneration: 2,
      deviceCommitments: [{ deviceId: 'device-1', commitmentHash: HEX64 }],
      signedByDeviceId: 'device-1',
    },
  },
  {
    name: 'recovery_initiated',
    payload: {
      type: 'recovery_initiated',
      userId: UUID,
      initiatorDeviceId: 'device-1',
      recoveryType: 'paper_key',
    },
  },
  {
    name: 'recovery_completed',
    payload: {
      type: 'recovery_completed',
      userId: UUID,
      newDeviceId: 'device-3',
      recoveryType: 'admin_reset',
      pukGeneration: 3,
    },
  },
  // Tier 6: device fingerprint verification
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
