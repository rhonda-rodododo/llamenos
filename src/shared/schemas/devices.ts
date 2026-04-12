import { z } from '@hono/zod-openapi'

const hexPubkey = z.string().regex(/^[0-9a-f]{64}$/)

// --- Enrollment session ---

export const StartEnrollmentRequestSchema = z.object({
  candidateSigningPubkey: hexPubkey,
  candidateEncryptionPubkey: hexPubkey,
  enrollmentNonce: hexPubkey,
})
export type StartEnrollmentRequest = z.infer<typeof StartEnrollmentRequestSchema>

export const StartEnrollmentResponseSchema = z.object({
  sessionId: z.string().uuid(),
  expiresAt: z.string().datetime(),
})
export type StartEnrollmentResponse = z.infer<typeof StartEnrollmentResponseSchema>

// --- Finalize enrollment ---

export const FinalizeEnrollmentRequestSchema = z.object({
  sessionId: z.string().uuid(),
  /** Signed sigchain entry for tier3_device_add */
  signedEntry: z.object({
    id: z.string().uuid(),
    hubId: z.string().uuid(),
    payload: z.record(z.string(), z.unknown()),
    prevEntryHash: z.string().nullable(),
    entryHash: z.string(),
    signerDeviceId: z.string(),
    signerPubkey: z.string(),
    signature: z.string(),
    createdAt: z.string().datetime(),
  }),
  /** HPKE-sealed PUK envelope for the new device */
  pukEnvelope: z.object({
    deviceId: z.string(),
    generation: z.number().int().min(1),
    envelope: z.string(),
  }),
})
export type FinalizeEnrollmentRequest = z.infer<typeof FinalizeEnrollmentRequestSchema>

export const FinalizeEnrollmentResponseSchema = z.object({
  deviceId: z.string(),
  userId: z.string().uuid(),
})
export type FinalizeEnrollmentResponse = z.infer<typeof FinalizeEnrollmentResponseSchema>

// --- List devices ---

export const DeviceResponseSchema = z.object({
  deviceId: z.string(),
  signingPubkey: hexPubkey,
  encryptionPubkey: hexPubkey,
  encryptedDisplayName: z.string(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  revokedReason: z.string().nullable(),
  isCurrent: z.boolean(),
})
export type DeviceResponse = z.infer<typeof DeviceResponseSchema>

export const DeviceListResponseSchema = z.object({
  devices: z.array(DeviceResponseSchema),
})
export type DeviceListResponse = z.infer<typeof DeviceListResponseSchema>

// --- Revoke device ---

export const RevokeDeviceRequestSchema = z.object({
  /** Signed sigchain entry for tier3_device_remove */
  signedEntry: z.object({
    id: z.string().uuid(),
    hubId: z.string().uuid(),
    payload: z.record(z.string(), z.unknown()),
    prevEntryHash: z.string().nullable(),
    entryHash: z.string(),
    signerDeviceId: z.string(),
    signerPubkey: z.string(),
    signature: z.string(),
    createdAt: z.string().datetime(),
  }),
  reason: z.enum(['user_revoked', 'admin_revoked', 'compromised']),
  /** New PUK generation after rotation (required after device removal) */
  newPukGeneration: z.number().int().min(1),
  /** PUK envelopes for all remaining devices */
  pukEnvelopes: z.array(
    z.object({
      deviceId: z.string(),
      generation: z.number().int().min(1),
      envelope: z.string(),
    })
  ),
  /** Old PUK seed wrapped under new generation's SecretBox key (hex) */
  oldGenWrappedUnderNew: z.string(),
})
export type RevokeDeviceRequest = z.infer<typeof RevokeDeviceRequestSchema>

export const RevokeDeviceResponseSchema = z.object({
  revokedDeviceId: z.string(),
  newPukGeneration: z.number().int(),
})
export type RevokeDeviceResponse = z.infer<typeof RevokeDeviceResponseSchema>

// --- Revoke device path params ---

export const RevokeDeviceParamsSchema = z.object({
  deviceId: z.string(),
})
export type RevokeDeviceParams = z.infer<typeof RevokeDeviceParamsSchema>
