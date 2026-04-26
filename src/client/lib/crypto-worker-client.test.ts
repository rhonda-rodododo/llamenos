import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { LABEL_NOTE_KEY, labelToId } from '@shared/crypto-labels'
import { createHpkeSuite } from '@shared/crypto-suite'
import {
  type AesGcmKey,
  asAesGcmKey,
  asX25519EncryptionKey,
  type X25519EncryptionKey,
} from '@shared/types'
import {
  _test_clearHpkeState,
  _test_clearSecretKey,
  _test_handleHpkeOpen,
  _test_handleHpkeSeal,
  _test_handleSignAuditEntry,
  _test_handleUnlockWithHandles,
  _test_setSecretKey,
} from './crypto-worker'
import { CryptoWorkerLockedError, isWorkerLockedError } from './crypto-worker-client'

describe('CryptoWorkerLockedError', () => {
  test('isWorkerLockedError matches "Not unlocked" error', () => {
    expect(isWorkerLockedError(new Error('Not unlocked'))).toBe(true)
  })

  test('isWorkerLockedError matches "Worker is locked" error', () => {
    expect(isWorkerLockedError(new Error('Worker is locked'))).toBe(true)
  })

  test('isWorkerLockedError matches rate limit auto-lock error', () => {
    expect(isWorkerLockedError(new Error('Rate limit exceeded — worker auto-locked'))).toBe(true)
  })

  test('isWorkerLockedError returns false for timeout error', () => {
    expect(isWorkerLockedError(new Error('Crypto worker request timed out'))).toBe(false)
  })

  test('isWorkerLockedError returns false for generic error', () => {
    expect(isWorkerLockedError(new Error('Something else went wrong'))).toBe(false)
  })

  test('CryptoWorkerLockedError has correct name', () => {
    const err = new CryptoWorkerLockedError('Not unlocked')
    expect(err.name).toBe('CryptoWorkerLockedError')
    expect(err.message).toBe('Not unlocked')
  })
})

describe('handleSignAuditEntry', () => {
  afterEach(() => _test_clearSecretKey())

  test('signs an audit entry hash and produces a cryptographically valid Schnorr signature', () => {
    // Use a deterministic key so we can verify against a known pubkey
    const testKey = new Uint8Array(32).fill(7)
    _test_setSecretKey(testKey)

    const entryHash = new Uint8Array(32).fill(0xab)
    const entryHashHex = bytesToHex(entryHash)

    const sigHex = _test_handleSignAuditEntry(entryHashHex)

    // Shape check: 64-byte Schnorr signature = 128 lowercase hex chars
    expect(sigHex).toMatch(/^[0-9a-f]{128}$/)

    // Cryptographic validity: verify against the public key derived from testKey
    const pubkey = schnorr.getPublicKey(testKey)
    const sig = hexToBytes(sigHex)
    expect(schnorr.verify(sig, entryHash, pubkey)).toBe(true)
  })

  test('throws "Worker is locked" when secretKey is null', () => {
    _test_clearSecretKey()
    expect(() => _test_handleSignAuditEntry('deadbeef'.repeat(8))).toThrow('Worker is locked')
  })

  test('locked error is recognized as a CryptoWorkerLockedError pattern', () => {
    // Confirm the error message thrown by the handler matches the client-side detection pattern
    _test_clearSecretKey()
    let caught: Error | undefined
    try {
      _test_handleSignAuditEntry('deadbeef'.repeat(8))
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeDefined()
    expect(isWorkerLockedError(caught as Error)).toBe(true)
  })
})

// ---- Tier 1 HPKE sidecar handler tests ----

async function seedWorkerWithHpkeKeys(): Promise<{
  recipientPub: Uint8Array
  pubkeyHex: string
}> {
  // 1. Generate an HPKE identity keypair and import the private key so the
  //    worker holds a real CryptoKey for opening envelopes.
  const suite = createHpkeSuite()
  const kp = (await suite.kem.generateKeyPair()) as CryptoKeyPair
  const priv = asX25519EncryptionKey(kp.privateKey)
  const recipientPub = new Uint8Array(await suite.kem.serializePublicKey(kp.publicKey))

  // 2. Generate a fresh hub AES-GCM CryptoKey.
  const hub = asAesGcmKey(
    await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  )

  // 3. Hand an nsec into the worker alongside the HPKE + hub handles.
  const nsec = new Uint8Array(32).fill(9)
  const pubkeyHex = await _test_handleUnlockWithHandles(new Uint8Array(nsec), priv, hub)
  return { recipientPub, pubkeyHex }
}

describe('Tier 1 HPKE sidecar — unlockWithHandles', () => {
  afterEach(() => {
    _test_clearSecretKey()
    _test_clearHpkeState()
  })

  test('populates secretKey + HPKE handles + returns schnorr pubkey hex', async () => {
    const { pubkeyHex } = await seedWorkerWithHpkeKeys()
    expect(pubkeyHex).toMatch(/^[0-9a-f]{64}$/)
    // Proves the signAuditEntry path still works after v3 unlock.
    const entryHash = bytesToHex(new Uint8Array(32).fill(0x11))
    const sig = _test_handleSignAuditEntry(entryHash)
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
    const sigBytes = hexToBytes(sig)
    expect(schnorr.verify(sigBytes, hexToBytes(entryHash), hexToBytes(pubkeyHex))).toBe(true)
  })

  test('rejects nsec that is not 32 bytes', () => {
    const wrongLen = new Uint8Array(16)
    // Intentionally pass unknown-typed CryptoKey stubs — the length check
    // runs first so we never touch the HPKE/hub handles.
    expect(() =>
      _test_handleUnlockWithHandles(
        wrongLen,
        {} as unknown as X25519EncryptionKey,
        {} as unknown as AesGcmKey
      )
    ).toThrow(/32 bytes/)
  })
})

describe('Tier 1 HPKE sidecar — hpkeSeal / hpkeOpen round-trip', () => {
  beforeEach(async () => {
    await seedWorkerWithHpkeKeys()
  })

  afterEach(() => {
    _test_clearSecretKey()
    _test_clearHpkeState()
  })

  test('seal then open returns the original plaintext', async () => {
    const { recipientPub } = await seedWorkerWithHpkeKeys()
    const envelope = await _test_handleHpkeSeal(
      'secret-message',
      recipientPub,
      LABEL_NOTE_KEY,
      'note-123',
      'content'
    )
    expect(envelope.v).toBe(3)
    expect(typeof envelope.enc).toBe('string')
    expect(typeof envelope.ct).toBe('string')
    expect(envelope.labelId).toBe(labelToId(LABEL_NOTE_KEY))

    const pt = await _test_handleHpkeOpen(envelope, LABEL_NOTE_KEY, 'note-123', 'content')
    expect(pt).toBe('secret-message')
  })

  test('open with wrong recordId fails AAD binding', async () => {
    const { recipientPub } = await seedWorkerWithHpkeKeys()
    const envelope = await _test_handleHpkeSeal(
      'bound',
      recipientPub,
      LABEL_NOTE_KEY,
      'record-A',
      'field-1'
    )
    await expect(
      _test_handleHpkeOpen(envelope, LABEL_NOTE_KEY, 'record-B', 'field-1')
    ).rejects.toThrow()
  })

  test('hpkeSeal refuses when worker is locked', async () => {
    _test_clearSecretKey()
    _test_clearHpkeState()
    await expect(
      _test_handleHpkeSeal('x', new Uint8Array(32), LABEL_NOTE_KEY, 'r', 'f')
    ).rejects.toThrow('Worker is locked')
  })

  test('hpkeOpen refuses when worker is locked', async () => {
    _test_clearSecretKey()
    _test_clearHpkeState()
    const fakeEnv = { v: 3 as const, labelId: labelToId(LABEL_NOTE_KEY), enc: '', ct: '' }
    await expect(_test_handleHpkeOpen(fakeEnv, LABEL_NOTE_KEY, 'r', 'f')).rejects.toThrow(
      'Worker is locked'
    )
  })
})
