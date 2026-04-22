import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
/**
 * Recovery Group share primitives.
 *
 *   generateRecoveryGroupKeyPair() → (RG_pub, RG_priv)  [secp256k1]
 *   splitRecoveryGroupSecret(secret, shares, threshold) → ShamirShare[]
 *   verifyAndBrandShare(share, commitment) → VerifiedShare (throws on mismatch)
 *   combineAndVerifyShares(verifiedShares) → secret
 *   commitShare(share)  → commitment (32 bytes SHA-256 hex)
 *   verifyShareCommitment(share, commitment) → bool
 *
 * Uses `shamir-secret-sharing` from privy-io — GF(2^8), Cure53/Zellic audited.
 *
 * IMPORTANT: The library does NOT verify reconstructed secrets. With fewer
 * shares than the threshold, `combine()` returns silently wrong bytes — not
 * an error. Callers MUST use `combineAndVerifyShares()` with `VerifiedShare`
 * values (produced by `verifyAndBrandShare`) to ensure each share has passed
 * its SHA-256 commitment check before combination. Given N total shares, any
 * K (threshold) shares suffice to reconstruct the secret; K-1 or fewer shares
 * reveal zero information (information-theoretic security).
 */
import { combine, split } from 'shamir-secret-sharing'

// ---------------------------------------------------------------------------
// Branded Uint8Array types for Shamir shares
//
// `ShamirShare` is a raw share produced by `split()` — correct bytes but
// unverified against any commitment.
//
// `VerifiedShare` is a share that has passed its SHA-256 commitment check via
// `verifyAndBrandShare`. Only `VerifiedShare` values may be passed to
// `combineAndVerifyShares`, making it a compile-time error to reconstruct a
// secret from unverified material.
//
// The phantom symbol (`__brand`) lives only in the type system; at runtime
// both types are plain Uint8Arrays.
// ---------------------------------------------------------------------------

/** Raw Shamir share — produced by `splitRecoveryGroupSecret`, not yet verified. */
export type ShamirShare = Uint8Array & { readonly __brand: 'ShamirShare' }

/** Commitment-verified Shamir share — produced by `verifyAndBrandShare`. */
export type VerifiedShare = Uint8Array & { readonly __brand: 'VerifiedShare' }

class ShareCommitmentError extends Error {
  constructor(detail: string) {
    super(`Share commitment error: ${detail}`)
    this.name = 'ShareCommitmentError'
  }
}

export async function splitRecoveryGroupSecret(
  secret: Uint8Array,
  totalShares: number,
  threshold: number
): Promise<ShamirShare[]> {
  if (totalShares < 3 || totalShares > 5) {
    throw new Error(`totalShares must be 3..5, got ${totalShares}`)
  }
  if (threshold < 2 || threshold > totalShares) {
    throw new Error(`threshold must be 2..${totalShares}, got ${threshold}`)
  }
  const raw = await split(secret, totalShares, threshold)
  return raw as ShamirShare[]
}

/** @knipignore — recovery group share combination; used by recovery completion flow (not yet built) */
export async function combineRecoveryGroupShares(shares: Uint8Array[]): Promise<Uint8Array> {
  if (shares.length < 2) {
    throw new Error(`combine requires at least 2 shares, got ${shares.length}`)
  }
  return combine(shares)
}

export async function commitShare(share: Uint8Array): Promise<string> {
  return bytesToHex(sha256(share))
}

export async function verifyShareCommitment(
  share: Uint8Array,
  commitment: string
): Promise<boolean> {
  const actual = await commitShare(share)
  return actual === commitment
}

/**
 * Verify a raw share against its commitment and return a branded `VerifiedShare`.
 * Throws `ShareCommitmentError` if the share does not match the commitment.
 */
export async function verifyAndBrandShare(
  share: ShamirShare,
  commitment: string
): Promise<VerifiedShare> {
  const valid = await verifyShareCommitment(share, commitment)
  if (!valid) {
    throw new ShareCommitmentError('share does not match its commitment')
  }
  return share as unknown as VerifiedShare
}

/**
 * Combine pre-verified shares to reconstruct the secret.
 *
 * Each share must be a `VerifiedShare` — produced by `verifyAndBrandShare` —
 * ensuring its SHA-256 commitment was checked before this call. This makes it
 * a compile-time error to pass unverified `ShamirShare` values here.
 *
 * With fewer shares than the threshold, the library returns silently wrong
 * bytes; callers must ensure at least `threshold` shares are provided.
 */
export async function combineAndVerifyShares(shares: VerifiedShare[]): Promise<Uint8Array> {
  if (shares.length < 2) {
    throw new ShareCommitmentError(`need at least 2 shares, got ${shares.length}`)
  }
  return combineRecoveryGroupShares(shares)
}

interface RecoveryGroupKeyPair {
  privateKey: Uint8Array /* 32 bytes, raw scalar */
  publicKey: Uint8Array /* 33 bytes, compressed */
}

export function generateRecoveryGroupKeyPair(): RecoveryGroupKeyPair {
  const privateKey = secp256k1.utils.randomSecretKey()
  const publicKey = secp256k1.getPublicKey(privateKey, true)
  return { privateKey, publicKey }
}
