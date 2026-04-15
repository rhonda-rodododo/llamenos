import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
/**
 * Recovery Group share primitives.
 *
 *   generateRecoveryGroupKeyPair() → (RG_pub, RG_priv)  [secp256k1]
 *   splitRecoveryGroupSecret(secret, shares, threshold) → shares[]
 *   combineRecoveryGroupShares(shares) → secret  (no verification!)
 *   combineAndVerifyShares(shares, commitments) → secret (verified)
 *   commitShare(share)  → commitment (32 bytes SHA-256 hex)
 *   verifyShareCommitment(share, commitment) → bool
 *
 * Uses `shamir-secret-sharing` from privy-io — GF(2^8), Cure53/Zellic audited.
 *
 * IMPORTANT: The library does NOT verify reconstructed secrets. With fewer
 * shares than the threshold, `combine()` returns silently wrong bytes — not
 * an error. Callers MUST use `combineAndVerifyShares()` to verify each share's
 * SHA-256 commitment before combination and validate the result. Given N
 * total shares, any K (threshold) shares suffice to reconstruct the secret;
 * K-1 or fewer shares reveal zero information (information-theoretic security).
 */
import { combine, split } from 'shamir-secret-sharing'

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
): Promise<Uint8Array[]> {
  if (totalShares < 3 || totalShares > 5) {
    throw new Error(`totalShares must be 3..5, got ${totalShares}`)
  }
  if (threshold < 2 || threshold > totalShares) {
    throw new Error(`threshold must be 2..${totalShares}, got ${threshold}`)
  }
  return split(secret, totalShares, threshold)
}

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
 * Verify each share against its commitment, then combine. Throws
 * ShareCommitmentError with the failing index if any share is tampered.
 *
 * This is the only safe way to reconstruct a secret — raw
 * `combineRecoveryGroupShares` returns garbage for below-threshold or
 * tampered shares with no error.
 */
async function combineAndVerifyShares(
  shares: Uint8Array[],
  commitments: string[]
): Promise<Uint8Array> {
  if (shares.length !== commitments.length) {
    throw new ShareCommitmentError(
      `share/commitment count mismatch: ${shares.length} shares vs ${commitments.length} commitments`
    )
  }
  if (shares.length < 2) {
    throw new ShareCommitmentError(`need at least 2 shares, got ${shares.length}`)
  }
  for (let i = 0; i < shares.length; i++) {
    const valid = await verifyShareCommitment(shares[i]!, commitments[i]!)
    if (!valid) {
      throw new ShareCommitmentError(`share at index ${i} does not match its commitment`)
    }
  }
  return combine(shares)
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
