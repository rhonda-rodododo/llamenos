import { describe, expect, test } from 'bun:test'
import { LABEL_HUB_FIELD, LABEL_MESSAGE, LABEL_NOTE_KEY } from './crypto-labels.js'
import { createHpkeSuite } from './crypto-suite.js'
import {
  HpkeLabelMismatchError,
  buildAad,
  decryptEnvelopeV3,
  hpkeOpen,
  hpkeSeal,
} from './hpke-primitives.js'

async function genRecipient(): Promise<CryptoKeyPair> {
  const suite = createHpkeSuite()
  return (await suite.kem.generateKeyPair()) as CryptoKeyPair
}

const te = new TextEncoder()
const td = new TextDecoder()

describe('hpke-primitives', () => {
  describe('buildAad', () => {
    test('builds the canonical label:recordId:fieldName format', () => {
      const aad = buildAad(LABEL_HUB_FIELD, 'record-123', 'displayName')
      expect(td.decode(aad)).toBe('llamenos:hub-field:record-123:displayName')
    })
  })

  describe('seal/open round trip', () => {
    test('with matching label and AAD', async () => {
      const { publicKey, privateKey } = await genRecipient()
      const aad = buildAad(LABEL_NOTE_KEY, 'note-1', 'content')
      const env = await hpkeSeal(te.encode('secret'), publicKey, LABEL_NOTE_KEY, aad)
      expect(env.v).toBe(3)
      const pt = await hpkeOpen(env, privateKey, LABEL_NOTE_KEY, aad)
      expect(td.decode(pt)).toBe('secret')
    })

    test('label mismatch rejects before HPKE is touched', async () => {
      const { publicKey, privateKey } = await genRecipient()
      const aad = buildAad(LABEL_NOTE_KEY, 'note-1', 'content')
      const env = await hpkeSeal(te.encode('secret'), publicKey, LABEL_NOTE_KEY, aad)
      await expect(hpkeOpen(env, privateKey, LABEL_MESSAGE, aad)).rejects.toThrow(
        HpkeLabelMismatchError
      )
    })

    test('AAD mismatch is rejected by AEAD (swapped row)', async () => {
      const { publicKey, privateKey } = await genRecipient()
      const sealAad = buildAad(LABEL_NOTE_KEY, 'note-1', 'content')
      const openAad = buildAad(LABEL_NOTE_KEY, 'note-2', 'content')
      const env = await hpkeSeal(te.encode('secret'), publicKey, LABEL_NOTE_KEY, sealAad)
      await expect(hpkeOpen(env, privateKey, LABEL_NOTE_KEY, openAad)).rejects.toThrow()
    })

    test('wrong field in AAD is rejected (swapped column)', async () => {
      const { publicKey, privateKey } = await genRecipient()
      const sealAad = buildAad(LABEL_HUB_FIELD, 'shift-1', 'name')
      const openAad = buildAad(LABEL_HUB_FIELD, 'shift-1', 'description')
      const env = await hpkeSeal(te.encode('payload'), publicKey, LABEL_HUB_FIELD, sealAad)
      await expect(hpkeOpen(env, privateKey, LABEL_HUB_FIELD, openAad)).rejects.toThrow()
    })

    test('wrong recipient key is rejected', async () => {
      const { publicKey } = await genRecipient()
      const other = await genRecipient()
      const aad = buildAad(LABEL_NOTE_KEY, 'note-1', 'content')
      const env = await hpkeSeal(te.encode('secret'), publicKey, LABEL_NOTE_KEY, aad)
      await expect(hpkeOpen(env, other.privateKey, LABEL_NOTE_KEY, aad)).rejects.toThrow()
    })

    test('tampered ciphertext is rejected', async () => {
      const { publicKey, privateKey } = await genRecipient()
      const aad = buildAad(LABEL_NOTE_KEY, 'note-1', 'content')
      const env = await hpkeSeal(te.encode('secret'), publicKey, LABEL_NOTE_KEY, aad)
      const tampered = { ...env, ct: `${env.ct.slice(0, -2)}AA` }
      await expect(hpkeOpen(tampered, privateKey, LABEL_NOTE_KEY, aad)).rejects.toThrow()
    })
  })

  describe('decryptEnvelopeV3', () => {
    test('parses unknown and dispatches to hpkeOpen', async () => {
      const { publicKey, privateKey } = await genRecipient()
      const aad = buildAad(LABEL_NOTE_KEY, 'r', 'f')
      const env = await hpkeSeal(te.encode('hello'), publicKey, LABEL_NOTE_KEY, aad)
      const pt = await decryptEnvelopeV3(
        JSON.parse(JSON.stringify(env)),
        privateKey,
        LABEL_NOTE_KEY,
        aad
      )
      expect(td.decode(pt)).toBe('hello')
    })

    test('rejects malformed envelope shape', async () => {
      const { privateKey } = await genRecipient()
      await expect(
        decryptEnvelopeV3(
          { v: 2, labelId: 0, wrappedKey: 'x', ephemeralPubkey: 'y' },
          privateKey,
          LABEL_NOTE_KEY,
          new Uint8Array()
        )
      ).rejects.toThrow()
    })

    test('rejects envelope version that is not 3', async () => {
      const { privateKey } = await genRecipient()
      await expect(
        decryptEnvelopeV3(
          { v: 3, labelId: 0, enc: '', ct: '' },
          privateKey,
          LABEL_NOTE_KEY,
          new Uint8Array()
        )
      ).rejects.toThrow()
    })
  })
})
