import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * Extract the first SHA-256 DTLS fingerprint from an SDP blob.
 * Returned fingerprint is normalized: lowercase hex with colons stripped.
 * Returns null when no `a=fingerprint:sha-256` line is present.
 */
export function extractFingerprintFromSdp(sdp: string): string | null {
  const match = sdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/i)
  if (!match) return null
  return match[1].replace(/:/g, '').toLowerCase()
}

/**
 * Compute the Nostr-published binding hash over a (fingerprint, callId) pair.
 * Used by call-initiators to attest which DTLS public key they will present,
 * and by peers to cross-check the SDP they actually receive.
 *
 * Format: SHA-256(fingerprint || '|' || callId), hex-encoded.
 */
export function computeBindingHash(fingerprint: string, callId: string): string {
  const input = utf8ToBytes(`${fingerprint}|${callId}`)
  return bytesToHex(sha256(input))
}

export interface AdvertisedBinding {
  fingerprint: string
  bindingHash: string
  callId: string
}

/**
 * Defense-in-depth for the DTLS-SRTP keying step:
 *  1. Re-hash the advertised fingerprint + callId and compare against the
 *     advertised binding hash (detects tampered KIND_DTLS_BINDING events).
 *  2. Extract the fingerprint from the actual SDP answer and compare against
 *     the advertised one (detects SFU-level DTLS MITM).
 *
 * Throws `dtls_binding_hash_mismatch`, `dtls_fingerprint_missing_in_sdp`, or
 * `dtls_fingerprint_mismatch` on failure. Returns `true` on success.
 */
export function verifyDtlsFingerprint(sdp: string, advertised: AdvertisedBinding): boolean {
  const recomputed = computeBindingHash(advertised.fingerprint, advertised.callId)
  if (recomputed !== advertised.bindingHash) {
    throw new Error('dtls_binding_hash_mismatch')
  }
  const sdpFingerprint = extractFingerprintFromSdp(sdp)
  if (!sdpFingerprint) throw new Error('dtls_fingerprint_missing_in_sdp')
  if (sdpFingerprint !== advertised.fingerprint) {
    throw new Error('dtls_fingerprint_mismatch')
  }
  return true
}
