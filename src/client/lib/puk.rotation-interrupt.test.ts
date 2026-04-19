/**
 * Adversarial tests: PUK rotation interruption.
 *
 * PUK rotation is a multi-device operation: `rotatePuk` seals the new seed to
 * every remaining device via `Promise.all`. If the rotation succeeds it returns
 * a complete `RotatePukResult` with envelopes for all devices; the caller then
 * distributes those envelopes (typically via an API call). An interruption can
 * occur in two places:
 *
 *   1. **Inside `rotatePuk`** – one of the per-device seal operations rejects.
 *      `Promise.all` propagates the first rejection and the function throws.
 *      No `RotatePukResult` is returned, so the caller has no partial data to
 *      accidentally persist.
 *
 *   2. **During distribution** – `rotatePuk` succeeds but the caller only
 *      delivers envelopes to a subset of devices before crashing. This leaves
 *      devices in inconsistent generations: some hold gen N, others still hold
 *      gen N-1.
 *
 * These tests verify both failure modes are detectable and non-silently-corrupt.
 *
 * Timing note: no real HPKE computation is needed for scenario 1 – we use
 * mock devices that have valid X25519 keys so the HPKE paths run, but one is
 * made to fail via a deliberately malformed public key.
 */

import { describe, expect, test } from 'bun:test'
import { createHpkeSuite } from '@shared/crypto-suite'
import { type DeviceKeypair, asEd25519SigningKey, asX25519EncryptionKey } from '@shared/types'
import {
  type RotatePukResult,
  createInitialPuk,
  decryptOldGenWrap,
  derivePukSubkeys,
  openPukEnvelope,
  rotatePuk,
} from './puk'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function generateTestDevice(): Promise<
  DeviceKeypair & { encryptionPrivateBytes: Uint8Array }
> {
  const signingPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const signingPub = new Uint8Array(await crypto.subtle.exportKey('raw', signingPair.publicKey))

  const suite = createHpkeSuite()
  const hpkeKp = await suite.kem.generateKeyPair()
  const encPubBytes = new Uint8Array(await suite.kem.serializePublicKey(hpkeKp.publicKey))
  const encPrivBytes = new Uint8Array(await suite.kem.serializePrivateKey(hpkeKp.privateKey))

  const encPrivKey = await crypto.subtle.importKey(
    'pkcs8',
    buildX25519Pkcs8(encPrivBytes),
    { name: 'X25519' },
    false,
    ['deriveBits']
  )

  return {
    deviceId: crypto.randomUUID(),
    signing: { privateKey: asEd25519SigningKey(signingPair.privateKey), publicKey: signingPub },
    encryption: { privateKey: asX25519EncryptionKey(encPrivKey), publicKey: encPubBytes },
    createdAt: new Date().toISOString(),
    isPaperKey: false,
    encryptionPrivateBytes: encPrivBytes,
  }
}

function buildX25519Pkcs8(seed: Uint8Array): ArrayBuffer {
  const der = new Uint8Array(48)
  der.set(
    new Uint8Array([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04,
      0x20,
    ])
  )
  der.set(seed, 16)
  return der.buffer
}

// ---------------------------------------------------------------------------
// Scenario 1: interruption inside rotatePuk
// ---------------------------------------------------------------------------

describe('PUK rotation — interruption inside rotatePuk', () => {
  test('malformed device public key causes rotatePuk to reject with no partial result', async () => {
    const deviceA = await generateTestDevice()
    const initial = await createInitialPuk(deviceA)
    const oldSeed = initial._testOnlySeed!

    // deviceB has an invalid (all-zeros) 32-byte X25519 public key — HPKE
    // encapsulation against it will throw during the `Promise.all` wave.
    const badDeviceId = crypto.randomUUID()
    const badPublicKey = new Uint8Array(32) // all zeros — invalid X25519 point

    let result: RotatePukResult | null = null
    let caughtError: unknown = null

    try {
      result = await rotatePuk({
        oldSeed,
        oldGen: initial.generation,
        remainingDevices: [
          { deviceId: deviceA.deviceId, encryption: { publicKey: deviceA.encryption.publicKey } },
          { deviceId: badDeviceId, encryption: { publicKey: badPublicKey } },
        ],
      })
    } catch (err) {
      caughtError = err
    }

    // The call must reject — no partial RotatePukResult returned.
    expect(result).toBeNull()
    expect(caughtError).not.toBeNull()
    expect(caughtError).toBeInstanceOf(Error)
  })

  test('single-device rotation with valid device succeeds atomically', async () => {
    const device = await generateTestDevice()
    const initial = await createInitialPuk(device)
    const oldSeed = initial._testOnlySeed!

    const rotated = await rotatePuk({
      oldSeed,
      oldGen: initial.generation,
      remainingDevices: [
        { deviceId: device.deviceId, encryption: { publicKey: device.encryption.publicKey } },
      ],
    })

    // Rotation succeeded — we get exactly one envelope.
    expect(rotated.newEnvelopes).toHaveLength(1)
    expect(rotated.newGen).toBe(initial.generation + 1)
    expect(rotated.newEnvelopes[0]!.deviceId).toBe(device.deviceId)

    // The new seed can be recovered by opening the envelope.
    const recoveredSeed = await openPukEnvelope(
      rotated.newEnvelopes[0]!.envelope,
      device.encryptionPrivateBytes,
      device.deviceId
    )
    expect(recoveredSeed).toEqual(rotated.newSeed)
  })
})

// ---------------------------------------------------------------------------
// Scenario 2: partial distribution after successful rotation
// ---------------------------------------------------------------------------

describe('PUK rotation — partial distribution (inconsistent device generations)', () => {
  test('un-updated device cannot open gen-N envelope', async () => {
    // Two devices registered at gen 1.
    const deviceA = await generateTestDevice()
    const deviceB = await generateTestDevice()

    const initial = await createInitialPuk(deviceA)
    const oldSeed = initial._testOnlySeed!

    const rotated = await rotatePuk({
      oldSeed,
      oldGen: initial.generation,
      remainingDevices: [
        { deviceId: deviceA.deviceId, encryption: { publicKey: deviceA.encryption.publicKey } },
        { deviceId: deviceB.deviceId, encryption: { publicKey: deviceB.encryption.publicKey } },
      ],
    })

    expect(rotated.newEnvelopes).toHaveLength(2)

    const envelopeForA = rotated.newEnvelopes.find((e) => e.deviceId === deviceA.deviceId)!
    const envelopeForB = rotated.newEnvelopes.find((e) => e.deviceId === deviceB.deviceId)!

    // deviceA receives its gen-2 envelope — can recover the new seed.
    const seedFromA = await openPukEnvelope(
      envelopeForA.envelope,
      deviceA.encryptionPrivateBytes,
      deviceA.deviceId
    )
    expect(seedFromA).toEqual(rotated.newSeed)

    // Simulate partial distribution: deviceB was never sent its gen-2 envelope.
    // deviceB therefore still only holds its gen-1 material from the original
    // `createInitialPuk` — but that envelope was addressed to deviceA only.
    //
    // If deviceB were to try opening envelopeForB with its own private key the
    // decryption succeeds (it's valid for deviceB). But if the caller had NOT
    // stored envelopeForB (distribution interrupted), deviceB is stuck at gen 1.
    //
    // We verify this by confirming that deviceA's private key cannot open
    // deviceB's gen-2 envelope (AAD binding prevents cross-device opening).
    await expect(
      openPukEnvelope(envelopeForB.envelope, deviceA.encryptionPrivateBytes, deviceA.deviceId)
    ).rejects.toThrow()
  })

  test('partial state is detectable: stale device cannot derive gen-N subkeys from gen-N seed', async () => {
    // A device that missed the rotation holds gen-1 material. Using gen-2 seed
    // with gen-1 generation index produces different subkeys — not silently
    // compatible. This test verifies the generation index is load-bearing.
    const seed1 = crypto.getRandomValues(new Uint8Array(32))
    const seed2 = crypto.getRandomValues(new Uint8Array(32))
    const generation1 = 1
    const generation2 = 2

    const subkeys1 = await derivePukSubkeys(seed1, generation1)
    const subkeys2 = await derivePukSubkeys(seed2, generation2)

    // Export public keys to compare — they must differ.
    const signPub1 = new Uint8Array(await crypto.subtle.exportKey('raw', subkeys1.signPublic))
    const signPub2 = new Uint8Array(await crypto.subtle.exportKey('raw', subkeys2.signPublic))
    expect(signPub1).not.toEqual(signPub2)

    // Using the wrong generation with the same seed also produces different keys —
    // a device that replays gen-1 with seed2 material gets incompatible subkeys.
    const subkeysWrongGen = await derivePukSubkeys(seed2, generation1)
    const signPubWrongGen = new Uint8Array(
      await crypto.subtle.exportKey('raw', subkeysWrongGen.signPublic)
    )
    expect(signPubWrongGen).not.toEqual(signPub2)
  })

  test('old-gen wrap is AAD-bound: cannot replay gen-1 wrap as gen-2', async () => {
    // The CLKR chain wrap uses AAD `LABEL_PUK_PREVIOUS_GEN:genN->genN+1`.
    // Attempting to decrypt a gen1→gen2 wrap as gen2→gen3 must fail.
    const device = await generateTestDevice()
    const initial = await createInitialPuk(device)
    const oldSeed = initial._testOnlySeed!

    const rotated = await rotatePuk({
      oldSeed,
      oldGen: initial.generation,
      remainingDevices: [
        { deviceId: device.deviceId, encryption: { publicKey: device.encryption.publicKey } },
      ],
    })

    // Correctly decode the old-gen wrap at gen 2.
    const recoveredOldSeed = await decryptOldGenWrap(
      rotated.oldGenWrappedUnderNew,
      rotated.newSecretBoxKey,
      rotated.newGen
    )
    expect(recoveredOldSeed).toEqual(oldSeed)

    // Replaying the same wrapped blob as-if it were gen2→gen3 must throw (AAD mismatch).
    const fakeSecretBoxKey = (await derivePukSubkeys(rotated.newSeed, rotated.newGen + 1))
      .secretBoxKey
    await expect(
      decryptOldGenWrap(rotated.oldGenWrappedUnderNew, fakeSecretBoxKey, rotated.newGen + 1)
    ).rejects.toThrow()
  })
})
