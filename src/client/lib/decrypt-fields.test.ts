import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { CryptoLabel } from '@shared/crypto-labels'
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
const {
  DecryptCache,
  decryptObjectFields,
  resetDecryptRecoveryState,
  resetMismatchFired,
  resolveEncryptedFields,
  setOnDecryptMismatch,
} = await import('./decrypt-fields')

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

describe('fieldNames filter', () => {
  beforeEach(() => {
    lockCallCount = 0
    mockDecryptEnvelopeField.mockReset()
    mockIsUnlocked.mockReset()
    mockReinitialize.mockReset()
    mockLock.mockResolvedValue(undefined)
    resetDecryptRecoveryState()
  })

  test('only decrypts the listed fields, ignoring other encrypted fields', async () => {
    mockDecryptEnvelopeField.mockResolvedValue('decrypted-value')

    // Object carries fields encrypted under TWO different labels.
    // Without a filter, decryptObjectFields would try to decrypt both.
    const obj = {
      encryptedDisplayName: 'ct-summary',
      displayNameEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: 'ccdd', wrappedKey: 'eeff' }],
      encryptedPhone: 'ct-pii',
      phoneEnvelopes: [{ pubkey: 'aabb', ephemeralPubkey: '1122', wrappedKey: '3344' }],
      displayName: '[encrypted]',
      phone: '[encrypted]',
    }

    // Pass 1: only decrypt summary fields. Phone must NOT be touched.
    await decryptObjectFields(obj, 'aabb', 'label:summary' as CryptoLabel, ['encryptedDisplayName'])
    expect(mockDecryptEnvelopeField).toHaveBeenCalledTimes(1)
    expect(mockDecryptEnvelopeField).toHaveBeenCalledWith(
      'ct-summary',
      'ccdd',
      'eeff',
      'label:summary',
      expect.any(Uint8Array)
    )
    expect(obj.displayName).toBe('decrypted-value')
    expect(obj.phone).toBe('[encrypted]') // untouched

    mockDecryptEnvelopeField.mockClear()

    // Pass 2: only decrypt PII fields. Display name must NOT be re-attempted
    // with the wrong label (which was the root cause of the recovery-lock bug).
    await decryptObjectFields(obj, 'aabb', 'label:pii' as CryptoLabel, ['encryptedPhone'])
    expect(mockDecryptEnvelopeField).toHaveBeenCalledTimes(1)
    expect(mockDecryptEnvelopeField).toHaveBeenCalledWith(
      'ct-pii',
      '1122',
      '3344',
      'label:pii',
      expect.any(Uint8Array)
    )
    expect(obj.phone).toBe('decrypted-value')
    // No lock was fired — proves we never hit the retry/recovery branch.
    expect(lockCallCount).toBe(0)
  })

  test('resolveEncryptedFields skips unlisted fields even when they exist', () => {
    const obj = {
      encryptedName: 'ct-a',
      nameEnvelopes: [{ pubkey: 'reader', ephemeralPubkey: 'ee', wrappedKey: 'ff' }],
      encryptedPhone: 'ct-b',
      phoneEnvelopes: [{ pubkey: 'reader', ephemeralPubkey: 'aa', wrappedKey: 'bb' }],
    }

    // Default (no filter): both fields returned
    const all = resolveEncryptedFields(obj, 'reader')
    expect(all.map((r) => r.plaintextKey).sort()).toEqual(['name', 'phone'])

    // With filter: only listed field returned
    const nameOnly = resolveEncryptedFields(obj, 'reader', ['encryptedName'])
    expect(nameOnly.map((r) => r.plaintextKey)).toEqual(['name'])
  })

  test('mismatch handler not fired for fields excluded by the filter', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)

    // encryptedName has no envelope for 'reader', but it's filtered out.
    // encryptedPhone has a matching envelope for 'reader' and is included.
    const obj = {
      encryptedName: 'ct-a',
      nameEnvelopes: [{ pubkey: 'someone-else', ephemeralPubkey: 'ee', wrappedKey: 'ff' }],
      encryptedPhone: 'ct-b',
      phoneEnvelopes: [{ pubkey: 'reader', ephemeralPubkey: 'aa', wrappedKey: 'bb' }],
    }

    resolveEncryptedFields(obj, 'reader', ['encryptedPhone'])
    expect(handler).not.toHaveBeenCalled()
    setOnDecryptMismatch(null)
  })
})

describe('decrypt mismatch callback', () => {
  afterEach(() => {
    setOnDecryptMismatch(null)
  })

  test('fires mismatch handler when no envelope matches reader pubkey', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)
    const obj = {
      encryptedName: 'some-ciphertext',
      nameEnvelopes: [{ pubkey: 'aaaa', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' }],
    }
    resolveEncryptedFields(obj, 'different-pubkey')
    expect(handler).toHaveBeenCalledWith({
      field: 'encryptedName',
      readerPubkey: 'different-pubkey',
      envelopePubkeys: ['aaaa'],
    })
  })

  test('does not fire when envelope matches reader pubkey', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)
    const obj = {
      encryptedName: 'some-ciphertext',
      nameEnvelopes: [{ pubkey: 'reader-key', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' }],
    }
    resolveEncryptedFields(obj, 'reader-key')
    expect(handler).not.toHaveBeenCalled()
  })

  test('does not fire when no reader pubkey provided', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)
    const obj = {
      encryptedName: 'some-ciphertext',
      nameEnvelopes: [{ pubkey: 'aaaa', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' }],
    }
    resolveEncryptedFields(obj)
    expect(handler).not.toHaveBeenCalled()
  })

  test('fires handler at most once per registration (fire-once guard)', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)

    const obj1 = {
      encryptedName: 'ct-1',
      nameEnvelopes: [{ pubkey: 'aaaa', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' }],
    }
    const obj2 = {
      encryptedPhone: 'ct-2',
      phoneEnvelopes: [{ pubkey: 'aaaa', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' }],
    }

    resolveEncryptedFields(obj1, 'different-pubkey')
    resolveEncryptedFields(obj2, 'different-pubkey')

    // Handler should fire exactly once — for the first mismatched field only
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      field: 'encryptedName',
      readerPubkey: 'different-pubkey',
      envelopePubkeys: ['aaaa'],
    })
  })

  test('resetMismatchFired re-arms the fire-once guard', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)

    const obj = {
      encryptedName: 'ct-1',
      nameEnvelopes: [{ pubkey: 'aaaa', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' }],
    }

    resolveEncryptedFields(obj, 'different-pubkey')
    expect(handler).toHaveBeenCalledTimes(1)

    // Re-arm and fire again
    resetMismatchFired()
    resolveEncryptedFields(obj, 'different-pubkey')
    expect(handler).toHaveBeenCalledTimes(2)
  })

  test('resetDecryptRecoveryState clears mismatch state', () => {
    const handler = mock(() => {})
    setOnDecryptMismatch(handler)

    const obj = {
      encryptedName: 'ct-1',
      nameEnvelopes: [{ pubkey: 'aaaa', ephemeralPubkey: 'bbbb', wrappedKey: 'cccc' }],
    }

    resolveEncryptedFields(obj, 'different-pubkey')
    expect(handler).toHaveBeenCalledTimes(1)

    // Full reset clears handler + fired flag
    resetDecryptRecoveryState()

    // Handler was cleared, so re-registering and firing should work
    const handler2 = mock(() => {})
    setOnDecryptMismatch(handler2)
    resolveEncryptedFields(obj, 'different-pubkey')
    expect(handler2).toHaveBeenCalledTimes(1)
    // Original handler should not have been called again
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
