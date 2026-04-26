import { describe, expect, test } from 'bun:test'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { decryptDraft, encryptDraft, encryptExport } from '@shared/crypto-envelopes'
import { HKDF_CONTEXT_EXPORT, HKDF_SALT, LABEL_CALL_META } from '@shared/crypto-labels'
import { generateKeyPair, isValidNsec, keyPairFromNsec } from '@shared/crypto-primitives'

describe('generateKeyPair', () => {
  test('secretKey is 32 bytes (Uint8Array)', () => {
    const kp = generateKeyPair()
    expect(kp.secretKey).toBeInstanceOf(Uint8Array)
    expect(kp.secretKey.length).toBe(32)
  })

  test('publicKey is 64 hex chars (x-only)', () => {
    const kp = generateKeyPair()
    expect(typeof kp.publicKey).toBe('string')
    expect(kp.publicKey.length).toBe(64)
    expect(/^[0-9a-f]{64}$/.test(kp.publicKey)).toBe(true)
  })

  test('nsec starts with "nsec1", npub starts with "npub1"', () => {
    const kp = generateKeyPair()
    expect(kp.nsec.startsWith('nsec1')).toBe(true)
    expect(kp.npub.startsWith('npub1')).toBe(true)
  })

  test('each call produces different keys', () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    expect(kp1.publicKey).not.toBe(kp2.publicKey)
    expect(bytesToHex(kp1.secretKey)).not.toBe(bytesToHex(kp2.secretKey))
    expect(kp1.nsec).not.toBe(kp2.nsec)
  })
})

describe('keyPairFromNsec / isValidNsec', () => {
  test('roundtrip: generateKeyPair → nsec → keyPairFromNsec recovers same pubkey and secretKey', () => {
    const original = generateKeyPair()
    const recovered = keyPairFromNsec(original.nsec)
    expect(recovered).not.toBeNull()
    expect(recovered!.publicKey).toBe(original.publicKey)
    expect(bytesToHex(recovered!.secretKey)).toBe(bytesToHex(original.secretKey))
    expect(recovered!.nsec).toBe(original.nsec)
  })

  test('invalid nsec returns null for garbage input', () => {
    expect(keyPairFromNsec('notvalid')).toBeNull()
  })

  test('invalid nsec returns null for empty string', () => {
    expect(keyPairFromNsec('')).toBeNull()
  })

  test('invalid nsec returns null for npub (wrong type)', () => {
    const kp = generateKeyPair()
    expect(keyPairFromNsec(kp.npub)).toBeNull()
  })

  test('isValidNsec: true for valid nsec', () => {
    const kp = generateKeyPair()
    expect(isValidNsec(kp.nsec)).toBe(true)
  })

  test('isValidNsec: false for garbage', () => {
    expect(isValidNsec('garbage')).toBe(false)
  })

  test('isValidNsec: false for empty string', () => {
    expect(isValidNsec('')).toBe(false)
  })

  test('isValidNsec: false for npub', () => {
    const kp = generateKeyPair()
    expect(isValidNsec(kp.npub)).toBe(false)
  })
})

// ── ECIES wrap/unwrap tests removed — HPKE is now the only key-wrapping primitive ──

// ── Note and message ECIES envelope tests removed — both paths now use MLS ──

// ── decryptCallRecord — cross-boundary interop ──

describe('decryptCallRecord — cross-boundary interop', () => {
  const callMeta = { answeredBy: 'vol_abc123', callerNumber: '+15551234567' }

  // Server-side envelope encrypt now uses HPKE. Test round-trip via server's own decrypt.
  async function encryptCallRecord(metadata: Record<string, unknown>, adminPubkeys: string[]) {
    const { CryptoService } = require('../../server/lib/crypto-service')
    const { HpkeService } = require('../../server/lib/hpke-service')
    const hpke = new HpkeService('a'.repeat(64))
    const svc = new CryptoService('a'.repeat(64), 'b'.repeat(64), hpke)
    const serverPubkey = await svc.getServerPubkey()
    const { encrypted, envelopes } = await svc.envelopeEncrypt(
      JSON.stringify(metadata),
      [serverPubkey, ...adminPubkeys],
      LABEL_CALL_META
    )
    return { svc, encryptedContent: encrypted, adminEnvelopes: envelopes, serverPubkey }
  }

  test('roundtrip: server envelopeEncrypt → server envelopeDecrypt', async () => {
    const { svc, encryptedContent, adminEnvelopes, serverPubkey } = await encryptCallRecord(
      callMeta,
      []
    )

    const serverEnv = adminEnvelopes.find((e: { pubkey: string }) => e.pubkey === serverPubkey)!
    const decrypted = JSON.parse(
      await svc.envelopeDecrypt(encryptedContent, serverEnv, LABEL_CALL_META)
    )
    expect(decrypted).toEqual(callMeta)
  })

  test('non-member pubkey has no envelope', async () => {
    const nonMember = generateKeyPair()

    const { adminEnvelopes } = await encryptCallRecord(callMeta, [])
    const result = adminEnvelopes.find((e: { pubkey: string }) => e.pubkey === nonMember.publicKey)

    expect(result).toBeUndefined()
  })
})

// ── decryptTranscription (manual ECIES/XChaCha20) tests removed — transcription now uses HPKE ──

// ── A5: encryptDraft / decryptDraft ──

describe('encryptDraft / decryptDraft', () => {
  const draftText = 'Draft note in progress — caller is describing situation...'

  test('roundtrip: encrypt → decrypt recovers original text', async () => {
    const kp = generateKeyPair()

    const encrypted = await encryptDraft(draftText, kp.secretKey)
    const decrypted = await decryptDraft(encrypted, kp.secretKey)

    expect(decrypted).toBe(draftText)
  })

  test('wrong key returns null', async () => {
    const kp = generateKeyPair()
    const wrongKey = generateKeyPair()

    const encrypted = await encryptDraft(draftText, kp.secretKey)
    const result = await decryptDraft(encrypted, wrongKey.secretKey)

    expect(result).toBeNull()
  })

  test('nonce uniqueness: two encryptions of same text differ', async () => {
    const kp = generateKeyPair()

    const enc1 = await encryptDraft(draftText, kp.secretKey)
    const enc2 = await encryptDraft(draftText, kp.secretKey)

    expect(enc1).not.toBe(enc2)
  })
})

// ── A6: encryptExport ──

describe('encryptExport', () => {
  const exportJson = JSON.stringify({ notes: [{ text: 'Note 1' }], exportedAt: '2026-03-26' })

  test('returns Uint8Array', async () => {
    const kp = generateKeyPair()
    const result = await encryptExport(exportJson, kp.secretKey)

    expect(result).toBeInstanceOf(Uint8Array)
    // nonce(12) + ciphertext(json.length + 16 AES-GCM tag)
    expect(result.length).toBeGreaterThan(12)
  })

  test('manual decrypt roundtrip: derive key with HKDF then AES-GCM decrypt', async () => {
    const kp = generateKeyPair()
    const packed = await encryptExport(exportJson, kp.secretKey)

    // Derive the same key the function uses
    const salt = utf8ToBytes(HKDF_SALT)
    const key = hkdf(sha256, kp.secretKey, salt, utf8ToBytes(HKDF_CONTEXT_EXPORT), 32)

    // AES-GCM: 12-byte nonce, then ciphertext+tag
    const nonce = packed.slice(0, 12)
    const ciphertext = packed.slice(12)
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt'])
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      cryptoKey,
      ciphertext
    )

    expect(new TextDecoder().decode(pt)).toBe(exportJson)
  })

  test('wrong key fails to decrypt', async () => {
    const kp = generateKeyPair()
    const wrongKey = generateKeyPair()
    const packed = await encryptExport(exportJson, kp.secretKey)

    const salt = utf8ToBytes(HKDF_SALT)
    const key = hkdf(sha256, wrongKey.secretKey, salt, utf8ToBytes(HKDF_CONTEXT_EXPORT), 32)

    const nonce = packed.slice(0, 12)
    const ciphertext = packed.slice(12)
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt'])

    expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cryptoKey, ciphertext)
    ).rejects.toThrow()
  })
})
