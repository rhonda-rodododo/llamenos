import { describe, expect, test } from 'bun:test'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { LABEL_HUB_FIELD } from '@shared/crypto-labels'
import { createHpkeSuite } from '@shared/crypto-suite'
import {
  decryptFromHub,
  encryptForHub,
  generateHubKey,
  rotateHubKeyClkr,
  unwrapHubKeyForDevice,
  unwrapOldGen,
  walkGenerationChain,
  wrapHubKeyForDevice,
  wrapOldGenUnderNew,
} from './hub-key-manager'

const HUB_ID = '11111111-1111-4111-8111-111111111111'

async function generateDeviceKeypair() {
  const suite = createHpkeSuite()
  const kp = await suite.kem.generateKeyPair()
  return {
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
  }
}

// ---- Legacy functions still work ----

describe('generateHubKey', () => {
  test('returns 32 bytes', () => {
    const key = generateHubKey()
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.length).toBe(32)
  })

  test('returns different keys each time', () => {
    const a = generateHubKey()
    const b = generateHubKey()
    expect(a).not.toEqual(b)
  })
})

describe('encryptForHub / decryptFromHub', () => {
  test('matching AAD round-trips', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-123:encrypted_name`)
    const ct = encryptForHub('hello', key, aad)
    const pt = decryptFromHub(ct, key, aad)
    expect(pt).toBe('hello')
  })

  test('mismatched AAD returns null', () => {
    const key = generateHubKey()
    const ct = encryptForHub('hello', key, utf8ToBytes(`${LABEL_HUB_FIELD}:row-A:encrypted_name`))
    const pt = decryptFromHub(ct, key, utf8ToBytes(`${LABEL_HUB_FIELD}:row-B:encrypted_name`))
    expect(pt).toBeNull()
  })

  test('wrong key returns null', () => {
    const key1 = generateHubKey()
    const key2 = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-1:name`)
    const ct = encryptForHub('secret', key1, aad)
    const pt = decryptFromHub(ct, key2, aad)
    expect(pt).toBeNull()
  })
})

// ---- Per-device HPKE wrapping (Task 24) ----

describe('wrapHubKeyForDevice + unwrapHubKeyForDevice', () => {
  test('round-trips a 32-byte hub key', async () => {
    const hubKey = generateHubKey()
    const device = await generateDeviceKeypair()
    const deviceId = 'device-abc-123'

    const envelope = await wrapHubKeyForDevice(hubKey, device.publicKey, deviceId, HUB_ID)

    expect(envelope.v).toBe(3)
    expect(envelope.enc).toBeTruthy()
    expect(envelope.ct).toBeTruthy()

    const recovered = await unwrapHubKeyForDevice(envelope, device.privateKey, deviceId, HUB_ID)
    expect(recovered).toEqual(hubKey)
  })

  test('wrong device key fails to unwrap', async () => {
    const hubKey = generateHubKey()
    const device1 = await generateDeviceKeypair()
    const device2 = await generateDeviceKeypair()
    const deviceId = 'device-1'

    const envelope = await wrapHubKeyForDevice(hubKey, device1.publicKey, deviceId, HUB_ID)

    await expect(
      unwrapHubKeyForDevice(envelope, device2.privateKey, deviceId, HUB_ID)
    ).rejects.toThrow()
  })

  test('wrong deviceId in AAD fails to unwrap', async () => {
    const hubKey = generateHubKey()
    const device = await generateDeviceKeypair()

    const envelope = await wrapHubKeyForDevice(hubKey, device.publicKey, 'device-A', HUB_ID)

    await expect(
      unwrapHubKeyForDevice(envelope, device.privateKey, 'device-B', HUB_ID)
    ).rejects.toThrow()
  })

  test('wrong hubId in AAD fails to unwrap', async () => {
    const hubKey = generateHubKey()
    const device = await generateDeviceKeypair()
    const deviceId = 'device-1'
    const otherHub = '22222222-2222-4222-8222-222222222222'

    const envelope = await wrapHubKeyForDevice(hubKey, device.publicKey, deviceId, HUB_ID)

    await expect(
      unwrapHubKeyForDevice(envelope, device.privateKey, deviceId, otherHub)
    ).rejects.toThrow()
  })
})

// ---- Old-gen AES-GCM wrapping ----

describe('wrapOldGenUnderNew + unwrapOldGen', () => {
  test('round-trips a 32-byte key', async () => {
    const oldKey = generateHubKey()
    const newKey = generateHubKey()
    const newGen = 2

    const wrapped = await wrapOldGenUnderNew(oldKey, newKey, HUB_ID, newGen)
    expect(typeof wrapped).toBe('string')
    expect(wrapped.length).toBeGreaterThan(0)

    const recovered = await unwrapOldGen(wrapped, newKey, HUB_ID, newGen)
    expect(recovered).toEqual(oldKey)
  })

  test('wrong key fails', async () => {
    const oldKey = generateHubKey()
    const newKey = generateHubKey()
    const wrongKey = generateHubKey()

    const wrapped = await wrapOldGenUnderNew(oldKey, newKey, HUB_ID, 3)

    await expect(unwrapOldGen(wrapped, wrongKey, HUB_ID, 3)).rejects.toThrow()
  })

  test('wrong generation in AAD fails', async () => {
    const oldKey = generateHubKey()
    const newKey = generateHubKey()

    const wrapped = await wrapOldGenUnderNew(oldKey, newKey, HUB_ID, 4)

    await expect(unwrapOldGen(wrapped, newKey, HUB_ID, 5)).rejects.toThrow()
  })

  test('wrong hubId in AAD fails', async () => {
    const oldKey = generateHubKey()
    const newKey = generateHubKey()
    const otherHub = '33333333-3333-4333-8333-333333333333'

    const wrapped = await wrapOldGenUnderNew(oldKey, newKey, HUB_ID, 2)

    await expect(unwrapOldGen(wrapped, newKey, otherHub, 2)).rejects.toThrow()
  })
})

// ---- Generation chain walk ----

describe('walkGenerationChain', () => {
  test('walks 4 generations correctly', async () => {
    // Create a chain: gen1 -> gen2 -> gen3 -> gen4
    const key1 = generateHubKey()
    const key2 = generateHubKey()
    const key3 = generateHubKey()
    const key4 = generateHubKey()

    // Each entry wraps the previous generation's key under the current gen's key
    const wrap2 = await wrapOldGenUnderNew(key1, key2, HUB_ID, 2)
    const wrap3 = await wrapOldGenUnderNew(key2, key3, HUB_ID, 3)
    const wrap4 = await wrapOldGenUnderNew(key3, key4, HUB_ID, 4)

    const wrapChain = new Map<number, string>()
    wrapChain.set(2, wrap2)
    wrapChain.set(3, wrap3)
    wrapChain.set(4, wrap4)

    // Walk from gen 4 back to gen 1
    const recovered = await walkGenerationChain({
      currentHubKey: key4,
      currentGen: 4,
      targetGen: 1,
      wrapChain,
      hubId: HUB_ID,
    })

    expect(recovered).toEqual(key1)
  })

  test('walks a single step', async () => {
    const key1 = generateHubKey()
    const key2 = generateHubKey()
    const wrap2 = await wrapOldGenUnderNew(key1, key2, HUB_ID, 2)

    const wrapChain = new Map<number, string>()
    wrapChain.set(2, wrap2)

    const recovered = await walkGenerationChain({
      currentHubKey: key2,
      currentGen: 2,
      targetGen: 1,
      wrapChain,
      hubId: HUB_ID,
    })

    expect(recovered).toEqual(key1)
  })

  test('throws on missing chain entry', async () => {
    const key3 = generateHubKey()
    const wrapChain = new Map<number, string>()
    // Missing entry for gen 3

    await expect(
      walkGenerationChain({
        currentHubKey: key3,
        currentGen: 3,
        targetGen: 1,
        wrapChain,
        hubId: HUB_ID,
      })
    ).rejects.toThrow('Missing wrap chain entry for generation 3')
  })

  test('throws when targetGen >= currentGen', async () => {
    const key = generateHubKey()

    await expect(
      walkGenerationChain({
        currentHubKey: key,
        currentGen: 2,
        targetGen: 2,
        wrapChain: new Map(),
        hubId: HUB_ID,
      })
    ).rejects.toThrow('targetGen (2) must be < currentGen (2)')

    await expect(
      walkGenerationChain({
        currentHubKey: key,
        currentGen: 2,
        targetGen: 5,
        wrapChain: new Map(),
        hubId: HUB_ID,
      })
    ).rejects.toThrow('targetGen (5) must be < currentGen (2)')
  })
})

// ---- CLKR rotation (Task 25) ----

describe('rotateHubKeyClkr', () => {
  test('produces correct number of envelopes and commitments', async () => {
    const currentKey = generateHubKey()
    const device1 = await generateDeviceKeypair()
    const device2 = await generateDeviceKeypair()
    const device3 = await generateDeviceKeypair()

    const result = await rotateHubKeyClkr({
      hubId: HUB_ID,
      currentHubKey: currentKey,
      currentGen: 1,
      remainingDevices: [
        { deviceId: 'dev-1', encPubkey: device1.publicKey },
        { deviceId: 'dev-2', encPubkey: device2.publicKey },
        { deviceId: 'dev-3', encPubkey: device3.publicKey },
      ],
    })

    expect(result.newHubKey.length).toBe(32)
    expect(result.newGeneration).toBe(2)
    expect(result.deviceEnvelopes).toHaveLength(3)
    expect(result.deviceCommitments).toHaveLength(3)
    expect(typeof result.oldGenWrappedUnderNew).toBe('string')
  })

  test('new key can be unwrapped by each device', async () => {
    const currentKey = generateHubKey()
    const devices = await Promise.all(
      ['dev-a', 'dev-b'].map(async (id) => ({
        id,
        kp: await generateDeviceKeypair(),
      }))
    )

    const result = await rotateHubKeyClkr({
      hubId: HUB_ID,
      currentHubKey: currentKey,
      currentGen: 5,
      remainingDevices: devices.map((d) => ({
        deviceId: d.id,
        encPubkey: d.kp.publicKey,
      })),
    })

    for (const device of devices) {
      const env = result.deviceEnvelopes.find((e) => e.deviceId === device.id)
      expect(env).toBeDefined()
      const recovered = await unwrapHubKeyForDevice(
        env!.envelope,
        device.kp.privateKey,
        device.id,
        HUB_ID
      )
      expect(recovered).toEqual(result.newHubKey)
    }
  })

  test('old key can be recovered via wrap chain', async () => {
    const oldKey = generateHubKey()
    const device = await generateDeviceKeypair()

    const result = await rotateHubKeyClkr({
      hubId: HUB_ID,
      currentHubKey: oldKey,
      currentGen: 1,
      remainingDevices: [{ deviceId: 'dev-x', encPubkey: device.publicKey }],
    })

    const recoveredOld = await unwrapOldGen(
      result.oldGenWrappedUnderNew,
      result.newHubKey,
      HUB_ID,
      result.newGeneration
    )
    expect(recoveredOld).toEqual(oldKey)
  })

  test('commitment hashes are 64 hex chars (SHA-256)', async () => {
    const currentKey = generateHubKey()
    const device = await generateDeviceKeypair()

    const result = await rotateHubKeyClkr({
      hubId: HUB_ID,
      currentHubKey: currentKey,
      currentGen: 1,
      remainingDevices: [{ deviceId: 'dev-1', encPubkey: device.publicKey }],
    })

    expect(result.deviceCommitments).toHaveLength(1)
    expect(result.deviceCommitments[0].commitmentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.deviceCommitments[0].deviceId).toBe('dev-1')
  })
})
