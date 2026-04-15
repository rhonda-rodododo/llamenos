import { z } from '@hono/zod-openapi'
import { SignedAuditEntrySchema } from './audit-entries'

/**
 * Tier 6 device fingerprint verification — request/response schemas for
 * `POST /api/hubs/:hubId/devices/:deviceId/verify`.
 *
 * The route accepts a `SignedAuditEntry` whose payload type is
 * `device_fingerprint_verified`. The wrapper object mirrors the historical
 * wire format (`{ signedEntry: ... }`) so that the OpenAPI spec faithfully
 * documents the same JSON shape clients have always sent.
 *
 * Error codes returned in the body of 400/500 responses are explicit string
 * literals — clients (notably the API E2E suite) discriminate on `body.code`
 * to assert which branch of validation tripped, so the union below is part
 * of the wire contract.
 */

export const DeviceVerificationParamsSchema = z.object({
  deviceId: z
    .string()
    .openapi({ param: { name: 'deviceId', in: 'path' }, example: 'device-abc123' }),
})
type DeviceVerificationParams = z.infer<typeof DeviceVerificationParamsSchema>

export const DeviceVerificationRequestSchema = z.object({
  signedEntry: SignedAuditEntrySchema,
})
type DeviceVerificationRequest = z.infer<typeof DeviceVerificationRequestSchema>

export const DeviceVerificationSuccessSchema = z.object({
  entryHash: z.string().regex(/^[0-9a-f]{64}$/),
  appendedAt: z.string().datetime(),
})
export type DeviceVerificationSuccess = z.infer<typeof DeviceVerificationSuccessSchema>

/**
 * Error codes returned by the device-verification endpoint. Clients
 * discriminate on these literals — DO NOT add or rename without updating
 * tests/api/device-fingerprint.spec.ts in lockstep.
 */
export const DeviceVerificationErrorCodeSchema = z.enum([
  'parse_error',
  'validation_failed',
  'payload_type_mismatch',
  'hub_id_mismatch',
  'device_id_mismatch',
  'signer_pubkey_mismatch',
  'server_error',
  // Surfaced by the audit chain service when an entry is rejected
  'prev_entry_hash_mismatch',
  'entry_hash_mismatch',
  'signature_invalid',
  'signer_unknown',
  'signer_not_authorized_for_payload',
  'chain_conflict',
])
type DeviceVerificationErrorCode = z.infer<typeof DeviceVerificationErrorCodeSchema>

export const DeviceVerificationErrorSchema = z.object({
  error: z.string(),
  code: DeviceVerificationErrorCodeSchema.optional(),
})
type DeviceVerificationError = z.infer<typeof DeviceVerificationErrorSchema>
