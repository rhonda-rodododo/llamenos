import { describe, expect, test } from 'bun:test'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { LABEL_HUB_FIELD } from '@shared/crypto-labels'
import { createHpkeSuite } from '@shared/crypto-suite'
import type { Ciphertext } from '@shared/crypto-types'
import {
  HubKeyWrapError,
  decryptFromHub,
  decryptFromHubWithError,
  encryptForHub,
  generateHubKey,
  planRotationCascade,
  rotateHubKeyClkr,
  unwrapHubKeyForDevice,
  unwrapOldGen,
  walkGenerationChain,
  wrapHubKeyForDevice,
  wrapHubKeyForDevices,
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

describe('decryptFromHubWithError', () => {
  test('matching key + AAD round-trips with ok: true', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-1:encrypted_name`)
    const ct = encryptForHub('hello world', key, aad)

    const result = decryptFromHubWithError(ct, key, aad)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('hello world')
    }
  })

  test('wrong key returns ok: false / decrypt_failed', () => {
    const key1 = generateHubKey()
    const key2 = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-1:encrypted_name`)
    const ct = encryptForHub('top secret', key1, aad)

    const result = decryptFromHubWithError(ct, key2, aad)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('decrypt_failed')
    }
  })

  test('mismatched AAD returns ok: false / decrypt_failed', () => {
    const key = generateHubKey()
    const aadA = utf8ToBytes(`${LABEL_HUB_FIELD}:row-A:encrypted_name`)
    const aadB = utf8ToBytes(`${LABEL_HUB_FIELD}:row-B:encrypted_name`)
    const ct = encryptForHub('hello', key, aadA)

    const result = decryptFromHubWithError(ct, key, aadB)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('decrypt_failed')
    }
  })

  test('tampered ciphertext returns ok: false / decrypt_failed', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-1:encrypted_name`)
    const ct = encryptForHub('hello', key, aad)

    // Flip a single hex nibble inside the AEAD tag region (last hex char).
    // This is a tag-mismatch tampering attempt — the ciphertext is still a
    // syntactically valid hex string, just with one bit flipped.
    const lastHex = ct[ct.length - 1]
    const flipped = lastHex === '0' ? '1' : '0'
    const tampered = (ct.slice(0, -1) + flipped) as Ciphertext

    const result = decryptFromHubWithError(tampered, key, aad)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('decrypt_failed')
    }
  })

  test('structurally invalid ciphertext returns ok: false (not throw)', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-1:encrypted_name`)

    const result = decryptFromHubWithError('not-hex-at-all' as Ciphertext, key, aad)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('decrypt_failed')
    }
  })
})

describe('decryptFromHub (legacy null-return shim)', () => {
  test('delegates to decryptFromHubWithError on success', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-1:n`)
    const ct = encryptForHub('legacy-ok', key, aad)
    expect(decryptFromHub(ct, key, aad)).toBe('legacy-ok')
  })

  test('returns null for tampered ciphertext', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-1:n`)
    const ct = encryptForHub('legacy', key, aad)
    const lastHex = ct[ct.length - 1]
    const flipped = lastHex === '0' ? '1' : '0'
    const tampered = (ct.slice(0, -1) + flipped) as Ciphertext
    expect(decryptFromHub(tampered, key, aad)).toBeNull()
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

// ---- Multi-device wrap failure policies ----

/**
 * Build a CryptoKey handle that is NOT usable as an HPKE KEM recipient.
 * hpke-js expects an X25519 public key; any other CryptoKey (an AES-GCM
 * symmetric key here) makes the KEM encap step throw. That gives us a
 * deterministic failure injection without having to mock `hpkeSeal`.
 */
async function generateBrokenDevicePubkey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

describe('wrapHubKeyForDevices — failure policies', () => {
  test('abort policy: partial failure throws HubKeyWrapError with failed devices', async () => {
    const hubKey = generateHubKey()
    const good = await generateDeviceKeypair()
    const broken = await generateBrokenDevicePubkey()

    let caught: unknown = null
    try {
      await wrapHubKeyForDevices(
        hubKey,
        [
          { deviceId: 'good', encPubkey: good.publicKey },
          { deviceId: 'broken', encPubkey: broken },
        ],
        HUB_ID,
        'abort'
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(HubKeyWrapError)
    const err = caught as HubKeyWrapError
    expect(err.policy).toBe('abort')
    expect(err.hubId).toBe(HUB_ID)
    expect(err.failedDevices).toHaveLength(1)
    expect(err.failedDevices[0].deviceId).toBe('broken')
    expect(typeof err.failedDevices[0].error).toBe('string')
  })

  test('abort policy is the default when no policy is passed', async () => {
    const hubKey = generateHubKey()
    const good = await generateDeviceKeypair()
    const broken = await generateBrokenDevicePubkey()

    await expect(
      wrapHubKeyForDevices(
        hubKey,
        [
          { deviceId: 'good', encPubkey: good.publicKey },
          { deviceId: 'broken', encPubkey: broken },
        ],
        HUB_ID
      )
    ).rejects.toBeInstanceOf(HubKeyWrapError)
  })

  test('tolerate policy: partial failure returns only successful devices', async () => {
    const hubKey = generateHubKey()
    const good1 = await generateDeviceKeypair()
    const good2 = await generateDeviceKeypair()
    const broken = await generateBrokenDevicePubkey()

    const results = await wrapHubKeyForDevices(
      hubKey,
      [
        { deviceId: 'good-1', encPubkey: good1.publicKey },
        { deviceId: 'broken', encPubkey: broken },
        { deviceId: 'good-2', encPubkey: good2.publicKey },
      ],
      HUB_ID,
      'tolerate'
    )
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.deviceId).sort()).toEqual(['good-1', 'good-2'])
  })

  test('tolerate policy still throws when ALL devices fail (empty result is always a bug)', async () => {
    const hubKey = generateHubKey()
    const broken1 = await generateBrokenDevicePubkey()
    const broken2 = await generateBrokenDevicePubkey()

    let caught: unknown = null
    try {
      await wrapHubKeyForDevices(
        hubKey,
        [
          { deviceId: 'b1', encPubkey: broken1 },
          { deviceId: 'b2', encPubkey: broken2 },
        ],
        HUB_ID,
        'tolerate'
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(HubKeyWrapError)
    expect((caught as HubKeyWrapError).failedDevices).toHaveLength(2)
  })

  test('empty devices array returns empty result under either policy', async () => {
    const hubKey = generateHubKey()
    await expect(wrapHubKeyForDevices(hubKey, [], HUB_ID, 'abort')).resolves.toEqual([])
    await expect(wrapHubKeyForDevices(hubKey, [], HUB_ID, 'tolerate')).resolves.toEqual([])
  })

  test('happy path: all devices succeed, result matches input order', async () => {
    const hubKey = generateHubKey()
    const d1 = await generateDeviceKeypair()
    const d2 = await generateDeviceKeypair()

    const results = await wrapHubKeyForDevices(
      hubKey,
      [
        { deviceId: 'dev-1', encPubkey: d1.publicKey },
        { deviceId: 'dev-2', encPubkey: d2.publicKey },
      ],
      HUB_ID,
      'abort'
    )
    expect(results).toHaveLength(2)
    expect(results[0].deviceId).toBe('dev-1')
    expect(results[1].deviceId).toBe('dev-2')
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
      rotationReason: 'schedule',
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
      rotationReason: 'schedule',
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
      rotationReason: 'schedule',
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
      rotationReason: 'schedule',
    })

    expect(result.deviceCommitments).toHaveLength(1)
    expect(result.deviceCommitments[0].commitmentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.deviceCommitments[0].deviceId).toBe('dev-1')
  })

  test('non-revoke reasons abort when any device wrap fails (no half-commit)', async () => {
    const currentKey = generateHubKey()
    const good = await generateDeviceKeypair()
    const broken = await generateBrokenDevicePubkey()

    // `schedule`, `add`, and `manual` all map to the 'abort' policy — every
    // device must wrap successfully or the whole rotation is thrown. This
    // prevents silently locking the failing device out of the new generation.
    for (const reason of ['schedule', 'add', 'manual'] as const) {
      await expect(
        rotateHubKeyClkr({
          hubId: HUB_ID,
          currentHubKey: currentKey,
          currentGen: 1,
          remainingDevices: [
            { deviceId: 'good', encPubkey: good.publicKey },
            { deviceId: 'broken', encPubkey: broken },
          ],
          rotationReason: reason,
        })
      ).rejects.toBeInstanceOf(HubKeyWrapError)
    }
  })

  test('revoke reason tolerates per-device wrap failures and returns the successful subset', async () => {
    const currentKey = generateHubKey()
    const keep = await generateDeviceKeypair()
    const strangler = await generateBrokenDevicePubkey()

    // Rotate-on-revoke: the caller has already dropped the revoked device
    // from `remainingDevices`, but a straggler whose pubkey is unusable
    // (e.g. corrupted stored CryptoKey for a device we're about to exclude
    // anyway) should not block the rotation — the new key still has a
    // reader (`keep`) and we proceed.
    const result = await rotateHubKeyClkr({
      hubId: HUB_ID,
      currentHubKey: currentKey,
      currentGen: 1,
      remainingDevices: [
        { deviceId: 'keep', encPubkey: keep.publicKey },
        { deviceId: 'strangler', encPubkey: strangler },
      ],
      rotationReason: 'revoke',
    })
    expect(result.deviceEnvelopes.map((e) => e.deviceId)).toEqual(['keep'])
    expect(result.deviceCommitments.map((c) => c.deviceId)).toEqual(['keep'])
  })
})

// ---- Rotation cascade planning (Task 26) ----

describe('planRotationCascade', () => {
  test('returns identity (single hub) for member_removed', () => {
    const plan = planRotationCascade(HUB_ID, 'member_removed')
    expect(plan.triggerHub).toBe(HUB_ID)
    expect(plan.affectedHubs).toEqual([HUB_ID])
    expect(plan.reason).toBe('member_removed')
  })

  test('returns identity for device_removed', () => {
    const plan = planRotationCascade(HUB_ID, 'device_removed')
    expect(plan.affectedHubs).toEqual([HUB_ID])
    expect(plan.reason).toBe('device_removed')
  })

  test('returns identity for scheduled', () => {
    const plan = planRotationCascade(HUB_ID, 'scheduled')
    expect(plan.affectedHubs).toEqual([HUB_ID])
  })

  test('returns identity for manual', () => {
    const plan = planRotationCascade(HUB_ID, 'manual')
    expect(plan.affectedHubs).toEqual([HUB_ID])
  })
})
