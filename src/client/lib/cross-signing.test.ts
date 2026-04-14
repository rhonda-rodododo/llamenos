import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  computeDeviceFingerprint,
  createMasterKey,
  crossSignOtherUser,
  crossSignOwnDevice,
  deriveMasterFromWrapped,
  deriveSelfSigningPubFromMasterSeed,
  verifyCrossSignature,
  verifyTransitiveTrust,
} from './cross-signing'

/** Create a fresh AES-GCM-256 key for PUK SecretBox wrapping. */
async function makeSecretBoxKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Generate a fresh Ed25519 keypair for testing. */
async function makeEd25519Keypair(): Promise<{
  privateKey: CryptoKey
  publicKey: CryptoKey
  publicKeyRaw: Uint8Array
}> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyRaw: pubRaw }
}

describe('cross-signing', () => {
  // ---- Task 27: Master key creation ----

  describe('createMasterKey', () => {
    test('produces master, self-signing, and user-signing pubkeys (all 32 bytes)', async () => {
      const sbKey = await makeSecretBoxKey()
      const result = await createMasterKey({ pukSecretBoxKey: sbKey })

      expect(result.masterPubkey).toBeInstanceOf(Uint8Array)
      expect(result.masterPubkey.length).toBe(32)

      expect(result.selfSigningPubkey).toBeInstanceOf(Uint8Array)
      expect(result.selfSigningPubkey.length).toBe(32)

      expect(result.userSigningPubkey).toBeInstanceOf(Uint8Array)
      expect(result.userSigningPubkey.length).toBe(32)

      // All three pubkeys must be distinct
      expect(bytesToHex(result.masterPubkey)).not.toBe(bytesToHex(result.selfSigningPubkey))
      expect(bytesToHex(result.masterPubkey)).not.toBe(bytesToHex(result.userSigningPubkey))
      expect(bytesToHex(result.selfSigningPubkey)).not.toBe(bytesToHex(result.userSigningPubkey))

      // Wrapped seed is hex (iv 12 + ciphertext with 16-byte tag = at least 28 bytes = 56 hex)
      expect(result.masterSeedWrappedUnderPuk).toMatch(/^[0-9a-f]+$/)
      expect(result.masterSeedWrappedUnderPuk.length).toBeGreaterThanOrEqual(56)
    })
  })

  describe('deriveMasterFromWrapped', () => {
    test('round-trips: pubkeys match original createMasterKey output', async () => {
      const sbKey = await makeSecretBoxKey()
      const original = await createMasterKey({ pukSecretBoxKey: sbKey })

      const restored = await deriveMasterFromWrapped({
        wrapped: original.masterSeedWrappedUnderPuk,
        pukSecretBoxKey: sbKey,
      })

      expect(bytesToHex(restored.masterPubkey)).toBe(bytesToHex(original.masterPubkey))
      expect(bytesToHex(restored.selfSigningPubkey)).toBe(bytesToHex(original.selfSigningPubkey))
      expect(bytesToHex(restored.userSigningPubkey)).toBe(bytesToHex(original.userSigningPubkey))
    })

    test('fails with wrong SecretBox key', async () => {
      const sbKey1 = await makeSecretBoxKey()
      const sbKey2 = await makeSecretBoxKey()
      const original = await createMasterKey({ pukSecretBoxKey: sbKey1 })

      await expect(
        deriveMasterFromWrapped({
          wrapped: original.masterSeedWrappedUnderPuk,
          pukSecretBoxKey: sbKey2,
        })
      ).rejects.toThrow()
    })
  })

  // ---- Task 28: Device cross-signing ----

  describe('crossSignOwnDevice', () => {
    test('produces valid Ed25519 signature verifiable with self-signing pubkey', async () => {
      const sbKey = await makeSecretBoxKey()
      const master = await createMasterKey({ pukSecretBoxKey: sbKey })

      // Simulate a device signing pubkey
      const device = await makeEd25519Keypair()

      const payload = await crossSignOwnDevice({
        deviceSigningPubkey: device.publicKeyRaw,
        selfSigningPrivate: master.selfSigningPrivate,
        signerDeviceId: 'signer-device-1',
        targetDeviceId: 'target-device-2',
      })

      expect(payload.type).toBe('device_cross_sign')
      expect(payload.signerDeviceId).toBe('signer-device-1')
      expect(payload.targetDeviceId).toBe('target-device-2')
      expect(payload.targetSigningPubkey).toBe(bytesToHex(device.publicKeyRaw))
      expect(payload.signature).toMatch(/^[0-9a-f]{128}$/) // 64-byte Ed25519 sig

      // Verify the signature using self-signing pubkey
      const valid = await verifyCrossSignature({
        signature: payload.signature,
        signerPublicKey: master.selfSigningPubkey,
        signedData: device.publicKeyRaw,
      })
      expect(valid).toBe(true)
    })
  })

  // ---- Task 29: User-to-user cross-signing ----

  describe('crossSignOtherUser', () => {
    test('produces valid signature verifiable with user-signing pubkey', async () => {
      const sbKey = await makeSecretBoxKey()
      const signerMaster = await createMasterKey({ pukSecretBoxKey: sbKey })
      const targetMaster = await createMasterKey({ pukSecretBoxKey: sbKey })

      const payload = await crossSignOtherUser({
        targetMasterPubkey: targetMaster.masterPubkey,
        userSigningPrivate: signerMaster.userSigningPrivate,
        signerUserId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '22222222-2222-2222-2222-222222222222',
      })

      expect(payload.type).toBe('user_cross_sign')
      expect(payload.signerUserId).toBe('11111111-1111-1111-1111-111111111111')
      expect(payload.targetUserId).toBe('22222222-2222-2222-2222-222222222222')
      expect(payload.targetMasterPubkey).toBe(bytesToHex(targetMaster.masterPubkey))
      expect(payload.signature).toMatch(/^[0-9a-f]{128}$/)

      // Verify the signature using user-signing pubkey
      const valid = await verifyCrossSignature({
        signature: payload.signature,
        signerPublicKey: signerMaster.userSigningPubkey,
        signedData: targetMaster.masterPubkey,
      })
      expect(valid).toBe(true)
    })
  })

  describe('verifyCrossSignature', () => {
    test('rejects tampered signature', async () => {
      const sbKey = await makeSecretBoxKey()
      const master = await createMasterKey({ pukSecretBoxKey: sbKey })
      const device = await makeEd25519Keypair()

      const payload = await crossSignOwnDevice({
        deviceSigningPubkey: device.publicKeyRaw,
        selfSigningPrivate: master.selfSigningPrivate,
        signerDeviceId: 'dev-1',
        targetDeviceId: 'dev-2',
      })

      // Tamper with the signature (flip a hex char)
      const tampered =
        payload.signature[0] === 'a'
          ? `b${payload.signature.slice(1)}`
          : `a${payload.signature.slice(1)}`

      const valid = await verifyCrossSignature({
        signature: tampered,
        signerPublicKey: master.selfSigningPubkey,
        signedData: device.publicKeyRaw,
      })
      expect(valid).toBe(false)
    })

    test('rejects signature verified against wrong pubkey', async () => {
      const sbKey = await makeSecretBoxKey()
      const master1 = await createMasterKey({ pukSecretBoxKey: sbKey })
      const master2 = await createMasterKey({ pukSecretBoxKey: sbKey })
      const device = await makeEd25519Keypair()

      const payload = await crossSignOwnDevice({
        deviceSigningPubkey: device.publicKeyRaw,
        selfSigningPrivate: master1.selfSigningPrivate,
        signerDeviceId: 'dev-1',
        targetDeviceId: 'dev-2',
      })

      // Verify against master2's self-signing pubkey (wrong)
      const valid = await verifyCrossSignature({
        signature: payload.signature,
        signerPublicKey: master2.selfSigningPubkey,
        signedData: device.publicKeyRaw,
      })
      expect(valid).toBe(false)
    })
  })

  describe('verifyTransitiveTrust', () => {
    test('passes for valid chain', async () => {
      const sbKey = await makeSecretBoxKey()
      const userA = await createMasterKey({ pukSecretBoxKey: sbKey })
      const userB = await createMasterKey({ pukSecretBoxKey: sbKey })
      const deviceD = await makeEd25519Keypair()

      // User A cross-signs user B's master pubkey
      const crossSign = await crossSignOtherUser({
        targetMasterPubkey: userB.masterPubkey,
        userSigningPrivate: userA.userSigningPrivate,
        signerUserId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '22222222-2222-2222-2222-222222222222',
      })

      // User B self-signs device D
      const selfSign = await crossSignOwnDevice({
        deviceSigningPubkey: deviceD.publicKeyRaw,
        selfSigningPrivate: userB.selfSigningPrivate,
        signerDeviceId: 'b-device-1',
        targetDeviceId: 'b-device-2',
      })

      const valid = await verifyTransitiveTrust({
        trustingUserSigningPub: userA.userSigningPubkey,
        crossSignature: crossSign.signature,
        candidateMasterSeed: userB.masterSeed,
        candidateMasterPub: userB.masterPubkey,
        selfSignSignature: selfSign.signature,
        candidateDevicePub: deviceD.publicKeyRaw,
        candidateSelfSigningPub: userB.selfSigningPubkey,
      })
      expect(valid).toBe(true)
    })

    test('fails when cross-signature is invalid', async () => {
      const sbKey = await makeSecretBoxKey()
      const userA = await createMasterKey({ pukSecretBoxKey: sbKey })
      const userB = await createMasterKey({ pukSecretBoxKey: sbKey })
      const deviceD = await makeEd25519Keypair()

      const crossSign = await crossSignOtherUser({
        targetMasterPubkey: userB.masterPubkey,
        userSigningPrivate: userA.userSigningPrivate,
        signerUserId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '22222222-2222-2222-2222-222222222222',
      })

      const selfSign = await crossSignOwnDevice({
        deviceSigningPubkey: deviceD.publicKeyRaw,
        selfSigningPrivate: userB.selfSigningPrivate,
        signerDeviceId: 'b-1',
        targetDeviceId: 'b-2',
      })

      // Tamper with cross-signature
      const tamperedCrossSig =
        crossSign.signature[0] === 'a'
          ? `b${crossSign.signature.slice(1)}`
          : `a${crossSign.signature.slice(1)}`

      const valid = await verifyTransitiveTrust({
        trustingUserSigningPub: userA.userSigningPubkey,
        crossSignature: tamperedCrossSig,
        candidateMasterSeed: userB.masterSeed,
        candidateMasterPub: userB.masterPubkey,
        selfSignSignature: selfSign.signature,
        candidateDevicePub: deviceD.publicKeyRaw,
        candidateSelfSigningPub: userB.selfSigningPubkey,
      })
      expect(valid).toBe(false)
    })

    test('fails when self-sign signature is invalid', async () => {
      const sbKey = await makeSecretBoxKey()
      const userA = await createMasterKey({ pukSecretBoxKey: sbKey })
      const userB = await createMasterKey({ pukSecretBoxKey: sbKey })
      const deviceD = await makeEd25519Keypair()

      const crossSign = await crossSignOtherUser({
        targetMasterPubkey: userB.masterPubkey,
        userSigningPrivate: userA.userSigningPrivate,
        signerUserId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '22222222-2222-2222-2222-222222222222',
      })

      const selfSign = await crossSignOwnDevice({
        deviceSigningPubkey: deviceD.publicKeyRaw,
        selfSigningPrivate: userB.selfSigningPrivate,
        signerDeviceId: 'b-1',
        targetDeviceId: 'b-2',
      })

      // Tamper with self-sign signature
      const tamperedSelfSig =
        selfSign.signature[0] === 'a'
          ? `b${selfSign.signature.slice(1)}`
          : `a${selfSign.signature.slice(1)}`

      const valid = await verifyTransitiveTrust({
        trustingUserSigningPub: userA.userSigningPubkey,
        crossSignature: crossSign.signature,
        candidateMasterSeed: userB.masterSeed,
        candidateMasterPub: userB.masterPubkey,
        selfSignSignature: tamperedSelfSig,
        candidateDevicePub: deviceD.publicKeyRaw,
        candidateSelfSigningPub: userB.selfSigningPubkey,
      })
      expect(valid).toBe(false)
    })

    // Gap 2 regression: an attacker substitutes a self-signing pubkey from a
    // DIFFERENT master. Even if both component signatures are cryptographically
    // valid, the derivation binding must fail because the substituted key was
    // not HMAC-derived from userB's master seed.
    test('fails when candidateSelfSigningPub is from a different master', async () => {
      const sbKey = await makeSecretBoxKey()
      const userA = await createMasterKey({ pukSecretBoxKey: sbKey })
      const userB = await createMasterKey({ pukSecretBoxKey: sbKey })
      const attacker = await createMasterKey({ pukSecretBoxKey: sbKey })
      const deviceD = await makeEd25519Keypair()

      // Legitimate cross-sign: A signs B's master pubkey.
      const crossSign = await crossSignOtherUser({
        targetMasterPubkey: userB.masterPubkey,
        userSigningPrivate: userA.userSigningPrivate,
        signerUserId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '22222222-2222-2222-2222-222222222222',
      })

      // Attacker uses their OWN self-signing key to sign device D.
      // (Signature itself is valid under attacker's self-signing pubkey.)
      const attackerSelfSign = await crossSignOwnDevice({
        deviceSigningPubkey: deviceD.publicKeyRaw,
        selfSigningPrivate: attacker.selfSigningPrivate,
        signerDeviceId: 'evil-1',
        targetDeviceId: 'evil-2',
      })

      const valid = await verifyTransitiveTrust({
        trustingUserSigningPub: userA.userSigningPubkey,
        crossSignature: crossSign.signature,
        // Claimed seed/master are still userB's — cross-sign is valid for them.
        candidateMasterSeed: userB.masterSeed,
        candidateMasterPub: userB.masterPubkey,
        // Attacker substitutes their own self-signing pubkey + signature.
        selfSignSignature: attackerSelfSign.signature,
        candidateDevicePub: deviceD.publicKeyRaw,
        candidateSelfSigningPub: attacker.selfSigningPubkey,
      })
      // Derivation binding must reject — attacker.selfSigningPubkey is NOT
      // HMAC-derived from userB.masterSeed.
      expect(valid).toBe(false)
    })

    test('fails when candidateMasterSeed is unrelated to candidateMasterPub', async () => {
      const sbKey = await makeSecretBoxKey()
      const userA = await createMasterKey({ pukSecretBoxKey: sbKey })
      const userB = await createMasterKey({ pukSecretBoxKey: sbKey })
      const unrelated = await createMasterKey({ pukSecretBoxKey: sbKey })
      const deviceD = await makeEd25519Keypair()

      const crossSign = await crossSignOtherUser({
        targetMasterPubkey: userB.masterPubkey,
        userSigningPrivate: userA.userSigningPrivate,
        signerUserId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '22222222-2222-2222-2222-222222222222',
      })
      const selfSign = await crossSignOwnDevice({
        deviceSigningPubkey: deviceD.publicKeyRaw,
        selfSigningPrivate: userB.selfSigningPrivate,
        signerDeviceId: 'b-1',
        targetDeviceId: 'b-2',
      })

      // Attacker swaps in an unrelated seed that would pass HMAC-derivation
      // consistency internally but whose derived master pub does NOT match.
      const valid = await verifyTransitiveTrust({
        trustingUserSigningPub: userA.userSigningPubkey,
        crossSignature: crossSign.signature,
        candidateMasterSeed: unrelated.masterSeed,
        candidateMasterPub: userB.masterPubkey,
        selfSignSignature: selfSign.signature,
        candidateDevicePub: deviceD.publicKeyRaw,
        candidateSelfSigningPub: userB.selfSigningPubkey,
      })
      expect(valid).toBe(false)
    })
  })

  describe('deriveSelfSigningPubFromMasterSeed', () => {
    test('matches the pubkey produced by createMasterKey', async () => {
      const sbKey = await makeSecretBoxKey()
      const master = await createMasterKey({ pukSecretBoxKey: sbKey })
      const derived = deriveSelfSigningPubFromMasterSeed(master.masterSeed)
      expect(bytesToHex(derived)).toBe(bytesToHex(master.selfSigningPubkey))
    })

    test('different seeds produce different self-signing pubkeys', async () => {
      const sbKey = await makeSecretBoxKey()
      const a = await createMasterKey({ pukSecretBoxKey: sbKey })
      const b = await createMasterKey({ pukSecretBoxKey: sbKey })
      const derivedA = deriveSelfSigningPubFromMasterSeed(a.masterSeed)
      const derivedB = deriveSelfSigningPubFromMasterSeed(b.masterSeed)
      expect(bytesToHex(derivedA)).not.toBe(bytesToHex(derivedB))
    })
  })

  // ---- Fingerprint ----

  describe('computeDeviceFingerprint', () => {
    test('is deterministic', async () => {
      const device = await makeEd25519Keypair()
      const fp1 = await computeDeviceFingerprint(device.publicKeyRaw)
      const fp2 = await computeDeviceFingerprint(device.publicKeyRaw)
      expect(fp1).toBe(fp2)
    })

    test('is formatted as 4 groups of 4 hex chars separated by colons', async () => {
      const device = await makeEd25519Keypair()
      const fp = await computeDeviceFingerprint(device.publicKeyRaw)
      expect(fp).toMatch(/^[0-9a-f]{4}:[0-9a-f]{4}:[0-9a-f]{4}:[0-9a-f]{4}$/)
    })

    test('different pubkeys produce different fingerprints', async () => {
      const dev1 = await makeEd25519Keypair()
      const dev2 = await makeEd25519Keypair()
      const fp1 = await computeDeviceFingerprint(dev1.publicKeyRaw)
      const fp2 = await computeDeviceFingerprint(dev2.publicKeyRaw)
      expect(fp1).not.toBe(fp2)
    })
  })
})
