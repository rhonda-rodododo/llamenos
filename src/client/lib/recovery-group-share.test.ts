import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  type ShamirShare,
  type VerifiedShare,
  combineAndVerifyShares,
  commitShare,
  generateRecoveryGroupKeyPair,
  splitRecoveryGroupSecret,
  verifyAndBrandShare,
  verifyShareCommitment,
} from './recovery-group-share'

/** Helper: commit all shares and verify-brand them in one step. */
async function commitAndVerifyAll(shares: ShamirShare[]): Promise<VerifiedShare[]> {
  return Promise.all(shares.map(async (s) => verifyAndBrandShare(s, await commitShare(s))))
}

describe('Shamir recovery group', () => {
  test('2-of-3 split + combine recovers the secret', async () => {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    const shares = await splitRecoveryGroupSecret(secret, 3, 2)
    expect(shares).toHaveLength(3)
    const verified = await commitAndVerifyAll([shares[0]!, shares[1]!])
    const recovered = await combineAndVerifyShares(verified)
    expect(bytesToHex(recovered)).toBe(bytesToHex(secret))
  })

  test('2-of-3 recovers with any 2 shares', async () => {
    const secret = new Uint8Array(32).fill(5)
    const shares = await splitRecoveryGroupSecret(secret, 3, 2)
    const v01 = await commitAndVerifyAll([shares[0]!, shares[1]!])
    const v02 = await commitAndVerifyAll([shares[0]!, shares[2]!])
    const v12 = await commitAndVerifyAll([shares[1]!, shares[2]!])
    const r1 = await combineAndVerifyShares(v01)
    const r2 = await combineAndVerifyShares(v02)
    const r3 = await combineAndVerifyShares(v12)
    expect(bytesToHex(r1)).toBe(bytesToHex(secret))
    expect(bytesToHex(r2)).toBe(bytesToHex(secret))
    expect(bytesToHex(r3)).toBe(bytesToHex(secret))
  })

  test('combining with 1 share throws (threshold boundary)', async () => {
    const secret = new Uint8Array(32).fill(5)
    const shares = await splitRecoveryGroupSecret(secret, 3, 2)
    const [v0] = await commitAndVerifyAll([shares[0]!])
    await expect(combineAndVerifyShares([v0!])).rejects.toThrow()
  })

  test('3-of-5 split/combine round-trips', async () => {
    const secret = new Uint8Array(32).fill(9)
    const shares = await splitRecoveryGroupSecret(secret, 5, 3)
    expect(shares).toHaveLength(5)
    const verified = await commitAndVerifyAll([shares[0]!, shares[2]!, shares[4]!])
    const recovered = await combineAndVerifyShares(verified)
    expect(bytesToHex(recovered)).toBe(bytesToHex(secret))
  })

  test('commitShare + verifyShareCommitment round-trip', async () => {
    const share = new Uint8Array(33).fill(1)
    const commitment = await commitShare(share)
    expect(await verifyShareCommitment(share, commitment)).toBe(true)
  })

  test('verifyShareCommitment rejects a tampered share', async () => {
    const share = new Uint8Array(33).fill(1)
    const commitment = await commitShare(share)
    const tampered = new Uint8Array(share)
    tampered[0] = 255
    expect(await verifyShareCommitment(tampered, commitment)).toBe(false)
  })

  test('verifyAndBrandShare returns VerifiedShare on valid commitment', async () => {
    const secret = new Uint8Array(32).fill(7)
    const [share] = await splitRecoveryGroupSecret(secret, 3, 2)
    const commitment = await commitShare(share!)
    const verified = await verifyAndBrandShare(share!, commitment)
    // VerifiedShare is a Uint8Array at runtime
    expect(verified).toBeInstanceOf(Uint8Array)
  })

  test('verifyAndBrandShare throws on mismatched commitment', async () => {
    const secret = new Uint8Array(32).fill(7)
    const [share] = await splitRecoveryGroupSecret(secret, 3, 2)
    const badCommitment = 'a'.repeat(64) // wrong hex
    await expect(verifyAndBrandShare(share!, badCommitment)).rejects.toThrow(
      'Share commitment error'
    )
  })

  test('generateRecoveryGroupKeyPair returns a valid secp256k1 pubkey', () => {
    const { publicKey, privateKey } = generateRecoveryGroupKeyPair()
    expect(privateKey.length).toBe(32)
    const derived = secp256k1.getPublicKey(privateKey, true)
    expect(bytesToHex(derived)).toBe(bytesToHex(publicKey))
  })

  test('rejects totalShares < 3', async () => {
    const secret = new Uint8Array(32)
    await expect(splitRecoveryGroupSecret(secret, 2, 2)).rejects.toThrow(/totalShares/)
  })

  test('rejects totalShares > 5', async () => {
    const secret = new Uint8Array(32)
    await expect(splitRecoveryGroupSecret(secret, 6, 2)).rejects.toThrow(/totalShares/)
  })

  test('rejects threshold < 2', async () => {
    const secret = new Uint8Array(32)
    await expect(splitRecoveryGroupSecret(secret, 3, 1)).rejects.toThrow(/threshold/)
  })

  test('rejects threshold > totalShares', async () => {
    const secret = new Uint8Array(32)
    await expect(splitRecoveryGroupSecret(secret, 3, 4)).rejects.toThrow(/threshold/)
  })
})
