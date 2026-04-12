import { describe, expect, test } from 'bun:test'
import { AeadId, CipherSuite, KdfId, KemId } from '@hpke/core'
import { HPKE_SUITE_ID, createHpkeSuite } from './crypto-suite.js'

describe('crypto-suite', () => {
  test('HPKE_SUITE_ID is the stable v1 identifier', () => {
    expect(HPKE_SUITE_ID).toBe('llamenos-hpke-v1:x25519-hkdf-sha256-aes256gcm')
  })

  test('createHpkeSuite returns a CipherSuite instance', () => {
    const suite = createHpkeSuite()
    expect(suite).toBeInstanceOf(CipherSuite)
  })

  test('suite uses RFC 9180 IDs: DHKEM(X25519,SHA256) + HKDF-SHA256 + AES-256-GCM', () => {
    const suite = createHpkeSuite()
    expect(suite.kem.id).toBe(KemId.DhkemX25519HkdfSha256)
    expect(suite.kdf.id).toBe(KdfId.HkdfSha256)
    expect(suite.aead.id).toBe(AeadId.Aes256Gcm)
    expect(suite.kem.id).toBe(0x0020)
    expect(suite.kdf.id).toBe(0x0001)
    expect(suite.aead.id).toBe(0x0002)
  })

  test('end-to-end seal/open round trip with AAD', async () => {
    const suite = createHpkeSuite()
    const rkp = await suite.kem.generateKeyPair()

    const sender = await suite.createSenderContext({ recipientPublicKey: rkp.publicKey })
    const pt = new TextEncoder().encode('hello hpke')
    const aad = new TextEncoder().encode('test:aad:binding')
    const ct = await sender.seal(pt, aad)

    const recipient = await suite.createRecipientContext({
      recipientKey: rkp.privateKey,
      enc: sender.enc,
    })
    const opened = await recipient.open(ct, aad)
    expect(new TextDecoder().decode(opened)).toBe('hello hpke')
  })

  test('wrong AAD causes open to fail', async () => {
    const suite = createHpkeSuite()
    const rkp = await suite.kem.generateKeyPair()

    const sender = await suite.createSenderContext({ recipientPublicKey: rkp.publicKey })
    const ct = await sender.seal(
      new TextEncoder().encode('payload'),
      new TextEncoder().encode('aad-A')
    )

    const recipient = await suite.createRecipientContext({
      recipientKey: rkp.privateKey,
      enc: sender.enc,
    })
    await expect(recipient.open(ct, new TextEncoder().encode('aad-B'))).rejects.toThrow()
  })
})
