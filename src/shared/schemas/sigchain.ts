import { z } from '@hono/zod-openapi'

const hexPubkey = z.string().regex(/^[0-9a-f]{64}$/)
const hexSignature = z.string().regex(/^[0-9a-f]{128}$/)

const recoveryTypeEnum = z.enum(['paper_key', 'recovery_group', 'admin_reset'])

// --- Tier 3: sigchain payload schemas (2026-04) ---

/** First link in a user's sigchain — bootstraps identity + first device + first PUK. */
export const UserInitPayloadSchema = z.object({
  type: z.literal('user_init'),
  userId: z.string().uuid(),
  deviceId: z.string(),
  signingPubkey: hexPubkey,
  encryptionPubkey: hexPubkey,
  pukGeneration: z.number().int().min(1),
  pukSignPubkey: hexPubkey,
  pukDhPubkey: hexPubkey,
})
type UserInitPayload = z.infer<typeof UserInitPayloadSchema>

/** A new device was added to a user's sigchain (Tier 3 version with richer metadata). */
export const Tier3DeviceAddPayloadSchema = z.object({
  type: z.literal('tier3_device_add'),
  userId: z.string().uuid(),
  newDeviceId: z.string(),
  newDeviceSigningPubkey: hexPubkey,
  newDeviceEncryptionPubkey: hexPubkey,
  signedByDeviceId: z.string(),
  newDeviceDisplayName: z.string(),
  pukGeneration: z.number().int(),
})
export type Tier3DeviceAddPayload = z.infer<typeof Tier3DeviceAddPayloadSchema>

/** A device was removed from a user's sigchain (Tier 3 version with revocation reason). */
export const Tier3DeviceRemovePayloadSchema = z.object({
  type: z.literal('tier3_device_remove'),
  userId: z.string().uuid(),
  removedDeviceId: z.string(),
  removedSigningPubkey: hexPubkey,
  signedByDeviceId: z.string(),
  reason: z.enum(['user_revoked', 'admin_revoked', 'compromised']),
  pukGeneration: z.number().int(),
})
export type Tier3DeviceRemovePayload = z.infer<typeof Tier3DeviceRemovePayloadSchema>

/** Per-user key (PUK) rotation — new signing + DH keypair for the user. */
export const PukRotatePayloadSchema = z.object({
  type: z.literal('puk_rotate'),
  userId: z.string().uuid(),
  oldGeneration: z.number().int(),
  newGeneration: z.number().int(),
  newPukSignPubkey: hexPubkey,
  newPukDhPubkey: hexPubkey,
  signedByDeviceId: z.string(),
})
type PukRotatePayload = z.infer<typeof PukRotatePayloadSchema>

/** Master signing key update (e.g. after recovery). */
export const UserMasterSigningUpdatePayloadSchema = z.object({
  type: z.literal('user_master_signing_update'),
  userId: z.string().uuid(),
  newMasterSigningPubkey: hexPubkey,
  signedByDeviceId: z.string(),
})
type UserMasterSigningUpdatePayload = z.infer<typeof UserMasterSigningUpdatePayloadSchema>

/** Cross-signature between two devices owned by the same user. */
export const DeviceCrossSignPayloadSchema = z.object({
  type: z.literal('device_cross_sign'),
  signerDeviceId: z.string(),
  targetDeviceId: z.string(),
  targetSigningPubkey: hexPubkey,
  signature: hexSignature,
})
export type DeviceCrossSignPayload = z.infer<typeof DeviceCrossSignPayloadSchema>

/** Cross-signature between two users (web of trust). */
export const UserCrossSignPayloadSchema = z.object({
  type: z.literal('user_cross_sign'),
  signerUserId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  targetMasterPubkey: hexPubkey,
  signature: hexSignature,
})
export type UserCrossSignPayload = z.infer<typeof UserCrossSignPayloadSchema>

/** Hub per-team key (PTK) rotation with device commitment hashes. */
export const HubPtkRotatePayloadSchema = z.object({
  type: z.literal('hub_ptk_rotate'),
  hubId: z.string().uuid(),
  oldGeneration: z.number().int(),
  newGeneration: z.number().int(),
  deviceCommitments: z.array(
    z.object({
      deviceId: z.string(),
      commitmentHash: hexPubkey,
    })
  ),
  signedByDeviceId: z.string(),
})
type HubPtkRotatePayload = z.infer<typeof HubPtkRotatePayloadSchema>

/** Account recovery process started. */
export const RecoveryInitiatedPayloadSchema = z.object({
  type: z.literal('recovery_initiated'),
  userId: z.string().uuid(),
  initiatorDeviceId: z.string(),
  recoveryType: recoveryTypeEnum,
})
type RecoveryInitiatedPayload = z.infer<typeof RecoveryInitiatedPayloadSchema>

/** Account recovery completed — new device provisioned. */
export const RecoveryCompletedPayloadSchema = z.object({
  type: z.literal('recovery_completed'),
  userId: z.string().uuid(),
  newDeviceId: z.string(),
  recoveryType: recoveryTypeEnum,
  pukGeneration: z.number().int(),
})
type RecoveryCompletedPayload = z.infer<typeof RecoveryCompletedPayloadSchema>
