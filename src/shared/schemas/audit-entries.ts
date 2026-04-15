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
  reason: z.enum(['factor_added', 'factor_removed', 'scheduled', 'manual']),
})

// --- Tier 6: device fingerprint verification (2026-04) ---

export const DeviceFingerprintVerifiedPayloadSchema = z.object({
  type: z.literal('device_fingerprint_verified'),
  hubId: z.string().uuid(),
  verifiedDeviceId: z.string().uuid(),
  verifiedDevicePubkey: hexPubkey,
  verifierDeviceId: z.string().uuid(),
})

// --- Tier 5: voice E2EE state + key rotation (2026-04) ---

const callE2eeStateEnum = z.enum(['unknown', 'active', 'unavailable'])

/**
 * Emitted whenever the per-call E2EE status transitions (e.g. SFrame install
 * succeeds, hook fails, or the call ends and returns to unknown).
 */
export const CallE2eeStateChangePayloadSchema = z.object({
  type: z.literal('call_e2ee_state_change'),
  callId: z.string().min(1).max(256),
  oldState: callE2eeStateEnum,
  newState: callE2eeStateEnum,
  reason: z.string().min(1).max(256).optional(),
})

/**
 * Emitted whenever the SFrame sender key for an active call is rotated
 * (member join/leave inside the call ring, manual rotation, scheduled).
 */
export const CallSframeKeyRotationPayloadSchema = z.object({
  type: z.literal('call_sframe_key_rotation'),
  callId: z.string().min(1).max(256),
  newKeyId: z.number().int().min(0).max(127),
  reason: z.enum(['member_added', 'member_removed', 'scheduled', 'manual']).optional(),
})

// --- Tier 6: MLS group lifecycle (2026-04) ---

export const MlsGroupInitPayloadSchema = z.object({
  type: z.literal('mls_group_init'),
  hubId: z.string(),
  groupId: z.string(),
  ciphersuite: z.number().int(),
  creatorDeviceId: z.string(),
  epoch: z.literal(0),
})

export const MlsMembersAddedPayloadSchema = z.object({
  type: z.literal('mls_members_added'),
  hubId: z.string(),
  addedDeviceIds: z.array(z.string()),
  epoch: z.number().int(),
  committerId: z.string(),
})

export const MlsMembersRemovedPayloadSchema = z.object({
  type: z.literal('mls_members_removed'),
  hubId: z.string(),
  removedDeviceIds: z.array(z.string()),
  epoch: z.number().int(),
  committerId: z.string(),
})

export const MlsPathUpdatePayloadSchema = z.object({
  type: z.literal('mls_path_update'),
  hubId: z.string(),
  epoch: z.number().int(),
  updaterId: z.string(),
})

export const MlsEpochPurgePayloadSchema = z.object({
  type: z.literal('mls_epoch_purge'),
  hubId: z.string(),
  purgedEpochRange: z.string(),
  reason: z.string(),
})

export const MlsCiphersuiteUpgradePlannedPayloadSchema = z.object({
  type: z.literal('mls_ciphersuite_upgrade_planned'),
  hubId: z.string(),
  fromCs: z.number().int(),
  toCs: z.number().int(),
  targetDate: z.string(),
})

export const MlsCiphersuiteUpgradeCompletedPayloadSchema = z.object({
  type: z.literal('mls_ciphersuite_upgrade_completed'),
  hubId: z.string(),
  fromCs: z.number().int(),
  toCs: z.number().int(),
  epoch: z.number().int(),
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
  // Tier 5: voice E2EE state + key rotation
  CallE2eeStateChangePayloadSchema,
  CallSframeKeyRotationPayloadSchema,
  // Tier 6: MLS group lifecycle
  MlsGroupInitPayloadSchema,
  MlsMembersAddedPayloadSchema,
  MlsMembersRemovedPayloadSchema,
  MlsPathUpdatePayloadSchema,
  MlsEpochPurgePayloadSchema,
  MlsCiphersuiteUpgradePlannedPayloadSchema,
  MlsCiphersuiteUpgradeCompletedPayloadSchema,
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
