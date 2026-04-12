import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { LABEL_SAS_V2 } from '@shared/crypto-labels'
import { SAS_EMOJI_NAMES_EN, SAS_EMOJI_TABLE } from './emoji-table'

/**
 * Derive a 7-emoji Short Authentication String from a device's Ed25519 public
 * key. Uses HKDF-SHA256 over the pubkey with a domain-separated label, then
 * packs 6-bit indices into the 64-entry emoji table.
 *
 * 7 x 6 bits = 42 bits of authentication entropy. Sufficient for casual
 * over-the-phone verification; not a replacement for a cryptographic signature.
 *
 * @throws if pubkey is not 32 bytes.
 */
export function deriveSasEmoji(devicePubkey: Uint8Array): readonly string[] {
  if (devicePubkey.length !== 32) {
    throw new Error(`SAS pubkey must be 32 bytes, got ${devicePubkey.length}`)
  }
  const indices = deriveSasIndices(devicePubkey)
  return indices.map((i) => SAS_EMOJI_TABLE[i])
}

/**
 * Parallel English name array for the 7-emoji SAS, used in the verification
 * modal for accessibility + ambiguity-breaking.
 */
export function deriveSasNamesEn(devicePubkey: Uint8Array): readonly string[] {
  const indices = deriveSasIndices(devicePubkey)
  return indices.map((i) => SAS_EMOJI_NAMES_EN[i])
}

function deriveSasIndices(devicePubkey: Uint8Array): number[] {
  // 7 x 6 bits = 42 bits — round up to 6 bytes.
  const raw = hkdf(
    sha256,
    devicePubkey,
    undefined,
    utf8ToBytes(LABEL_SAS_V2),
    6 // 48 bits; we use the first 42.
  )
  // Bit-unpack: read 48 bits as a bigint, then pull out 7 x 6-bit windows from the MSB.
  let bitBuf = 0n
  for (let i = 0; i < 6; i++) {
    bitBuf = (bitBuf << 8n) | BigInt(raw[i])
  }
  const indices: number[] = []
  for (let i = 0; i < 7; i++) {
    const shift = BigInt(42 - (i + 1) * 6)
    const mask = 0x3fn
    indices.push(Number((bitBuf >> shift) & mask))
  }
  return indices
}
