import { describe, expect, test } from 'bun:test'
import { LABEL_HUB_KEY_WRAP, LABEL_MESSAGE, LABEL_NOTE_KEY } from '@shared/crypto-labels'
import { createHpkeSuite } from '@shared/crypto-suite'
import { HpkeService } from './hpke-service.js'

const SERVER_SECRET_HEX = 'a'.repeat(64)
const OTHER_SECRET_HEX = 'b'.repeat(64)
const te = new TextEncoder()
const td = new TextDecoder()

async function makeMemberKeyPair() {
  const suite = createHpkeSuite()
  const kp = (await suite.kem.generateKeyPair()) as CryptoKeyPair
  const pubBytes = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))
  return { kp, pubBytes }
}

describe('HpkeService', () => {
  test('getPublicKeyBytes is deterministic across instances (HKDF of secret)', async () => {
    const a = new HpkeService(SERVER_SECRET_HEX)
    const b = new HpkeService(SERVER_SECRET_HEX)
    const pa = await a.getPublicKeyBytes()
    const pb = await b.getPublicKeyBytes()
    expect(pa).toEqual(pb)
    expect(pa.byteLength).toBe(32)
  })

  test('different SERVER_SECRET produces different pubkey', async () => {
    const a = new HpkeService(SERVER_SECRET_HEX)
    const b = new HpkeService(OTHER_SECRET_HEX)
    expect(await a.getPublicKeyBytes()).not.toEqual(await b.getPublicKeyBytes())
  })

  test('sealFor + open by recipient (not by server)', async () => {
    const svc = new HpkeService(SERVER_SECRET_HEX)
    const { kp, pubBytes } = await makeMemberKeyPair()
    const env = await svc.sealFor(
      te.encode('hi user'),
      pubBytes,
      LABEL_NOTE_KEY,
      'note-42',
      'content'
    )
    // Decrypt via hpke-primitives directly (recipient side)
    const { hpkeOpen, buildAad } = await import('@shared/hpke-primitives')
    const pt = await hpkeOpen(
      env,
      kp.privateKey,
      LABEL_NOTE_KEY,
      buildAad(LABEL_NOTE_KEY, 'note-42', 'content')
    )
    expect(td.decode(pt)).toBe('hi user')
  })

  test('openForServer rejects wrong expected label', async () => {
    const svc = new HpkeService(SERVER_SECRET_HEX)
    const serverPub = await svc.getPublicKey()
    const { hpkeSeal, buildAad } = await import('@shared/hpke-primitives')
    const env = await hpkeSeal(
      te.encode('data'),
      serverPub,
      LABEL_NOTE_KEY,
      buildAad(LABEL_NOTE_KEY, 'r', 'f')
    )
    await expect(svc.openForServer(env, LABEL_MESSAGE, 'r', 'f')).rejects.toThrow()
  })

  test('generateAndWrapHubKey wraps for every member + server, no dupes', async () => {
    const svc = new HpkeService(SERVER_SECRET_HEX)
    const m1 = await makeMemberKeyPair()
    const m2 = await makeMemberKeyPair()
    const { hubKey, envelopes } = await svc.generateAndWrapHubKey([m1.pubBytes, m2.pubBytes])
    expect(hubKey.byteLength).toBe(32)
    expect(envelopes.length).toBe(3)
    const hexes = new Set(envelopes.map((e) => e.pubkeyHex))
    expect(hexes.size).toBe(3)
  })

  test('unwrapHubKey recovers the same key the server wrapped', async () => {
    const svc = new HpkeService(SERVER_SECRET_HEX)
    const m1 = await makeMemberKeyPair()
    const { hubKey, envelopes } = await svc.generateAndWrapHubKey([m1.pubBytes])
    const recovered = await svc.unwrapHubKey(envelopes)
    expect(recovered).toEqual(hubKey)
  })

  test('unwrapHubKey throws when server envelope missing', async () => {
    const svc = new HpkeService(SERVER_SECRET_HEX)
    const m1 = await makeMemberKeyPair()
    const { envelopes } = await svc.generateAndWrapHubKey([m1.pubBytes])
    // Drop the server envelope
    const serverHex = Array.from(await svc.getPublicKeyBytes())
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const memberOnly = envelopes.filter((e) => e.pubkeyHex !== serverHex)
    await expect(svc.unwrapHubKey(memberOnly)).rejects.toThrow()
  })

  test('wrapHubKeyForNewMember: new member can unwrap; server still can', async () => {
    const svc = new HpkeService(SERVER_SECRET_HEX)
    const m1 = await makeMemberKeyPair()
    const { hubKey, envelopes } = await svc.generateAndWrapHubKey([m1.pubBytes])

    const newMember = await makeMemberKeyPair()
    const wrapped = await svc.wrapHubKeyForNewMember(envelopes, newMember.pubBytes)
    expect(wrapped.pubkeyHex.length).toBe(64)

    // Recipient-side unwrap for new member
    const { hpkeOpen, buildAad } = await import('@shared/hpke-primitives')
    const aad = buildAad(LABEL_HUB_KEY_WRAP, wrapped.pubkeyHex, 'hub-key-wrap')
    const recovered = await hpkeOpen(
      wrapped.envelope,
      newMember.kp.privateKey,
      LABEL_HUB_KEY_WRAP,
      aad
    )
    expect(recovered).toEqual(hubKey)
  })

  test('sealFor/openForServer are bound to AAD (row swap rejected)', async () => {
    const svc = new HpkeService(SERVER_SECRET_HEX)
    const serverPub = await svc.getPublicKey()
    const { hpkeSeal, buildAad } = await import('@shared/hpke-primitives')
    const env = await hpkeSeal(
      te.encode('secret'),
      serverPub,
      LABEL_NOTE_KEY,
      buildAad(LABEL_NOTE_KEY, 'row-A', 'f')
    )
    await expect(svc.openForServer(env, LABEL_NOTE_KEY, 'row-B', 'f')).rejects.toThrow()
  })
})
