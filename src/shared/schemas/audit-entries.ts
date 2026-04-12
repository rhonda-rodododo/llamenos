import { z } from '@hono/zod-openapi'
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

const hexPubkey = z.string().regex(/^[0-9a-f]{64}$/)
const roleEnum = z.enum(['volunteer', 'admin', 'super_admin'])

export const MembershipAddPayloadSchema = z.object({
  type: z.literal('membership_add'),
  userId: z.string().uuid(),
  pubkey: hexPubkey,
  role: roleEnum,
})

export const MembershipRemovePayloadSchema = z.object({
  type: z.literal('membership_remove'),
  userId: z.string().uuid(),
})

export const RoleChangePayloadSchema = z.object({
  type: z.literal('role_change'),
  userId: z.string().uuid(),
  oldRole: roleEnum,
  newRole: roleEnum,
})

export const HubKeyRotatePayloadSchema = z.object({
  type: z.literal('hub_key_rotate'),
  keyId: z.string().uuid(),
  memberPubkeys: z.array(hexPubkey),
  reason: z.enum(['member_added', 'member_removed', 'role_changed', 'scheduled', 'manual']),
})

export const HubCreatePayloadSchema = z.object({
  type: z.literal('hub_create'),
  hubId: z.string().uuid(),
  founderPubkey: hexPubkey,
})

export const HubDeletePayloadSchema = z.object({
  type: z.literal('hub_delete'),
  hubId: z.string().uuid(),
})

export const DeviceAddPayloadSchema = z.object({
  type: z.literal('device_add'),
  userId: z.string().uuid(),
  devicePubkey: hexPubkey,
  label: z.string().optional(),
})

export const DeviceRevokePayloadSchema = z.object({
  type: z.literal('device_revoke'),
  userId: z.string().uuid(),
  devicePubkey: hexPubkey,
})

// --- Tier 2: root-KEK factor lifecycle (2026-04) ---

const factorTypeEnum = z.enum(['prf', 'opaque', 'recoveryPhrase', 'recoveryGroup'])

/**
 * A new unlock factor was enrolled into the user's root-KEK bundle.
 * Emitted alongside every successful `appendEnvelope()` on the client,
 * then mirrored into the hub audit log.
 */
export const FactorAddPayloadSchema = z.object({
  type: z.literal('factor_add'),
  userId: z.string().uuid(),
  rootKeyId: z.string().uuid(),
  factorType: factorTypeEnum,
  factorId: z.string().min(1).max(256),
})

/**
 * A new unlock factor was removed from the user's root-KEK bundle.
 */
export const FactorRemovePayloadSchema = z.object({
  type: z.literal('factor_remove'),
  userId: z.string().uuid(),
  rootKeyId: z.string().uuid(),
  factorType: factorTypeEnum,
  factorId: z.string().min(1).max(256),
})

/**
 * The root KEK itself was rotated (all existing envelopes invalidated,
 * fresh ones enrolled). Emitted on every `rotateBundle()` call.
 */
export const RootKekRotatePayloadSchema = z.object({
  type: z.literal('root_kek_rotate'),
  userId: z.string().uuid(),
  oldRootKeyId: z.string().uuid().nullable(),
  newRootKeyId: z.string().uuid(),
  reason: z.enum(['factor_added', 'factor_removed', 'scheduled', 'manual', 'migration_v2_v3']),
})

// --- Tier 6: device fingerprint verification (2026-04) ---

export const DeviceFingerprintVerifiedPayloadSchema = z.object({
  type: z.literal('device_fingerprint_verified'),
  hubId: z.string().uuid(),
  verifiedDeviceId: z.string().uuid(),
  verifiedDevicePubkey: hexPubkey,
  verifierDeviceId: z.string().uuid(),
})

export const AuditEntryPayloadSchema = z.discriminatedUnion('type', [
  MembershipAddPayloadSchema,
  MembershipRemovePayloadSchema,
  RoleChangePayloadSchema,
  HubKeyRotatePayloadSchema,
  HubCreatePayloadSchema,
  HubDeletePayloadSchema,
  DeviceAddPayloadSchema,
  DeviceRevokePayloadSchema,
  FactorAddPayloadSchema,
  FactorRemovePayloadSchema,
  RootKekRotatePayloadSchema,
  // Tier 3: sigchain payload variants
  UserInitPayloadSchema,
  Tier3DeviceAddPayloadSchema,
  Tier3DeviceRemovePayloadSchema,
  PukRotatePayloadSchema,
  UserMasterSigningUpdatePayloadSchema,
  DeviceCrossSignPayloadSchema,
  UserCrossSignPayloadSchema,
  HubPtkRotatePayloadSchema,
  RecoveryInitiatedPayloadSchema,
  RecoveryCompletedPayloadSchema,
  // Tier 6: device fingerprint verification
  DeviceFingerprintVerifiedPayloadSchema,
])
export type AuditEntryPayload = z.infer<typeof AuditEntryPayloadSchema>

export const SignedAuditEntrySchema = z.object({
  id: z.string().uuid(),
  hubId: z.string().uuid(),
  payload: AuditEntryPayloadSchema,
  prevEntryHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  entryHash: z.string().regex(/^[0-9a-f]{64}$/),
  signerDeviceId: z.string(),
  signerPubkey: hexPubkey,
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  createdAt: z.string().datetime(),
})
export type SignedAuditEntry = z.infer<typeof SignedAuditEntrySchema>
