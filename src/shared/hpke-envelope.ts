import { z } from 'zod/v4'
import { LABEL_REGISTRY } from './crypto-labels.js'

/**
 * HPKE envelope — the single on-the-wire envelope format used for
 * per-recipient asymmetric encryption.
 *
 * Wire shape (JSON):
 *   {
 *     v: 3,
 *     labelId: <index into LABEL_REGISTRY>,
 *     enc: <base64url HPKE encapsulated key>,
 *     ct:  <base64url HPKE ciphertext (includes AEAD tag)>
 *   }
 *
 * `v: 3` is the wire version carried over from the migration away from the
 * legacy ECIES wire format — the `3` is frozen and lives here as a literal.
 * The TypeScript surface is version-agnostic (`HpkeEnvelope`).
 *
 * `labelId` is cross-checked at open time against the expected label the
 * caller asserts — a recipient who expected a different domain will refuse
 * to decrypt, giving us a second line of defense beyond AAD binding.
 *
 * AAD binding is NOT stored in the envelope; callers pass it at both seal
 * and open time. The canonical AAD format is
 *   `${label}:${recordId}:${fieldName}`
 * which binds the ciphertext to its row + column. Swapping encrypted blobs
 * across rows is rejected by AEAD. See `hpkeSeal`/`hpkeOpen` in
 * `src/shared/hpke-primitives.ts`.
 */
export interface HpkeEnvelope {
  v: 3
  labelId: number
  enc: string
  ct: string
}

/**
 * The CryptoLabel set that is valid on the wire. Keeps this schema and
 * LABEL_REGISTRY in lockstep — any label that can appear inside an envelope
 * MUST be in LABEL_REGISTRY (server-only labels are intentionally absent).
 */
const MAX_LABEL_ID = LABEL_REGISTRY.length - 1

export const HpkeEnvelopeSchema = z.object({
  v: z.literal(3),
  labelId: z.number().int().min(0).max(MAX_LABEL_ID),
  enc: z.string().min(1),
  ct: z.string().min(1),
}) satisfies z.ZodType<HpkeEnvelope>

type HpkeEnvelopeInput = z.input<typeof HpkeEnvelopeSchema>

/**
 * Type guard — accepts anything that already parses as a valid envelope.
 * Useful at the worker boundary where untrusted `unknown` crosses into
 * typed code.
 */
export function isHpkeEnvelope(value: unknown): value is HpkeEnvelope {
  return HpkeEnvelopeSchema.safeParse(value).success
}
