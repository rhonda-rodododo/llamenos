import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { LABEL_SAS_MLS_V3 } from '@shared/crypto-labels'
import { SAS_EMOJI_NAMES_EN, SAS_EMOJI_TABLE } from './emoji-table'

/**
 * Short Authentication String: a 7-emoji sequence that two parties compare
 * out-of-band (e.g. over the phone) to authenticate each other's device
 * public keys.
 *
 * # Security model
 *
 * The SAS is derived from THREE inputs:
 *
 * 1. The verifier's device pubkey
 * 2. The target's device pubkey
 * 3. A fresh per-session nonce
 *
 * Binding both pubkeys prevents a precomputation attack: an attacker who knows
 * a device's public key (which is, by definition, public) cannot pre-compute
 * the SAS the victim will see, because that SAS also depends on the victim's
 * own pubkey and on session-fresh randomness.
 *
 * The ordering of the two pubkeys is canonicalized by sorting them
 * lexicographically before concatenation, so both parties derive the same SAS
 * regardless of who calls themselves the "verifier" and who the "target".
 *
 * 7 x 6 bits = 42 bits of authentication entropy. Sufficient for casual
 * over-the-phone verification; not a replacement for a cryptographic
 * signature.
 */

/** 7-emoji SAS tuple — fixed length, compile-time enforced. */
type SasEmojiTuple = readonly [string, string, string, string, string, string, string]

/** 7-name SAS tuple (English, accessibility fallback for ambiguous emoji). */
type SasNamesTuple = readonly [string, string, string, string, string, string, string]

/**
 * Derive the 7-emoji SAS that both parties in a fingerprint verification
 * session should see. Takes the verifier's and target's device pubkeys plus a
 * fresh session nonce. The ordering of the two pubkeys is canonicalized, so
 * calling this with `(a, b, n)` or `(b, a, n)` produces the same result.
 *
 * @throws if either pubkey is not 32 bytes or the nonce is empty.
 */
export function deriveSasEmoji(
  verifierPubkey: Uint8Array,
  targetPubkey: Uint8Array,
  nonce: Uint8Array
): SasEmojiTuple {
  const indices = deriveSasIndices(verifierPubkey, targetPubkey, nonce)
  return [
    SAS_EMOJI_TABLE[indices[0]],
    SAS_EMOJI_TABLE[indices[1]],
    SAS_EMOJI_TABLE[indices[2]],
    SAS_EMOJI_TABLE[indices[3]],
    SAS_EMOJI_TABLE[indices[4]],
    SAS_EMOJI_TABLE[indices[5]],
    SAS_EMOJI_TABLE[indices[6]],
  ] as const
}

/**
 * Parallel English name tuple for the 7-emoji SAS, used in the verification
 * modal for accessibility and ambiguity-breaking. Same inputs and semantics as
 * {@link deriveSasEmoji}.
 */
export function deriveSasNamesEn(
  verifierPubkey: Uint8Array,
  targetPubkey: Uint8Array,
  nonce: Uint8Array
): SasNamesTuple {
  const indices = deriveSasIndices(verifierPubkey, targetPubkey, nonce)
  return [
    SAS_EMOJI_NAMES_EN[indices[0]],
    SAS_EMOJI_NAMES_EN[indices[1]],
    SAS_EMOJI_NAMES_EN[indices[2]],
    SAS_EMOJI_NAMES_EN[indices[3]],
    SAS_EMOJI_NAMES_EN[indices[4]],
    SAS_EMOJI_NAMES_EN[indices[5]],
    SAS_EMOJI_NAMES_EN[indices[6]],
  ] as const
}

function deriveSasIndices(
  verifierPubkey: Uint8Array,
  targetPubkey: Uint8Array,
  nonce: Uint8Array
): readonly [number, number, number, number, number, number, number] {
  if (verifierPubkey.length !== 32) {
    throw new Error(`SAS verifier pubkey must be 32 bytes, got ${verifierPubkey.length}`)
  }
  if (targetPubkey.length !== 32) {
    throw new Error(`SAS target pubkey must be 32 bytes, got ${targetPubkey.length}`)
  }
  if (nonce.length === 0) {
    throw new Error('SAS nonce must be non-empty')
  }

  // Canonicalize: sort the two pubkeys lexicographically so both parties
  // derive the same SAS regardless of who calls themselves verifier/target.
  const [lo, hi] =
    compareBytes(verifierPubkey, targetPubkey) <= 0
      ? [verifierPubkey, targetPubkey]
      : [targetPubkey, verifierPubkey]

  // IKM = lo || hi || nonce. All three components bound into the same HKDF
  // input so neither can be swapped without altering the output.
  const ikm = new Uint8Array(lo.length + hi.length + nonce.length)
  ikm.set(lo, 0)
  ikm.set(hi, lo.length)
  ikm.set(nonce, lo.length + hi.length)

  // Request 6 bytes (48 bits); we extract 7 x 6-bit indices (42 bits used).
  const raw = hkdf(sha256, ikm, undefined, utf8ToBytes(LABEL_SAS_MLS_V3), 6)

  // Bit-unpack: read 48 bits as a bigint, then pull out 7 x 6-bit windows from the MSB.
  let bitBuf = 0n
  for (let i = 0; i < 6; i++) {
    bitBuf = (bitBuf << 8n) | BigInt(raw[i])
  }
  const out: number[] = []
  for (let i = 0; i < 7; i++) {
    const shift = BigInt(42 - (i + 1) * 6)
    const mask = 0x3fn
    out.push(Number((bitBuf >> shift) & mask))
  }
  return [out[0], out[1], out[2], out[3], out[4], out[5], out[6]] as const
}

/** Lexicographic byte-wise comparison. Returns negative/zero/positive. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}
