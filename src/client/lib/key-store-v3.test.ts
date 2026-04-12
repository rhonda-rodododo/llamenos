import { describe, expect, test } from 'bun:test'
import { LABEL_NOTE_KEY } from '@shared/crypto-labels'
import { createHpkeSuite } from '@shared/crypto-suite'
import { buildAad, hpkeOpen, hpkeSeal } from '@shared/hpke-primitives'
import { createMemoryKeyStorage } from './key-store-v3-types.js'
import {
  KeyStoreLocked,
  KeyStoreMissing,
  KeyStoreV3,
  KeyStoreWrongPin,
  generateIdentityKeyPair,
} from './key-store-v3.js'

async function seed() {
  const storage = createMemoryKeyStorage()
  const ks = new KeyStoreV3(storage)
  const id = await generateIdentityKeyPair()
  const hubKeyRaw = crypto.getRandomValues(new Uint8Array(32))
  await ks.create({
    identityRaw: id.privateRaw,
    identityPublic: id.publicRaw,
    hubKeyRaw,
    pin: 'hunter2',
  })
  return { ks, storage, id, hubKeyRaw }
}

describe('KeyStoreV3', () => {
  test('create persists a blob and leaves store unlocked', async () => {
    const { ks, storage } = await seed()
    expect(ks.isLocked()).toBe(false)
    const u = ks.getUnlocked()
    expect(u.identityPrivateRaw.byteLength).toBe(32)
    expect(u.identityPublic.byteLength).toBe(32)
    expect(u.hubKey.algorithm.name).toBe('AES-GCM')
    expect(u.hubKey.extractable).toBe(false)
    expect(await storage.load()).not.toBeNull()
  })

  test('lock zeroes identityPrivateRaw and drops hub key', async () => {
    const { ks } = await seed()
    const u = ks.getUnlocked()
    const rawRef = u.identityPrivateRaw
    ks.lock()
    expect(ks.isLocked()).toBe(true)
    expect(Array.from(rawRef)).toEqual(Array.from(new Uint8Array(32))) // all zeros
    expect(() => ks.getUnlocked()).toThrow(KeyStoreLocked)
  })

  test('unlock restores non-extractable hub key + identity bytes', async () => {
    const { ks, id, hubKeyRaw } = await seed()
    ks.lock()
    const u = await ks.unlock('hunter2')
    expect(u.identityPrivateRaw).toEqual(id.privateRaw)
    expect(u.identityPublic).toEqual(id.publicRaw)
    expect(u.hubKey.extractable).toBe(false)

    // Prove the unwrapped hub key actually decrypts data that was encrypted
    // with the original raw hub key.
    const originalHub = await crypto.subtle.importKey(
      'raw',
      hubKeyRaw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        originalHub,
        new TextEncoder().encode('hub-message')
      )
    )
    const pt = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, u.hubKey, ct)
    )
    expect(new TextDecoder().decode(pt)).toBe('hub-message')
  })

  test('wrong pin throws KeyStoreWrongPin', async () => {
    const { ks } = await seed()
    ks.lock()
    await expect(ks.unlock('wrong')).rejects.toThrow(KeyStoreWrongPin)
  })

  test('unlock with no blob throws KeyStoreMissing', async () => {
    const ks = new KeyStoreV3(createMemoryKeyStorage())
    await expect(ks.unlock('any')).rejects.toThrow(KeyStoreMissing)
  })

  test('rotatePin: new pin unlocks; old pin fails', async () => {
    const { ks } = await seed()
    await ks.rotatePin('hunter2', 'new-pin-456')
    ks.lock()
    await expect(ks.unlock('hunter2')).rejects.toThrow(KeyStoreWrongPin)
    const u = await ks.unlock('new-pin-456')
    expect(u.hubKey.extractable).toBe(false)
  })

  test('unlocked identity bytes work for HPKE open via @hpke/dhkem-x25519', async () => {
    const { ks } = await seed()
    const u = ks.getUnlocked()

    const suite = createHpkeSuite()
    // Import the unlocked public key into the KEM to act as the sender target
    const pub = await suite.kem.deserializePublicKey(u.identityPublic)
    const aad = buildAad(LABEL_NOTE_KEY, 'note-1', 'content')
    const env = await hpkeSeal(new TextEncoder().encode('hi'), pub, LABEL_NOTE_KEY, aad)

    const priv = await suite.kem.deserializePrivateKey(u.identityPrivateRaw)
    const pt = await hpkeOpen(env, priv, LABEL_NOTE_KEY, aad)
    expect(new TextDecoder().decode(pt)).toBe('hi')
  })

  test('wipe clears storage and locks the store', async () => {
    const { ks, storage } = await seed()
    await ks.wipe()
    expect(ks.isLocked()).toBe(true)
    expect(await storage.load()).toBeNull()
  })
})
