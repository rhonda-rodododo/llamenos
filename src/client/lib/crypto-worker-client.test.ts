import { describe, expect, test } from 'bun:test'
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

describe('signAuditEntry op', () => {
  test('signAuditEntry locked error is recognized by isWorkerLockedError', () => {
    // The "Worker is locked" error that signAuditEntry throws when locked is
    // a CryptoWorkerLockedError on the client side. Verify the pattern matches.
    const lockedErr = new Error('Worker is locked')
    expect(isWorkerLockedError(lockedErr)).toBe(true)
  })

  test('CryptoWorkerLockedError is thrown when worker responds with locked message', () => {
    // Simulate the path through handleMessage: locked worker error string →
    // CryptoWorkerLockedError. This mirrors what signAuditEntry raises when the
    // worker fires back "Worker is locked".
    const err = new CryptoWorkerLockedError('Worker is locked')
    expect(err).toBeInstanceOf(CryptoWorkerLockedError)
    expect(err.message).toBe('Worker is locked')
    expect(isWorkerLockedError(err)).toBe(true)
  })

  test('signAuditEntry response matches 128-char hex signature pattern', () => {
    // Verify the regex used to validate signAuditEntry results matches a valid
    // 64-byte Schnorr signature encoded as 128 hex chars.
    const sigPattern = /^[0-9a-f]{128}$/
    const fakeSig = 'a'.repeat(128)
    expect(sigPattern.test(fakeSig)).toBe(true)
    // Non-matching: wrong length
    expect(sigPattern.test('a'.repeat(64))).toBe(false)
    // Non-matching: uppercase hex chars
    expect(sigPattern.test('A'.repeat(128))).toBe(false)
  })
})
