import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
/**
 * Recovery Group share primitives.
 *
 *   generateRecoveryGroupKeyPair() → (RG_pub, RG_priv)  [secp256k1]
 *   splitRecoveryGroupSecret(secret, shares, threshold) → shares[]
 *   combineRecoveryGroupShares(shares) → secret
 *   commitShare(share)  → commitment (32 bytes SHA-256 hex)
 *   verifyShareCommitment(share, commitment) → bool
 *
 * Uses `shamir-secret-sharing` from privy-io — GF(2^8), Cure53/Zellic audited.
 * Note: the library does not verify reconstructed secrets, so the caller MUST
 * verify via the per-share SHA-256 commitment stored at enrollment.
 */
import { combine, split } from 'shamir-secret-sharing'

export class ShareCommitmentError extends Error {
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

export interface RecoveryGroupKeyPair {
  privateKey: Uint8Array /* 32 bytes, raw scalar */
  publicKey: Uint8Array /* 33 bytes, compressed */
}

export function generateRecoveryGroupKeyPair(): RecoveryGroupKeyPair {
  const privateKey = secp256k1.utils.randomSecretKey()
  const publicKey = secp256k1.getPublicKey(privateKey, true)
  return { privateKey, publicKey }
}
