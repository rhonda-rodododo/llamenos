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

// --- Tier 6: client-facing device record ---

/**
 * Single source of truth for the device row consumed by the admin
 * `DevicesSection` UI and by every test that exercises the device
 * fingerprint verification flow.
 *
 * This is intentionally distinct from `DeviceResponseSchema` above:
 *   - `DeviceResponseSchema` describes the Tier 3 enrollment list
 *     (signing/encryption pubkey pair, encrypted display name, PUK
 *     bookkeeping fields).
 *   - `DeviceSchema` describes the Tier 6 admin-facing list used to
 *     render verification badges, where the relevant fields are the
 *     ed25519 fingerprint, a free-form label, and a boolean verified
 *     state — fingerprint and verification state are operational
 *     metadata, NOT encrypted, hence classified as PLAINTEXT in the
 *     query-client exhaustiveness check.
 */
export const DeviceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  label: z.string().nullable(),
  ed25519Pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  verified: z.boolean(),
  createdAt: z.string().datetime(),
})
export type Device = z.infer<typeof DeviceSchema>

export const DeviceListSchema = z.object({
  devices: z.array(DeviceSchema),
})
export type DeviceList = z.infer<typeof DeviceListSchema>
