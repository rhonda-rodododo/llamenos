import { z } from 'zod/v4'
import { LABEL_REGISTRY } from './crypto-labels.js'

/**
 * Tier 1 HPKE envelope. Replaces EnvelopeV2's ECIES wire format.
 *
 * Wire shape (JSON):
 *   {
 *     v: 3,
 *     labelId: <index into LABEL_REGISTRY>,
 *     enc: <base64url HPKE encapsulated key>,
 *     ct:  <base64url HPKE ciphertext (includes AEAD tag)>
 *   }
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
 * `src/shared/crypto-primitives.ts`.
 */
export interface EnvelopeV3 {
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

export const EnvelopeV3Schema = z.object({
  v: z.literal(3),
  labelId: z.number().int().min(0).max(MAX_LABEL_ID),
  enc: z.string().min(1),
  ct: z.string().min(1),
}) satisfies z.ZodType<EnvelopeV3>

export type EnvelopeV3Input = z.input<typeof EnvelopeV3Schema>

/**
 * Type guard — accepts anything that already parses as a valid V3 envelope.
 * Useful at the worker boundary where untrusted `unknown` crosses into
 * typed code.
 */
export function isEnvelopeV3(value: unknown): value is EnvelopeV3 {
  return EnvelopeV3Schema.safeParse(value).success
}
