import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import { createHpkeSuite } from '@shared/crypto-suite'
import { ClientCryptoService } from './crypto-service'

describe('ClientCryptoService', () => {
  async function createTestClient() {
    const suite = createHpkeSuite()
    const kp = await suite.kem.generateKeyPair()
    const pubkeyBytes = await suite.kem.serializePublicKey(kp.publicKey as CryptoKey)
    const pubkey = bytesToHex(new Uint8Array(pubkeyBytes))
    const privkeyBytes = await suite.kem.serializePrivateKey(kp.privateKey as CryptoKey)
    const client = await ClientCryptoService.create(new Uint8Array(privkeyBytes), pubkey)
    return { client, pubkey }
  }

  describe('envelopeEncrypt / envelopeDecrypt', () => {
    test('self-encrypt round-trip', async () => {
      const { client, pubkey } = await createTestClient()
      const { encrypted, envelopes } = await client.envelopeEncrypt(
        'my name',
        [pubkey],
        LABEL_USER_PII
      )
      const pt = await client.envelopeDecrypt(encrypted, envelopes, LABEL_USER_PII)
      expect(pt).toBe('my name')
    })

    test('encrypt for self + other recipient', async () => {
      const { client: client1, pubkey: pub1 } = await createTestClient()
      const { client: client2, pubkey: pub2 } = await createTestClient()

      const { encrypted, envelopes } = await client1.envelopeEncrypt(
        'shared',
        [pub1, pub2],
        LABEL_USER_PII
      )

      expect(await client1.envelopeDecrypt(encrypted, envelopes, LABEL_USER_PII)).toBe('shared')
      expect(await client2.envelopeDecrypt(encrypted, envelopes, LABEL_USER_PII)).toBe('shared')
    })
  })

  describe('encryptDraft / decryptDraft', () => {
    test('round-trip', async () => {
      const { client } = await createTestClient()
      const ct = await client.encryptDraft('draft text')
      const pt = await client.decryptDraft(ct)
      expect(pt).toBe('draft text')
    })
  })
})
