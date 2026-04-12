import { afterEach, describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  _test_clearSecretKey,
  _test_handleSignAuditEntry,
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
