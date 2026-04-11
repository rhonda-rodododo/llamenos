import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  type CryptoLabel,
  LABEL_HUB_KEY_WRAP,
  LABEL_NOTE_KEY,
  LABEL_REGISTRY,
  idToLabel,
  labelToId,
} from './crypto-labels'
import {
  eciesUnwrapKey,
  eciesWrapKey,
  hkdfDerive,
  hmacSha256,
  symmetricDecrypt,
  symmetricEncrypt,
} from './crypto-primitives'

describe('symmetricEncrypt / symmetricDecrypt', () => {
  test('round-trip with random key', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const plaintext = new TextEncoder().encode('hello world')
    const packed = symmetricEncrypt(plaintext, key)
    const recovered = symmetricDecrypt(packed, key)
    expect(new TextDecoder().decode(recovered)).toBe('hello world')
  })

  test('different nonce each time', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const plaintext = new TextEncoder().encode('same input')
    const a = symmetricEncrypt(plaintext, key)
    const b = symmetricEncrypt(plaintext, key)
    expect(a).not.toBe(b)
  })

  test('wrong key fails', () => {
    const key1 = new Uint8Array(32)
    crypto.getRandomValues(key1)
    const key2 = new Uint8Array(32)
    crypto.getRandomValues(key2)
    const plaintext = new TextEncoder().encode('secret')
    const packed = symmetricEncrypt(plaintext, key1)
    expect(() => symmetricDecrypt(packed, key2)).toThrow()
  })
})

describe('eciesWrapKey / eciesUnwrapKey', () => {
  test('round-trip key wrapping', () => {
    const recipientSecret = new Uint8Array(32)
    crypto.getRandomValues(recipientSecret)
    const recipientPubkey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true).slice(1))
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const envelope = eciesWrapKey(messageKey, recipientPubkey, 'test:label')
    const recovered = eciesUnwrapKey(envelope, recipientSecret, 'test:label')
    expect(bytesToHex(recovered)).toBe(bytesToHex(messageKey))
  })

  test('wrong label fails', () => {
    const recipientSecret = new Uint8Array(32)
    crypto.getRandomValues(recipientSecret)
    const recipientPubkey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true).slice(1))
    const messageKey = new Uint8Array(32)
    crypto.getRandomValues(messageKey)
    const envelope = eciesWrapKey(messageKey, recipientPubkey, 'label:a')
    expect(() => eciesUnwrapKey(envelope, recipientSecret, 'label:b')).toThrow()
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
