import { z } from '@hono/zod-openapi'

/**
 * OPAQUE (RFC 9807) wire schemas.
 *
 * All byte payloads cross the network as base64url-encoded strings so they
 * are safe inside JSON bodies. The Rust WASM wrapper handles decoding.
 *
 * Identifiers:
 *   - `credentialIdentifier` is the stable server-side handle for an OPAQUE
 *     record. We use `{userId}:{purpose}` so one user can have multiple
 *     independent OPAQUE registrations (per hub, or per recovery role).
 *   - `sessionId` ties a client's *_start call to its *_finish call so the
 *     server can look up the ephemeral `state` stashed in memory.
 */

const Base64Url = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(4096)

export const OpaquePurposeSchema = z.enum(['root-kek', 'recovery-phrase', 'recovery-group'])
export type OpaquePurpose = z.infer<typeof OpaquePurposeSchema>

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const OpaqueRegistrationStartRequestSchema = z
  .object({
    purpose: OpaquePurposeSchema,
    credentialIdentifier: z.string().min(1).max(256),
    registrationRequest: Base64Url,
  })
  .strict()
export type OpaqueRegistrationStartRequest = z.infer<typeof OpaqueRegistrationStartRequestSchema>

export const OpaqueRegistrationStartResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    registrationResponse: Base64Url,
  })
  .strict()
export type OpaqueRegistrationStartResponse = z.infer<typeof OpaqueRegistrationStartResponseSchema>

export const OpaqueRegistrationFinishRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    credentialIdentifier: z.string().min(1).max(256),
    registrationUpload: Base64Url,
  })
  .strict()
export type OpaqueRegistrationFinishRequest = z.infer<typeof OpaqueRegistrationFinishRequestSchema>

export const OpaqueRegistrationFinishResponseSchema = z
  .object({
    ok: z.literal(true),
    credentialIdentifier: z.string(),
  })
  .strict()
export type OpaqueRegistrationFinishResponse = z.infer<
  typeof OpaqueRegistrationFinishResponseSchema
>

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const OpaqueLoginStartRequestSchema = z
  .object({
    purpose: OpaquePurposeSchema,
    credentialIdentifier: z.string().min(1).max(256),
    credentialRequest: Base64Url,
  })
  .strict()
export type OpaqueLoginStartRequest = z.infer<typeof OpaqueLoginStartRequestSchema>

export const OpaqueLoginStartResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    credentialResponse: Base64Url,
  })
  .strict()
export type OpaqueLoginStartResponse = z.infer<typeof OpaqueLoginStartResponseSchema>

export const OpaqueLoginFinishRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    credentialFinalization: Base64Url,
  })
  .strict()
export type OpaqueLoginFinishRequest = z.infer<typeof OpaqueLoginFinishRequestSchema>

export const OpaqueLoginFinishResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict()
export type OpaqueLoginFinishResponse = z.infer<typeof OpaqueLoginFinishResponseSchema>
