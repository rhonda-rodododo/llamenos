import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { CryptoWorkerLockedError } from './crypto-worker-client'

// We need to mock the crypto-worker-client module and key-manager module
// before importing decrypt-fields
const mockDecryptEnvelopeField =
  mock<
    (
      encryptedHex: string,
      ephemeralPubkeyHex: string,
      wrappedKeyHex: string,
      label: string
    ) => Promise<string>
  >()
const mockIsUnlocked = mock<() => Promise<boolean>>()
const mockReinitialize = mock<() => void>()
const mockLock = mock<() => Promise<void>>()

// Track if lock was called
let lockCallCount = 0

mock.module('./crypto-worker-client', () => ({
  cryptoWorker: {
    decryptEnvelopeField: mockDecryptEnvelopeField,
    isUnlocked: mockIsUnlocked,
    reinitialize: mockReinitialize,
  },
  CryptoWorkerLockedError,
  isWorkerLockedError: (err: unknown) => err instanceof CryptoWorkerLockedError,
}))

mock.module('./key-manager', () => ({
  lock: () => {
    lockCallCount++
    return mockLock()
  },
}))

// Import AFTER mocking
const { DecryptCache, decryptObjectFields, resetDecryptRecoveryState } = await import(
  './decrypt-fields'
)

describe('decrypt recovery', () => {
  beforeEach(() => {
    lockCallCount = 0
    mockDecryptEnvelopeField.mockReset()
    mockIsUnlocked.mockReset()
    mockReinitialize.mockReset()
    mockLock.mockResolvedValue(undefined)
    resetDecryptRecoveryState()
  })

  test('successful decrypt does not trigger lock', async () => {
    mockDecryptEnvelopeField.mockResolvedValue('Alice')
    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(obj.name).toBe('Alice')
    expect(lockCallCount).toBe(0)
  })

  test('retries once on timeout then locks when worker reports locked', async () => {
    mockDecryptEnvelopeField
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
    mockIsUnlocked.mockResolvedValue(false)

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(obj.name).toBe('[encrypted]')
    expect(lockCallCount).toBe(1)
  })

  test('retries once on timeout and succeeds on retry', async () => {
    mockDecryptEnvelopeField
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
      .mockResolvedValueOnce('Alice')

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(obj.name).toBe('Alice')
    expect(lockCallCount).toBe(0)
  })

  test('CryptoWorkerLockedError triggers lock immediately without retry', async () => {
    mockDecryptEnvelopeField.mockRejectedValue(new CryptoWorkerLockedError('Not unlocked'))

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(obj.name).toBe('[encrypted]')
    expect(lockCallCount).toBe(1)
  })

  test('worker unlocked but broken triggers reinitialize + lock', async () => {
    mockDecryptEnvelopeField
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
      .mockRejectedValueOnce(new Error('Crypto worker request timed out'))
    mockIsUnlocked.mockResolvedValue(true) // unlocked but still failing

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      name: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(mockReinitialize).toHaveBeenCalledTimes(1)
    expect(lockCallCount).toBe(1)
  })

  test('lock fires only once for multiple concurrent decrypt failures', async () => {
    mockDecryptEnvelopeField.mockRejectedValue(new CryptoWorkerLockedError('Not unlocked'))

    const obj = {
      encryptedName: 'cafebabe',
      nameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      encryptedPhone: 'deadbeef',
      phoneEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: '1122', wrappedKey: '3344' }],
      name: '[encrypted]',
      phone: '[encrypted]',
    }
    await decryptObjectFields(obj, 'aabb')
    expect(lockCallCount).toBe(1)
  })
})

describe('DecryptCache', () => {
  test('get returns null for missing entry', () => {
    const cache = new DecryptCache()
    expect(cache.get('foo', 'bar')).toBeNull()
  })

  test('set and get round-trips', () => {
    const cache = new DecryptCache()
    cache.set('ct', 'label', 'plaintext')
    expect(cache.get('ct', 'label')).toBe('plaintext')
  })

  test('clear empties the cache', () => {
    const cache = new DecryptCache()
    cache.set('ct', 'label', 'plaintext')
    cache.clear()
    expect(cache.get('ct', 'label')).toBeNull()
    expect(cache.size).toBe(0)
  })
})
