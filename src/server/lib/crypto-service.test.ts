import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  type CryptoLabel,
  HMAC_PHONE_PREFIX,
  LABEL_AUDIT_EVENT,
  LABEL_CALL_META,
  LABEL_MESSAGE,
  LABEL_USER_PII,
  LABEL_VOICEMAIL_WRAP,
} from '@shared/crypto-labels'
import { createHpkeSuite } from '@shared/crypto-suite'
import type { Ciphertext } from '@shared/crypto-types'
import { CryptoService } from './crypto-service'
import { HpkeService } from './hpke-service'

const TEST_SERVER_SECRET = '0000000000000000000000000000000000000000000000000000000000000001'
const TEST_HMAC_SECRET = '0000000000000000000000000000000000000000000000000000000000000002'

function createTestCrypto(serverSecret = TEST_SERVER_SECRET) {
  const hpke = new HpkeService(serverSecret)
  return new CryptoService(serverSecret, TEST_HMAC_SECRET, hpke)
}

describe('CryptoService', () => {
  const crypto = createTestCrypto()

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
      const crypto2 = createTestCrypto(TEST_SERVER_SECRET)
      // Override hmac secret via a new instance
      const hpke2 = new HpkeService(TEST_SERVER_SECRET)
      const crypto3 = new CryptoService(TEST_SERVER_SECRET, 'f'.repeat(64), hpke2)
      const a = crypto.hmac('+15551234567', HMAC_PHONE_PREFIX)
      const b = crypto3.hmac('+15551234567', HMAC_PHONE_PREFIX)
      expect(a).not.toBe(b)
    })
  })

  // ── envelopeEncrypt / envelopeDecrypt (HPKE) ──

  describe('envelopeEncrypt / envelopeDecrypt', () => {
    test('server can decrypt its own envelope', async () => {
      const serverPubkey = await crypto.getServerPubkey()

      const { encrypted, envelopes } = await crypto.envelopeEncrypt(
        'secret message',
        [serverPubkey],
        LABEL_USER_PII
      )

      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pubkey).toBe(serverPubkey)

      const pt = await crypto.envelopeDecrypt(encrypted, envelopes[0], LABEL_USER_PII)
      expect(pt).toBe('secret message')
    })

    test('multiple recipients — only server envelope created (user X25519 keys not yet supported)', async () => {
      const serverPubkey = await crypto.getServerPubkey()
      // Extra recipient pubkeys are accepted but not sealed for
      const { envelopes } = await crypto.envelopeEncrypt(
        'shared secret',
        [serverPubkey, 'aabbccdd'.repeat(8)],
        LABEL_USER_PII
      )

      // Only the server's own envelope is created
      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pubkey).toBe(serverPubkey)

      // Server can decrypt its own envelope
      const pt = await crypto.envelopeDecrypt('' as Ciphertext, envelopes[0], LABEL_USER_PII)
      expect(pt).toBe('shared secret')
    })

    test('wrong label fails — domain separation', async () => {
      const serverPubkey = await crypto.getServerPubkey()

      const { encrypted, envelopes } = await crypto.envelopeEncrypt(
        'test message',
        [serverPubkey],
        LABEL_MESSAGE
      )

      await expect(
        crypto.envelopeDecrypt(encrypted, envelopes[0], LABEL_CALL_META)
      ).rejects.toThrow()
    })

    test('nonce uniqueness — same plaintext produces different envelopes', async () => {
      const a = await crypto.envelopeEncrypt('same text', [], LABEL_USER_PII)
      const b = await crypto.envelopeEncrypt('same text', [], LABEL_USER_PII)
      // Encrypted field is empty (HPKE direct seal), but envelopes differ due to ephemeral keys
      expect(a.envelopes[0].ct).not.toBe(b.envelopes[0].ct)
    })
  })

  // ── envelopeEncryptBinary / envelopeDecryptBinary ──

  describe('envelopeEncryptBinary / envelopeDecryptBinary', () => {
    test('round-trip with server key', async () => {
      const serverPubkey = await crypto.getServerPubkey()
      const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

      const { encrypted, envelopes } = await crypto.envelopeEncryptBinary(
        plaintext,
        [serverPubkey],
        LABEL_VOICEMAIL_WRAP
      )

      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pubkey).toBe(serverPubkey)

      const recovered = await crypto.envelopeDecryptBinary(
        encrypted,
        envelopes[0],
        LABEL_VOICEMAIL_WRAP
      )
      expect(recovered).toEqual(plaintext)
    })

    test('multiple recipients — only server envelope created', async () => {
      const serverPubkey = await crypto.getServerPubkey()
      const plaintext = new Uint8Array(1024)
      globalThis.crypto.getRandomValues(plaintext)

      const { encrypted, envelopes } = await crypto.envelopeEncryptBinary(
        plaintext,
        ['aabbccdd'.repeat(8)],
        LABEL_VOICEMAIL_WRAP
      )

      // Only server envelope created (user X25519 keys not yet supported)
      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pubkey).toBe(serverPubkey)

      const recovered = await crypto.envelopeDecryptBinary(
        encrypted,
        envelopes[0],
        LABEL_VOICEMAIL_WRAP
      )
      expect(recovered).toEqual(plaintext)
    })

    test('nonce uniqueness', async () => {
      const serverPubkey = await crypto.getServerPubkey()
      const plaintext = new Uint8Array([1, 2, 3])

      const a = await crypto.envelopeEncryptBinary(plaintext, [serverPubkey], LABEL_VOICEMAIL_WRAP)
      const b = await crypto.envelopeEncryptBinary(plaintext, [serverPubkey], LABEL_VOICEMAIL_WRAP)
      expect(a.encrypted).not.toBe(b.encrypted)
    })
  })

  // ── hubEncryptField / hubDecryptField ��─

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

  // ── Hub key wrapping via HpkeService ──

  describe('hub key wrap/unwrap via HpkeService', () => {
    test('full roundtrip — generateAndWrapHubKey, unwrapHubKey recovers it', async () => {
      const hpke = crypto.hpke
      const { hubKey, envelopes } = await hpke.generateAndWrapHubKey([])
      // Server is always included as a member
      expect(envelopes.length).toBeGreaterThanOrEqual(1)

      const recovered = await hpke.unwrapHubKey(envelopes)
      expect(bytesToHex(recovered)).toBe(bytesToHex(hubKey))
    })

    test('wrong server secret throws — no matching envelope', async () => {
      const serverSecret = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
      const wrongSecret = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))

      const hpke = new HpkeService(serverSecret)
      const { envelopes } = await hpke.generateAndWrapHubKey([])

      const wrongHpke = new HpkeService(wrongSecret)
      await expect(wrongHpke.unwrapHubKey(envelopes)).rejects.toThrow(
        /No hub-key-wrap envelope for server pubkey/
      )
    })
  })
})

describe('CryptoService AAD binding', () => {
  const crypto = createTestCrypto()

  test('serverEncrypt/Decrypt round-trip with AAD', () => {
    const ct = crypto.serverEncrypt('hello', LABEL_AUDIT_EVENT)
    expect(crypto.serverDecrypt(ct, LABEL_AUDIT_EVENT)).toBe('hello')
  })

  test('serverDecrypt rejects wrong label (AAD mismatch)', () => {
    const ct = crypto.serverEncrypt('hello', LABEL_AUDIT_EVENT)
    expect(() => crypto.serverDecrypt(ct, LABEL_USER_PII)).toThrow()
  })

  test('hubEncryptField/Decrypt round-trip with AAD', () => {
    const hubKey = new Uint8Array(32).fill(3)
    const ct = crypto.hubEncryptField('hello', hubKey, 'row-1', 'encrypted_name')
    expect(crypto.hubDecryptField(ct, hubKey, 'row-1', 'encrypted_name')).toBe('hello')
  })

  test('hubDecryptField returns null on AAD mismatch', () => {
    const hubKey = new Uint8Array(32).fill(3)
    const ct = crypto.hubEncryptField('hello', hubKey, 'row-1', 'encrypted_name')
    expect(crypto.hubDecryptField(ct, hubKey, 'row-1', 'encrypted_description')).toBeNull()
  })
})
