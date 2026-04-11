import { z } from '@hono/zod-openapi'

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

export const AuditEntryPayloadSchema = z.discriminatedUnion('type', [
  MembershipAddPayloadSchema,
  MembershipRemovePayloadSchema,
  RoleChangePayloadSchema,
  HubKeyRotatePayloadSchema,
  HubCreatePayloadSchema,
  HubDeletePayloadSchema,
  DeviceAddPayloadSchema,
  DeviceRevokePayloadSchema,
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
