import { describe, expect, test } from 'bun:test'
import { createHpkeSuite } from '@shared/crypto-suite'
import { asEd25519SigningKey, asX25519EncryptionKey, type DeviceKeypair } from '@shared/types'
import {
  createInitialPuk,
  decryptOldGenWrap,
  derivePukSubkeys,
  getPukSeedForGeneration,
  openPukEnvelope,
  rotatePuk,
} from './puk'

/**
 * Generate a test device keypair with HPKE-compatible X25519 keys.
 * The encryption private key bytes are saved for openPukEnvelope.
 */
async function generateTestDevice(): Promise<
  DeviceKeypair & { encryptionPrivateBytes: Uint8Array }
> {
  // Generate Ed25519 for signing (non-extractable)
  const signingPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const signingPub = new Uint8Array(await crypto.subtle.exportKey('raw', signingPair.publicKey))

  // Generate X25519 via HPKE suite for compatibility
  const suite = createHpkeSuite()
  const hpkeKp = await suite.kem.generateKeyPair()
  const encPubBytes = new Uint8Array(await suite.kem.serializePublicKey(hpkeKp.publicKey))
  const encPrivBytes = new Uint8Array(await suite.kem.serializePrivateKey(hpkeKp.privateKey))

  // Import the HPKE-generated X25519 key as a native CryptoKey for the DeviceKeypair interface
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
  return der.buffer as ArrayBuffer
}

describe('PUK', () => {
  test('createInitialPuk produces generation 1 + one envelope', async () => {
    const kp = await generateTestDevice()
    const result = await createInitialPuk(kp)
    expect(result.generation).toBe(1)
    expect(result.envelopes).toHaveLength(1)
    expect(result.envelopes[0].deviceId).toBe(kp.deviceId)
    expect(result.pukSignPubRaw.length).toBe(32)
    expect(result.pukDhPubRaw.length).toBe(32)
  })

  test('derivePukSubkeys produces distinct keys per generation', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const gen1 = await derivePukSubkeys(seed, 1)
    const gen2 = await derivePukSubkeys(seed, 2)
    const sign1Raw = new Uint8Array(await crypto.subtle.exportKey('raw', gen1.signPublic))
    const sign2Raw = new Uint8Array(await crypto.subtle.exportKey('raw', gen2.signPublic))
    expect(sign1Raw).not.toEqual(sign2Raw)
  })

  test('derived sign private key is non-extractable', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const derived = await derivePukSubkeys(seed, 1)
    await expect(crypto.subtle.exportKey('raw', derived.signPrivate)).rejects.toThrow()
    await expect(crypto.subtle.exportKey('pkcs8', derived.signPrivate)).rejects.toThrow()
  })

  test('cross-label subkey derivation is distinct', async () => {
    const seed = new Uint8Array(32).fill(42)
    const derived = await derivePukSubkeys(seed, 1)
    const signRaw = new Uint8Array(await crypto.subtle.exportKey('raw', derived.signPublic))
    const dhRaw = new Uint8Array(await crypto.subtle.exportKey('raw', derived.dhPublic))
    expect(signRaw).not.toEqual(dhRaw)
  })

  test('same seed + generation yields deterministic subkeys', async () => {
    const seed = new Uint8Array(32).fill(99)
    const a = await derivePukSubkeys(seed, 1)
    const b = await derivePukSubkeys(seed, 1)
    const aPub = new Uint8Array(await crypto.subtle.exportKey('raw', a.signPublic))
    const bPub = new Uint8Array(await crypto.subtle.exportKey('raw', b.signPublic))
    expect(aPub).toEqual(bPub)
  })

  test('PUK envelope can be opened by the target device', async () => {
    const kp = await generateTestDevice()
    const result = await createInitialPuk(kp)
    const seed = await openPukEnvelope(
      result.envelopes[0].envelope,
      kp.encryptionPrivateBytes,
      kp.deviceId
    )
    expect(seed).toBeInstanceOf(Uint8Array)
    expect(seed.length).toBe(32)
  })
})

describe('PUK rotation', () => {
  test('rotatePuk produces new gen + wraps old seed', async () => {
    const devices = await Promise.all([
      generateTestDevice(),
      generateTestDevice(),
      generateTestDevice(),
    ])
    const init = await createInitialPuk(devices[0])
    const gen1Seed = await openPukEnvelope(
      init.envelopes[0].envelope,
      devices[0].encryptionPrivateBytes,
      devices[0].deviceId
    )

    const rotation = await rotatePuk({
      oldSeed: gen1Seed,
      oldGen: 1,
      remainingDevices: [devices[1], devices[2]],
    })

    expect(rotation.newGen).toBe(2)
    expect(rotation.newEnvelopes).toHaveLength(2)
    expect(rotation.newEnvelopes.map((e) => e.deviceId)).toEqual([
      devices[1].deviceId,
      devices[2].deviceId,
    ])

    const recovered = await decryptOldGenWrap(
      rotation.oldGenWrappedUnderNew,
      rotation.newSecretBoxKey,
      2
    )
    expect(recovered).toEqual(gen1Seed)
  })

  test('rotatePuk excludes the removed device from new envelopes', async () => {
    const devices = await Promise.all([1, 2, 3, 4].map(() => generateTestDevice()))
    const init = await createInitialPuk(devices[0])
    const seed = await openPukEnvelope(
      init.envelopes[0].envelope,
      devices[0].encryptionPrivateBytes,
      devices[0].deviceId
    )
    const rotation = await rotatePuk({
      oldSeed: seed,
      oldGen: 1,
      remainingDevices: [devices[0], devices[1], devices[3]],
    })
    const includedIds = rotation.newEnvelopes.map((e) => e.deviceId)
    expect(includedIds).toContain(devices[0].deviceId)
    expect(includedIds).toContain(devices[1].deviceId)
    expect(includedIds).not.toContain(devices[2].deviceId)
    expect(includedIds).toContain(devices[3].deviceId)
  })
})

describe('PUK generation walk', () => {
  test('walks backwards from gen 5 to gen 2', async () => {
    const devices = await Promise.all([1, 2].map(() => generateTestDevice()))
    const init = await createInitialPuk(devices[0])
    let currentSeed = await openPukEnvelope(
      init.envelopes[0].envelope,
      devices[0].encryptionPrivateBytes,
      devices[0].deviceId
    )
    const wrapChain: string[] = []
    wrapChain[1] = '' // gen 1 has no previous

    const seedByGen: Uint8Array[] = [new Uint8Array(), currentSeed]
    for (let g = 2; g <= 5; g++) {
      const rot = await rotatePuk({
        oldSeed: currentSeed,
        oldGen: g - 1,
        remainingDevices: devices,
      })
      wrapChain[g] = rot.oldGenWrappedUnderNew
      currentSeed = rot.newSeed
      seedByGen[g] = rot.newSeed
    }

    const gen2Recovered = await getPukSeedForGeneration({
      currentSeed,
      currentGen: 5,
      targetGen: 2,
      wrapChain,
    })

    const gen2Derived = await derivePukSubkeys(gen2Recovered, 2)
    const gen2ExpectedDerived = await derivePukSubkeys(seedByGen[2], 2)
    const recoveredPub = new Uint8Array(
      await crypto.subtle.exportKey('raw', gen2Derived.signPublic)
    )
    const expectedPub = new Uint8Array(
      await crypto.subtle.exportKey('raw', gen2ExpectedDerived.signPublic)
    )
    expect(recoveredPub).toEqual(expectedPub)
  })

  test('rejects targetGen >= currentGen', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    await expect(
      getPukSeedForGeneration({
        currentSeed: seed,
        currentGen: 3,
        targetGen: 3,
        wrapChain: [],
      })
    ).rejects.toThrow('targetGen')
  })

  test('rejects targetGen < 1', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    await expect(
      getPukSeedForGeneration({
        currentSeed: seed,
        currentGen: 3,
        targetGen: 0,
        wrapChain: [],
      })
    ).rejects.toThrow('targetGen')
  })
})
