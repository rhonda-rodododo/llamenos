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
