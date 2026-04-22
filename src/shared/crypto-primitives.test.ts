import { describe, expect, test } from 'bun:test'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  type CryptoLabel,
  idToLabel,
  LABEL_HUB_KEY_WRAP,
  LABEL_MESSAGE,
  LABEL_NOTE_KEY,
  LABEL_REGISTRY,
  labelToId,
} from './crypto-labels'
import {
  CryptoLabelMismatchError,
  decryptEnvelope,
  type Envelope,
  eciesUnwrapKey,
  eciesWrapKey,
  hkdfDerive,
  hmacSha256,
  symmetricDecrypt,
  symmetricEncrypt,
} from './crypto-primitives'
import type { Ciphertext } from './crypto-types'

describe('symmetricEncrypt / symmetricDecrypt', () => {
  const emptyAad = new Uint8Array(0)

  test('round-trip with random key', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const plaintext = new TextEncoder().encode('hello world')
    const packed = symmetricEncrypt(plaintext, key, emptyAad)
    const recovered = symmetricDecrypt(packed, key, emptyAad)
    expect(new TextDecoder().decode(recovered)).toBe('hello world')
  })

  test('different nonce each time', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const plaintext = new TextEncoder().encode('same input')
    const a = symmetricEncrypt(plaintext, key, emptyAad)
    const b = symmetricEncrypt(plaintext, key, emptyAad)
    expect(a).not.toBe(b)
  })

  test('wrong key fails', () => {
    const key1 = new Uint8Array(32)
    crypto.getRandomValues(key1)
    const key2 = new Uint8Array(32)
    crypto.getRandomValues(key2)
    const plaintext = new TextEncoder().encode('secret')
    const packed = symmetricEncrypt(plaintext, key1, emptyAad)
    expect(() => symmetricDecrypt(packed, key2, emptyAad)).toThrow()
  })
})

describe('eciesWrapKey / eciesUnwrapKey', () => {
  test('round-trip key wrapping', () => {
    const recipientSecret = new Uint8Array(32)
    crypto.getRandomValues(recipientSecret)
    const recipientPubkey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true).slice(1))
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const envelope = eciesWrapKey(messageKey, recipientPubkey, LABEL_NOTE_KEY)
    const recovered = eciesUnwrapKey(envelope, recipientSecret, LABEL_NOTE_KEY)
    expect(bytesToHex(recovered)).toBe(bytesToHex(messageKey))
  })

  test('wrong label fails', () => {
    const recipientSecret = new Uint8Array(32)
    crypto.getRandomValues(recipientSecret)
    const recipientPubkey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true).slice(1))
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const envelope = eciesWrapKey(messageKey, recipientPubkey, LABEL_NOTE_KEY)
    expect(() => eciesUnwrapKey(envelope, recipientSecret, LABEL_HUB_KEY_WRAP)).toThrow()
  })
})

describe('hmacSha256', () => {
  test('deterministic', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const input = new TextEncoder().encode('phone:+15551234567')
    const a = hmacSha256(key, input)
    const b = hmacSha256(key, input)
    expect(bytesToHex(a)).toBe(bytesToHex(b))
  })

  test('different input gives different hash', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const a = hmacSha256(key, new TextEncoder().encode('a'))
    const b = hmacSha256(key, new TextEncoder().encode('b'))
    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })
})

describe('hkdfDerive', () => {
  test('deterministic derivation', () => {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    const salt = new Uint8Array(0)
    const info = new TextEncoder().encode('test:context')
    const a = hkdfDerive(secret, salt, info, 32)
    const b = hkdfDerive(secret, salt, info, 32)
    expect(bytesToHex(a)).toBe(bytesToHex(b))
  })

  test('different info gives different key', () => {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    const salt = new Uint8Array(0)
    const a = hkdfDerive(secret, salt, new TextEncoder().encode('context:a'), 32)
    const b = hkdfDerive(secret, salt, new TextEncoder().encode('context:b'), 32)
    expect(bytesToHex(a)).not.toBe(bytesToHex(b))
  })
})

describe('CryptoLabel brand + registry', () => {
  test('LABEL_REGISTRY entries are unique and prefixed with "llamenos:"', () => {
    expect(new Set(LABEL_REGISTRY).size).toBe(LABEL_REGISTRY.length)
    for (const label of LABEL_REGISTRY) {
      expect(label).toMatch(/^llamenos:/)
    }
  })

  test('labelToId returns a stable id per label', () => {
    expect(labelToId(LABEL_NOTE_KEY)).toBe(0)
    expect(labelToId(LABEL_HUB_KEY_WRAP)).toBe(1)
  })

  test('idToLabel round-trips', () => {
    expect(idToLabel(0)).toBe(LABEL_NOTE_KEY)
    expect(idToLabel(1)).toBe(LABEL_HUB_KEY_WRAP)
  })

  test('labelToId throws on unregistered label', () => {
    expect(() => labelToId('llamenos:nonexistent' as CryptoLabel)).toThrow(
      /Unregistered crypto label: llamenos:nonexistent/
    )
  })

  test('idToLabel throws on unknown id', () => {
    expect(() => idToLabel(999)).toThrow(/Unknown crypto label id: 999/)
  })
})

describe('AAD binding', () => {
  const key = new Uint8Array(32).fill(7)
  const plaintext = utf8ToBytes('secret message')

  test('matching AAD round-trips', () => {
    const aad = utf8ToBytes('ctx:record-42')
    const ct = symmetricEncrypt(plaintext, key, aad)
    const pt = symmetricDecrypt(ct, key, aad)
    expect(new TextDecoder().decode(pt)).toBe('secret message')
  })

  test('mismatched AAD throws', () => {
    const ct = symmetricEncrypt(plaintext, key, utf8ToBytes('ctx:record-42'))
    expect(() => symmetricDecrypt(ct, key, utf8ToBytes('ctx:record-43'))).toThrow()
  })

  test('empty AAD is allowed and round-trips', () => {
    const aad = new Uint8Array(0)
    const ct = symmetricEncrypt(plaintext, key, aad)
    const pt = symmetricDecrypt(ct, key, aad)
    expect(new TextDecoder().decode(pt)).toBe('secret message')
  })
})

describe('Envelope v2 + label mismatch', () => {
  const secretKey = new Uint8Array(32).fill(11)
  const pubkey = bytesToHex(secp256k1.getPublicKey(secretKey, true).slice(1))

  test('decryptEnvelope succeeds with matching label', async () => {
    const raw = eciesWrapKey(new Uint8Array(32).fill(5), pubkey, LABEL_NOTE_KEY)
    const env: Envelope = {
      // @ts-expect-error Slice 7: ECIES envelope v2 → HPKE v3
      v: 2,
      labelId: labelToId(LABEL_NOTE_KEY),
      wrappedKey: raw.wrappedKey,
      ephemeralPubkey: raw.ephemeralPubkey,
    }
    const unwrap = (_ep: string, _wk: string, _label: CryptoLabel) =>
      Promise.resolve(new Uint8Array(32).fill(5))
    const out = await decryptEnvelope(env, unwrap, LABEL_NOTE_KEY)
    expect(out.length).toBe(32)
  })

  test('decryptEnvelope rejects wrong labelId', async () => {
    const env: Envelope = {
      // @ts-expect-error Slice 7: ECIES envelope v2 → HPKE v3
      v: 2,
      labelId: labelToId(LABEL_MESSAGE), // wrong registry id
      wrappedKey: 'deadbeef' as Ciphertext,
      ephemeralPubkey: '00'.repeat(33),
    }
    const unwrap = () => Promise.resolve(new Uint8Array(0))
    await expect(decryptEnvelope(env, unwrap, LABEL_NOTE_KEY)).rejects.toBeInstanceOf(
      CryptoLabelMismatchError
    )
  })

  test('decryptEnvelope rejects v !== 2', async () => {
    const env = {
      v: 1,
      labelId: 0,
      wrappedKey: 'ab' as Ciphertext,
      ephemeralPubkey: '',
    } as unknown as Envelope
    await expect(
      decryptEnvelope(env, () => Promise.resolve(new Uint8Array(0)), LABEL_NOTE_KEY)
    ).rejects.toBeInstanceOf(CryptoLabelMismatchError)
  })
})
