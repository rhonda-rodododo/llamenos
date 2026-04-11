import { describe, expect, test } from 'bun:test'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  type CryptoLabel,
  HMAC_PHONE_PREFIX,
  LABEL_AUDIT_EVENT,
  LABEL_CALL_META,
  LABEL_HUB_KEY_WRAP,
  LABEL_MESSAGE,
  LABEL_SERVER_NOSTR_KEY,
  LABEL_SERVER_NOSTR_KEY_INFO,
  LABEL_USER_PII,
  LABEL_VOICEMAIL_WRAP,
} from '@shared/crypto-labels'
import { eciesWrapKey, hkdfDerive } from '@shared/crypto-primitives'
import { CryptoService } from './crypto-service'

const TEST_SERVER_SECRET = '0000000000000000000000000000000000000000000000000000000000000001'
const TEST_HMAC_SECRET = '0000000000000000000000000000000000000000000000000000000000000002'

function randomKeypair() {
  const secret = new Uint8Array(32)
  globalThis.crypto.getRandomValues(secret)
  const pubkey = bytesToHex(secp256k1.getPublicKey(secret, true).slice(1))
  return { secret, pubkey }
}

describe('CryptoService', () => {
  const crypto = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET)

  // ── serverEncrypt / serverDecrypt ──

  describe('serverEncrypt / serverDecrypt', () => {
    test('round-trip', () => {
      const ct = crypto.serverEncrypt('hello', LABEL_USER_PII)
      const pt = crypto.serverDecrypt(ct, LABEL_USER_PII)
      expect(pt).toBe('hello')
    })

    test('different nonce each time', () => {
      const a = crypto.serverEncrypt('same', LABEL_USER_PII)
      const b = crypto.serverEncrypt('same', LABEL_USER_PII)
      expect(a).not.toBe(b)
    })

    test('wrong label fails', () => {
      const ct = crypto.serverEncrypt('secret', LABEL_USER_PII)
      expect(() => crypto.serverDecrypt(ct, 'wrong:label' as CryptoLabel)).toThrow()
    })

    test('empty string round-trip', () => {
      const ct = crypto.serverEncrypt('', LABEL_USER_PII)
      const pt = crypto.serverDecrypt(ct, LABEL_USER_PII)
      expect(pt).toBe('')
    })
  })

  // ── hmac ──

  describe('hmac', () => {
    test('deterministic', () => {
      const a = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      const b = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      expect(a).toBe(b)
    })

    test('different label gives different hash', () => {
      const a = crypto.hmac('+15551234567', 'label:a')
      const b = crypto.hmac('+15551234567', 'label:b')
      expect(a).not.toBe(b)
    })

    test('different input gives different hash', () => {
      const a = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      const b = crypto.hmac('+15559876543', HMAC_PHONE_PREFIX)
      expect(a).not.toBe(b)
    })

    test('output is valid hex (64 chars = SHA-256)', () => {
      const h = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      expect(h).toMatch(/^[0-9a-f]{64}$/)
    })

    test('different server instances with different secrets produce different hashes', () => {
      const crypto2 = new CryptoService(TEST_SERVER_SECRET, 'f'.repeat(64))
      const a = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      const b = crypto2.hmac('+15551234567', HMAC_PHONE_PREFIX)
      expect(a).not.toBe(b)
    })
  })

  // ── envelopeEncrypt / envelopeDecrypt ──

  describe('envelopeEncrypt / envelopeDecrypt', () => {
    test('round-trip with single recipient', () => {
      const { secret, pubkey } = randomKeypair()

      const { encrypted, envelopes } = crypto.envelopeEncrypt(
        'secret message',
        [pubkey],
        LABEL_USER_PII
      )

      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pubkey).toBe(pubkey)

      const pt = crypto.envelopeDecrypt(encrypted, envelopes[0], secret, LABEL_USER_PII)
      expect(pt).toBe('secret message')
    })

    test('multiple recipients can each decrypt', () => {
      const r1 = randomKeypair()
      const r2 = randomKeypair()

      const { encrypted, envelopes } = crypto.envelopeEncrypt(
        'shared secret',
        [r1.pubkey, r2.pubkey],
        LABEL_USER_PII
      )

      expect(envelopes).toHaveLength(2)

      const env1 = envelopes.find((e) => e.pubkey === r1.pubkey)!
      const env2 = envelopes.find((e) => e.pubkey === r2.pubkey)!

      expect(crypto.envelopeDecrypt(encrypted, env1, r1.secret, LABEL_USER_PII)).toBe(
        'shared secret'
      )
      expect(crypto.envelopeDecrypt(encrypted, env2, r2.secret, LABEL_USER_PII)).toBe(
        'shared secret'
      )
    })

    test('wrong label fails — domain separation', () => {
      const { secret, pubkey } = randomKeypair()

      const { encrypted, envelopes } = crypto.envelopeEncrypt(
        'test message',
        [pubkey],
        LABEL_MESSAGE
      )

      expect(() =>
        crypto.envelopeDecrypt(encrypted, envelopes[0], secret, LABEL_CALL_META)
      ).toThrow()
    })

    test('wrong private key fails', () => {
      const { pubkey } = randomKeypair()
      const wrongKey = randomKeypair()

      const { encrypted, envelopes } = crypto.envelopeEncrypt(
        'test message',
        [pubkey],
        LABEL_USER_PII
      )

      expect(() =>
        crypto.envelopeDecrypt(encrypted, envelopes[0], wrongKey.secret, LABEL_USER_PII)
      ).toThrow()
    })

    test('nonce uniqueness — same plaintext produces different ciphertext', () => {
      const { pubkey } = randomKeypair()

      const a = crypto.envelopeEncrypt('same text', [pubkey], LABEL_USER_PII)
      const b = crypto.envelopeEncrypt('same text', [pubkey], LABEL_USER_PII)
      expect(a.encrypted).not.toBe(b.encrypted)
    })
  })

  // ── envelopeEncryptBinary / envelopeDecryptBinary ──

  describe('envelopeEncryptBinary / envelopeDecryptBinary', () => {
    test('round-trip with single recipient', () => {
      const { secret, pubkey } = randomKeypair()
      const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

      const { encrypted, envelopes } = crypto.envelopeEncryptBinary(
        plaintext,
        [pubkey],
        LABEL_VOICEMAIL_WRAP
      )

      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pubkey).toBe(pubkey)

      const recovered = crypto.envelopeDecryptBinary(
        encrypted,
        envelopes[0],
        secret,
        LABEL_VOICEMAIL_WRAP
      )
      expect(recovered).toEqual(plaintext)
    })

    test('multiple recipients can each decrypt', () => {
      const r1 = randomKeypair()
      const r2 = randomKeypair()

      const plaintext = new Uint8Array(1024)
      globalThis.crypto.getRandomValues(plaintext)

      const { encrypted, envelopes } = crypto.envelopeEncryptBinary(
        plaintext,
        [r1.pubkey, r2.pubkey],
        LABEL_VOICEMAIL_WRAP
      )

      expect(envelopes).toHaveLength(2)

      const dec1 = crypto.envelopeDecryptBinary(
        encrypted,
        envelopes.find((e) => e.pubkey === r1.pubkey)!,
        r1.secret,
        LABEL_VOICEMAIL_WRAP
      )
      const dec2 = crypto.envelopeDecryptBinary(
        encrypted,
        envelopes.find((e) => e.pubkey === r2.pubkey)!,
        r2.secret,
        LABEL_VOICEMAIL_WRAP
      )

      expect(dec1).toEqual(plaintext)
      expect(dec2).toEqual(plaintext)
    })

    test('wrong private key fails', () => {
      const { pubkey } = randomKeypair()
      const wrong = randomKeypair()

      const plaintext = new Uint8Array([42, 43, 44])
      const { encrypted, envelopes } = crypto.envelopeEncryptBinary(
        plaintext,
        [pubkey],
        LABEL_VOICEMAIL_WRAP
      )

      expect(() =>
        crypto.envelopeDecryptBinary(encrypted, envelopes[0], wrong.secret, LABEL_VOICEMAIL_WRAP)
      ).toThrow()
    })

    test('nonce uniqueness', () => {
      const { pubkey } = randomKeypair()
      const plaintext = new Uint8Array([1, 2, 3])

      const a = crypto.envelopeEncryptBinary(plaintext, [pubkey], LABEL_VOICEMAIL_WRAP)
      const b = crypto.envelopeEncryptBinary(plaintext, [pubkey], LABEL_VOICEMAIL_WRAP)
      expect(a.encrypted).not.toBe(b.encrypted)
    })
  })

  // ── hubEncryptField / hubDecryptField ──

  describe('hubEncryptField / hubDecryptField', () => {
    test('round-trip with matching (recordId, fieldName)', () => {
      const hubKey = new Uint8Array(32)
      globalThis.crypto.getRandomValues(hubKey)

      const ct = crypto.hubEncryptField('hub data', hubKey, 'row-1', 'encrypted_name')
      const pt = crypto.hubDecryptField(ct, hubKey, 'row-1', 'encrypted_name')
      expect(pt).toBe('hub data')
    })

    test('wrong recordId returns null (AAD mismatch)', () => {
      const hubKey = new Uint8Array(32)
      globalThis.crypto.getRandomValues(hubKey)

      const ct = crypto.hubEncryptField('hub data', hubKey, 'row-1', 'encrypted_name')
      expect(crypto.hubDecryptField(ct, hubKey, 'row-2', 'encrypted_name')).toBeNull()
    })

    test('wrong fieldName returns null (AAD mismatch)', () => {
      const hubKey = new Uint8Array(32)
      globalThis.crypto.getRandomValues(hubKey)

      const ct = crypto.hubEncryptField('hub data', hubKey, 'row-1', 'encrypted_name')
      expect(crypto.hubDecryptField(ct, hubKey, 'row-1', 'encrypted_description')).toBeNull()
    })

    test('wrong key returns null', () => {
      const key1 = new Uint8Array(32)
      globalThis.crypto.getRandomValues(key1)
      const key2 = new Uint8Array(32)
      globalThis.crypto.getRandomValues(key2)

      const ct = crypto.hubEncryptField('data', key1, 'row-1', 'encrypted_name')
      expect(crypto.hubDecryptField(ct, key2, 'row-1', 'encrypted_name')).toBeNull()
    })

    test('nonce uniqueness', () => {
      const hubKey = new Uint8Array(32)
      globalThis.crypto.getRandomValues(hubKey)

      const a = crypto.hubEncryptField('same', hubKey, 'row-1', 'encrypted_name')
      const b = crypto.hubEncryptField('same', hubKey, 'row-1', 'encrypted_name')
      expect(a).not.toBe(b)
    })
  })

  // ── unwrapHubKey ──

  describe('unwrapHubKey', () => {
    test('full roundtrip — derive server pubkey, wrap hub key, unwrap recovers it', () => {
      // Generate a random server secret
      const serverSecret = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
      const svc = new CryptoService(serverSecret, TEST_HMAC_SECRET)

      // Derive the server pubkey the same way CryptoService does internally
      const serverPrivateKey = hkdfDerive(
        hexToBytes(serverSecret),
        utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
        utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
        32
      )
      const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

      // Create a hub key and wrap it for the server
      const hubKey = new Uint8Array(32)
      globalThis.crypto.getRandomValues(hubKey)
      const wrapped = eciesWrapKey(hubKey, serverPubkey, LABEL_HUB_KEY_WRAP)

      const envelopes = [
        {
          pubkey: serverPubkey,
          wrappedKey: wrapped.wrappedKey,
          ephemeralPubkey: wrapped.ephemeralPubkey,
        },
      ]

      const recovered = svc.unwrapHubKey(envelopes)
      expect(bytesToHex(recovered)).toBe(bytesToHex(hubKey))
    })

    test('wrong server secret throws — no matching envelope', () => {
      const serverSecret = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
      const wrongSecret = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))

      // Derive pubkey from the correct secret
      const serverPrivateKey = hkdfDerive(
        hexToBytes(serverSecret),
        utf8ToBytes(LABEL_SERVER_NOSTR_KEY),
        utf8ToBytes(LABEL_SERVER_NOSTR_KEY_INFO),
        32
      )
      const serverPubkey = bytesToHex(secp256k1.getPublicKey(serverPrivateKey, true).slice(1))

      const hubKey = new Uint8Array(32)
      globalThis.crypto.getRandomValues(hubKey)
      const wrapped = eciesWrapKey(hubKey, serverPubkey, LABEL_HUB_KEY_WRAP)

      const envelopes = [
        {
          pubkey: serverPubkey,
          wrappedKey: wrapped.wrappedKey,
          ephemeralPubkey: wrapped.ephemeralPubkey,
        },
      ]

      // Wrong secret derives a different pubkey, so no envelope matches
      const wrongSvc = new CryptoService(wrongSecret, TEST_HMAC_SECRET)
      expect(() => wrongSvc.unwrapHubKey(envelopes)).toThrow(
        /No hub key envelope for server pubkey/
      )
    })
  })
})

describe('CryptoService AAD binding', () => {
  test('serverEncrypt/Decrypt round-trip with AAD', () => {
    const svc = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET)
    const ct = svc.serverEncrypt('hello', LABEL_AUDIT_EVENT)
    expect(svc.serverDecrypt(ct, LABEL_AUDIT_EVENT)).toBe('hello')
  })

  test('serverDecrypt rejects wrong label (AAD mismatch)', () => {
    const svc = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET)
    const ct = svc.serverEncrypt('hello', LABEL_AUDIT_EVENT)
    expect(() => svc.serverDecrypt(ct, LABEL_USER_PII)).toThrow()
  })

  test('hubEncryptField/Decrypt round-trip with AAD', () => {
    const svc = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET)
    const hubKey = new Uint8Array(32).fill(3)
    const ct = svc.hubEncryptField('hello', hubKey, 'row-1', 'encrypted_name')
    expect(svc.hubDecryptField(ct, hubKey, 'row-1', 'encrypted_name')).toBe('hello')
  })

  test('hubDecryptField returns null on AAD mismatch', () => {
    const svc = new CryptoService(TEST_SERVER_SECRET, TEST_HMAC_SECRET)
    const hubKey = new Uint8Array(32).fill(3)
    const ct = svc.hubEncryptField('hello', hubKey, 'row-1', 'encrypted_name')
    expect(svc.hubDecryptField(ct, hubKey, 'row-1', 'encrypted_description')).toBeNull()
  })
})
