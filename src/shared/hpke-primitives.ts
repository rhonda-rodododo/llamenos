import { type CryptoLabel, idToLabel, labelToId } from './crypto-labels.js'
import { createHpkeSuite } from './crypto-suite.js'
import { type HpkeEnvelope, HpkeEnvelopeSchema } from './hpke-envelope.js'

/**
 * Thrown when an HpkeEnvelope's embedded labelId does not match the caller's
 * expected CryptoLabel, or when the envelope version is not 3.
 *
 * This is the "belt" of the belt-and-suspenders label defense: even if an
 * attacker swaps envelopes between columns that share a recipient key, the
 * wire-format labelId check catches the mismatch before we hand the cipher
 * text to HPKE. The "suspenders" is AEAD AAD binding (see `buildAad`).
 */
export class HpkeLabelMismatchError extends Error {
  constructor(detail: string | { expected: CryptoLabel; actual: CryptoLabel }) {
    const msg =
      typeof detail === 'string'
        ? detail
        : `HPKE label mismatch: expected ${detail.expected}, got ${detail.actual}`
    super(msg)
    this.name = 'HpkeLabelMismatchError'
  }
}

/**
 * Canonical AAD format for field-level envelopes.
 * Binds the ciphertext to (domain, row, column) so cross-row or cross-column
 * swap attacks are rejected at AEAD-open time.
 *
 * Callers that encrypt something without a stable row/column identity
 * (e.g. key-wrap for hub key distribution) should still pass a meaningful
 * AAD — typically `buildAad(label, memberPubkey, 'hub-key-wrap')`.
 */
export function buildAad(label: CryptoLabel, recordId: string, fieldName: string): Uint8Array {
  return new TextEncoder().encode(`${label}:${recordId}:${fieldName}`)
}

function b64encode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function b64decode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * HPKE single-shot seal. Produces an HpkeEnvelope bound to (label, AAD).
 *
 * Uses the `@hpke/core` base-mode HPKE (no PSK, no authenticated mode): the
 * sender is anonymous and the recipient authenticates via their private key.
 * Suitable for all field-level encryption and key-wrap paths.
 *
 * @param plaintext           Bytes to encrypt.
 * @param recipientPublicKey  Recipient's HPKE public key (CryptoKey — non-extractable is fine).
 * @param label               The domain-separation CryptoLabel; stamped into the envelope.
 * @param aad                 Additional authenticated data (see `buildAad`).
 */
export async function hpkeSeal(
  plaintext: Uint8Array,
  recipientPublicKey: CryptoKey,
  label: CryptoLabel,
  aad: Uint8Array
): Promise<HpkeEnvelope> {
  const suite = createHpkeSuite()
  const sender = await suite.createSenderContext({
    recipientPublicKey,
    info: new TextEncoder().encode(label),
  })
  const ct = new Uint8Array(await sender.seal(plaintext, aad))
  return {
    v: 3,
    labelId: labelToId(label),
    enc: b64encode(new Uint8Array(sender.enc)),
    ct: b64encode(ct),
  }
}

/**
 * HPKE single-shot open with mandatory label + version cross-check.
 *
 * Defense layers, outermost first:
 *   1. Envelope shape (schema parse)      — rejects malformed JSON/bytes
 *   2. Version check (v === 3)            — rejects stale V2 blobs
 *   3. Label ID cross-check                — rejects swapped-domain blobs
 *   4. HPKE `info` = label                 — binds the key schedule to the
 *      label so any mismatch fails decap before AEAD
 *   5. HPKE open with AAD binding          — rejects swapped-row/column blobs
 *
 * Any failure throws; callers must not fall through to legacy paths.
 *
 * @param envelope             HpkeEnvelope (already parsed into the interface).
 * @param recipientPrivateKey  Recipient's HPKE private key (CryptoKey).
 * @param expectedLabel        The CryptoLabel the caller expects this envelope to carry.
 * @param aad                  Additional authenticated data (must match what was passed to seal).
 */
export async function hpkeOpen(
  envelope: HpkeEnvelope,
  recipientPrivateKey: CryptoKey,
  expectedLabel: CryptoLabel,
  aad: Uint8Array
): Promise<Uint8Array> {
  if (envelope.v !== 3) {
    throw new HpkeLabelMismatchError(`Envelope version ${envelope.v as number} not supported`)
  }
  const actualLabel = idToLabel(envelope.labelId)
  if (actualLabel !== expectedLabel) {
    throw new HpkeLabelMismatchError({ expected: expectedLabel, actual: actualLabel })
  }

  const suite = createHpkeSuite()
  const recipient = await suite.createRecipientContext({
    recipientKey: recipientPrivateKey,
    enc: b64decode(envelope.enc),
    info: new TextEncoder().encode(expectedLabel),
  })
  const pt = await recipient.open(b64decode(envelope.ct), aad)
  return new Uint8Array(pt)
}

/**
 * Higher-level decrypt that also validates the envelope shape. Use this at
 * trust boundaries where `envelope` arrives as `unknown` (worker messages,
 * API responses). For already-typed `HpkeEnvelope` values inside the app, use
 * `hpkeOpen` directly to skip the redundant parse.
 */
export async function decryptHpkeEnvelope(
  envelope: unknown,
  recipientPrivateKey: CryptoKey,
  expectedLabel: CryptoLabel,
  aad: Uint8Array
): Promise<Uint8Array> {
  const parsed = HpkeEnvelopeSchema.parse(envelope)
  return hpkeOpen(parsed, recipientPrivateKey, expectedLabel, aad)
}
