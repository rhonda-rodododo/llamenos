import { beforeEach, describe, expect, test } from 'bun:test'
import { generateDeviceKeypair } from './device-identity'
import {
  InMemoryDeviceKeypairStorage,
  MultipleDeviceKeypairsError,
  clearDeviceKeypairStore,
  forceInsertRawDeviceKeypair,
  getDeviceKeypair,
  putDeviceKeypair,
  setDeviceKeypairStorage,
} from './device-identity-store'

describe('device-identity-store', () => {
  beforeEach(() => {
    // Use in-memory backend — fake-indexeddb can't structured-clone CryptoKey
    setDeviceKeypairStorage(new InMemoryDeviceKeypairStorage())
  })

  test('put then get round-trips', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(kp)
    const loaded = await getDeviceKeypair()
    expect(loaded).not.toBeNull()
    expect(loaded!.deviceId).toBe(kp.deviceId)
    expect(loaded!.signing.publicKey).toEqual(kp.signing.publicKey)
    expect(loaded!.encryption.publicKey).toEqual(kp.encryption.publicKey)
  })

  test('loaded signing private key still works non-extractably', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(kp)
    const loaded = await getDeviceKeypair()
    const msg = new TextEncoder().encode('hello')
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, loaded!.signing.privateKey, msg)
    expect(sig.byteLength).toBe(64)
    await expect(crypto.subtle.exportKey('raw', loaded!.signing.privateKey)).rejects.toThrow()
  })

  test('empty store returns null', async () => {
    const loaded = await getDeviceKeypair()
    expect(loaded).toBeNull()
  })

  test('multiple keypairs in store throws', async () => {
    const a = await generateDeviceKeypair({ isPaperKey: false })
    const b = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(a)
    // Simulate corruption by force-inserting a second keypair
    await forceInsertRawDeviceKeypair(b)
    await expect(getDeviceKeypair()).rejects.toThrow(MultipleDeviceKeypairsError)
  })

  test('put replaces the previous keypair', async () => {
    const a = await generateDeviceKeypair({ isPaperKey: false })
    const b = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(a)
    await putDeviceKeypair(b)
    const loaded = await getDeviceKeypair()
    expect(loaded!.deviceId).toBe(b.deviceId)
  })

  test('preserves isPaperKey flag', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: true })
    await putDeviceKeypair(kp)
    const loaded = await getDeviceKeypair()
    expect(loaded!.isPaperKey).toBe(true)
  })

  test('clearDeviceKeypairStore empties the store', async () => {
    const kp = await generateDeviceKeypair({ isPaperKey: false })
    await putDeviceKeypair(kp)
    await clearDeviceKeypairStore()
    const loaded = await getDeviceKeypair()
    expect(loaded).toBeNull()
  })
})
