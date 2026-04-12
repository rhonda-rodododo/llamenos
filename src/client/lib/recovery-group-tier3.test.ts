import { describe, expect, test } from 'bun:test'
import { createHpkeSuite } from '@shared/crypto-suite'
import { unwrapSecretsFromRecoveryGroup, wrapSecretsForRecoveryGroup } from './recovery-group-tier3'

async function generateHpkeKeypair() {
  const suite = createHpkeSuite()
  return suite.kem.generateKeyPair()
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

describe('recovery-group-tier3', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000'

  test('wrap + unwrap round-trips for both seeds', async () => {
    const keypair = await generateHpkeKeypair()
    const masterSeed = randomBytes(32)
    const pukSeed = randomBytes(32)

    const wrapped = await wrapSecretsForRecoveryGroup({
      masterSeed,
      pukSeed,
      recoveryGroupPubkey: keypair.publicKey,
      userId,
    })

    expect(wrapped.masterSeedEnvelope.v).toBe(3)
    expect(wrapped.pukSeedEnvelope.v).toBe(3)

    const unwrapped = await unwrapSecretsFromRecoveryGroup({
      masterSeedEnvelope: wrapped.masterSeedEnvelope,
      pukSeedEnvelope: wrapped.pukSeedEnvelope,
      recoveryGroupPrivateKey: keypair.privateKey,
      userId,
    })

    expect(Buffer.from(unwrapped.masterSeed).equals(Buffer.from(masterSeed))).toBe(true)
    expect(Buffer.from(unwrapped.pukSeed).equals(Buffer.from(pukSeed))).toBe(true)
  })

  test('unwrap with wrong key fails', async () => {
    const keypair = await generateHpkeKeypair()
    const wrongKeypair = await generateHpkeKeypair()
    const masterSeed = randomBytes(32)
    const pukSeed = randomBytes(32)

    const wrapped = await wrapSecretsForRecoveryGroup({
      masterSeed,
      pukSeed,
      recoveryGroupPubkey: keypair.publicKey,
      userId,
    })

    await expect(
      unwrapSecretsFromRecoveryGroup({
        masterSeedEnvelope: wrapped.masterSeedEnvelope,
        pukSeedEnvelope: wrapped.pukSeedEnvelope,
        recoveryGroupPrivateKey: wrongKeypair.privateKey,
        userId,
      })
    ).rejects.toThrow()
  })

  test('AAD mismatch (wrong userId) fails', async () => {
    const keypair = await generateHpkeKeypair()
    const masterSeed = randomBytes(32)
    const pukSeed = randomBytes(32)

    const wrapped = await wrapSecretsForRecoveryGroup({
      masterSeed,
      pukSeed,
      recoveryGroupPubkey: keypair.publicKey,
      userId,
    })

    const wrongUserId = '660e8400-e29b-41d4-a716-446655440099'

    await expect(
      unwrapSecretsFromRecoveryGroup({
        masterSeedEnvelope: wrapped.masterSeedEnvelope,
        pukSeedEnvelope: wrapped.pukSeedEnvelope,
        recoveryGroupPrivateKey: keypair.privateKey,
        userId: wrongUserId,
      })
    ).rejects.toThrow()
  })

  test('master and PUK envelopes have distinct labelIds', async () => {
    const keypair = await generateHpkeKeypair()
    const masterSeed = randomBytes(32)
    const pukSeed = randomBytes(32)

    const wrapped = await wrapSecretsForRecoveryGroup({
      masterSeed,
      pukSeed,
      recoveryGroupPubkey: keypair.publicKey,
      userId,
    })

    expect(wrapped.masterSeedEnvelope.labelId).not.toBe(wrapped.pukSeedEnvelope.labelId)
  })
})
