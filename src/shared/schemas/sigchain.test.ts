import { describe, expect, test } from 'bun:test'
import { AuditEntryPayloadSchema } from './audit-entries'
import {
  DeviceCrossSignPayloadSchema,
  HubPtkRotatePayloadSchema,
  PukRotatePayloadSchema,
  RecoveryCompletedPayloadSchema,
  RecoveryInitiatedPayloadSchema,
  Tier3DeviceAddPayloadSchema,
  Tier3DeviceRemovePayloadSchema,
  UserCrossSignPayloadSchema,
  UserInitPayloadSchema,
  UserMasterSigningUpdatePayloadSchema,
} from './sigchain'

const HEX64 = 'ab'.repeat(32)
const HEX128 = 'cd'.repeat(64)
const UUID = '00000000-0000-4000-8000-000000000001'
const UUID2 = '00000000-0000-4000-8000-000000000002'

const validPayloads = {
  user_init: {
    type: 'user_init' as const,
    userId: UUID,
    deviceId: 'device-1',
    signingPubkey: HEX64,
    encryptionPubkey: HEX64,
    pukGeneration: 1,
    pukSignPubkey: HEX64,
    pukDhPubkey: HEX64,
  },
  tier3_device_add: {
    type: 'tier3_device_add' as const,
    userId: UUID,
    newDeviceId: 'device-2',
    newDeviceSigningPubkey: HEX64,
    newDeviceEncryptionPubkey: HEX64,
    signedByDeviceId: 'device-1',
    newDeviceDisplayName: 'encrypted-display-name',
    pukGeneration: 1,
  },
  tier3_device_remove: {
    type: 'tier3_device_remove' as const,
    userId: UUID,
    removedDeviceId: 'device-2',
    removedSigningPubkey: HEX64,
    signedByDeviceId: 'device-1',
    reason: 'user_revoked' as const,
    pukGeneration: 2,
  },
  puk_rotate: {
    type: 'puk_rotate' as const,
    userId: UUID,
    oldGeneration: 1,
    newGeneration: 2,
    newPukSignPubkey: HEX64,
    newPukDhPubkey: HEX64,
    signedByDeviceId: 'device-1',
  },
  user_master_signing_update: {
    type: 'user_master_signing_update' as const,
    userId: UUID,
    newMasterSigningPubkey: HEX64,
    signedByDeviceId: 'device-1',
  },
  device_cross_sign: {
    type: 'device_cross_sign' as const,
    signerDeviceId: 'device-1',
    targetDeviceId: 'device-2',
    targetSigningPubkey: HEX64,
    signature: HEX128,
  },
  user_cross_sign: {
    type: 'user_cross_sign' as const,
    signerUserId: UUID,
    targetUserId: UUID2,
    targetMasterPubkey: HEX64,
    signature: HEX128,
  },
  hub_ptk_rotate: {
    type: 'hub_ptk_rotate' as const,
    hubId: UUID,
    oldGeneration: 1,
    newGeneration: 2,
    deviceCommitments: [{ deviceId: 'device-1', commitmentHash: HEX64 }],
    signedByDeviceId: 'device-1',
  },
  recovery_initiated: {
    type: 'recovery_initiated' as const,
    userId: UUID,
    initiatorDeviceId: 'device-1',
    recoveryType: 'paper_key' as const,
  },
  recovery_completed: {
    type: 'recovery_completed' as const,
    userId: UUID,
    newDeviceId: 'device-3',
    recoveryType: 'recovery_group' as const,
    pukGeneration: 3,
  },
}

const schemas = {
  user_init: UserInitPayloadSchema,
  tier3_device_add: Tier3DeviceAddPayloadSchema,
  tier3_device_remove: Tier3DeviceRemovePayloadSchema,
  puk_rotate: PukRotatePayloadSchema,
  user_master_signing_update: UserMasterSigningUpdatePayloadSchema,
  device_cross_sign: DeviceCrossSignPayloadSchema,
  user_cross_sign: UserCrossSignPayloadSchema,
  hub_ptk_rotate: HubPtkRotatePayloadSchema,
  recovery_initiated: RecoveryInitiatedPayloadSchema,
  recovery_completed: RecoveryCompletedPayloadSchema,
} as const

describe('Sigchain payload schemas', () => {
  for (const [name, payload] of Object.entries(validPayloads)) {
    const schema = schemas[name as keyof typeof schemas]

    test(`${name}: accepts valid payload`, () => {
      const result = schema.safeParse(payload)
      expect(result.success).toBe(true)
    })

    test(`${name}: rejects wrong type discriminator`, () => {
      const result = schema.safeParse({ ...payload, type: 'wrong_type' })
      expect(result.success).toBe(false)
    })

    test(`${name}: rejects empty object`, () => {
      const result = schema.safeParse({})
      expect(result.success).toBe(false)
    })
  }

  test('user_init rejects pukGeneration < 1', () => {
    const result = UserInitPayloadSchema.safeParse({ ...validPayloads.user_init, pukGeneration: 0 })
    expect(result.success).toBe(false)
  })

  test('user_init rejects invalid hex pubkey', () => {
    const result = UserInitPayloadSchema.safeParse({
      ...validPayloads.user_init,
      signingPubkey: 'not-hex',
    })
    expect(result.success).toBe(false)
  })

  test('tier3_device_remove rejects invalid reason', () => {
    const result = Tier3DeviceRemovePayloadSchema.safeParse({
      ...validPayloads.tier3_device_remove,
      reason: 'bad_reason',
    })
    expect(result.success).toBe(false)
  })

  test('device_cross_sign rejects short signature', () => {
    const result = DeviceCrossSignPayloadSchema.safeParse({
      ...validPayloads.device_cross_sign,
      signature: HEX64,
    })
    expect(result.success).toBe(false)
  })

  test('recovery_initiated rejects invalid recoveryType', () => {
    const result = RecoveryInitiatedPayloadSchema.safeParse({
      ...validPayloads.recovery_initiated,
      recoveryType: 'magic_spell',
    })
    expect(result.success).toBe(false)
  })

  test('hub_ptk_rotate rejects empty deviceCommitments with invalid hash', () => {
    const result = HubPtkRotatePayloadSchema.safeParse({
      ...validPayloads.hub_ptk_rotate,
      deviceCommitments: [{ deviceId: 'dev-1', commitmentHash: 'short' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('Sigchain payloads in AuditEntryPayloadSchema union', () => {
  for (const [name, payload] of Object.entries(validPayloads)) {
    test(`${name}: round-trips through discriminated union`, () => {
      const result = AuditEntryPayloadSchema.safeParse(payload)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe(name as typeof result.data.type)
      }
    })
  }
})
