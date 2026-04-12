import { z } from '@hono/zod-openapi'

/**
 * Tier 2 root-KEK envelope format (v3).
 *
 * The root KEK is a 256-bit non-extractable AES-KW CryptoKey living inside
 * the crypto worker. Each enrolled factor wraps the same root KEK under a
 * factor-specific wrapping key derived via HKDF-SHA256 from that factor's
 * secret bytes. A user with any ONE enrolled factor can unwrap the root KEK.
 *
 * Invariant: at rest the bundle MUST contain ≥2 distinct factor envelopes,
 * so losing a single factor never bricks the account.
 */

export const FactorTypeSchema = z.enum(['prf', 'opaque', 'recoveryPhrase', 'recoveryGroup'])
export type FactorType = z.infer<typeof FactorTypeSchema>

const HexRegex = /^[0-9a-f]+$/

export const RootKekEnvelopeSchema = z
  .object({
    v: z.literal(3),
    factorType: FactorTypeSchema,
    /**
     * Opaque per-factor identifier — e.g. a WebAuthn credential ID for PRF,
     * the server-issued OPAQUE record UUID, or a recovery-phrase UUID. Used
     * to match envelopes to the factor the client is unlocking with.
     */
    factorId: z.string().min(1).max(256),
    /**
     * HKDF salt (32 bytes hex) the client must supply to the worker to
     * rederive the same AES-KW wrapping key as was used at enrollment.
     */
    hkdfSalt: z.string().regex(HexRegex).length(64),
    /**
     * AES-KW wrapped root KEK bytes (raw-format wrapKey output → hex).
     * The exact length depends on the AES-KW padding mode but is constant
     * per key size; we store it as lower-bounded hex to avoid hard-coding.
     */
    wrappedKey: z.string().regex(HexRegex).min(64),
    createdAt: z.string().datetime(),
  })
  .strict()
export type RootKekEnvelope = z.infer<typeof RootKekEnvelopeSchema>

export const RootKekEnvelopeBundleSchema = z
  .object({
    v: z.literal(3),
    userId: z.string().uuid(),
    /**
     * Stable identifier for the wrapped root KEK itself. Rotating the KEK
     * changes this ID so clients can detect a stale bundle in IndexedDB.
     */
    rootKeyId: z.string().uuid(),
    envelopes: z.array(RootKekEnvelopeSchema).min(2),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (b) =>
      new Set(b.envelopes.map((e) => `${e.factorType}:${e.factorId}`)).size === b.envelopes.length,
    { message: 'envelopes must be unique per (factorType, factorId)' }
  )
export type RootKekEnvelopeBundle = z.infer<typeof RootKekEnvelopeBundleSchema>
