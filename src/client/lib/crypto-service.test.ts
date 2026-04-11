import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LABEL_USER_PII } from '@shared/crypto-labels'
import { ClientCryptoService } from './crypto-service'

describe('ClientCryptoService', () => {
  const secretKey = new Uint8Array(32)
  globalThis.crypto.getRandomValues(secretKey)
  const pubkey = bytesToHex(secp256k1.getPublicKey(secretKey, true).slice(1))
  const client = new ClientCryptoService(secretKey, pubkey)

  describe('envelopeEncrypt / envelopeDecrypt', () => {
    test('self-encrypt round-trip', () => {
      const { encrypted, envelopes } = client.envelopeEncrypt('my name', [pubkey], LABEL_USER_PII)
      const pt = client.envelopeDecrypt(encrypted, envelopes, LABEL_USER_PII)
      expect(pt).toBe('my name')
    })

    test('encrypt for self + other recipient', () => {
      const otherSecret = new Uint8Array(32)
      globalThis.crypto.getRandomValues(otherSecret)
      const otherPub = bytesToHex(secp256k1.getPublicKey(otherSecret, true).slice(1))
      const otherClient = new ClientCryptoService(otherSecret, otherPub)

      const { encrypted, envelopes } = client.envelopeEncrypt(
        'shared',
        [pubkey, otherPub],
        LABEL_USER_PII
      )

      expect(client.envelopeDecrypt(encrypted, envelopes, LABEL_USER_PII)).toBe('shared')
      expect(otherClient.envelopeDecrypt(encrypted, envelopes, LABEL_USER_PII)).toBe('shared')
    })
  })

  describe('encryptDraft / decryptDraft', () => {
    test('round-trip', () => {
      const ct = client.encryptDraft('draft text')
      const pt = client.decryptDraft(ct)
      expect(pt).toBe('draft text')
    })
  })
})
