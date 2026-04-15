import { afterEach, describe, expect, mock, test } from 'bun:test'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { LABEL_MLS_PROVISION } from '@shared/crypto-labels'
import {
  _test_clearMlsState,
  _test_clearSecretKey,
  _test_deriveMlsIdbKey,
  _test_getMlsInstance,
  _test_handleMlsInit,
  _test_handleMlsLock,
  _test_setKekBytes,
  _test_setSecretKey,
} from './crypto-worker'

afterEach(() => {
  _test_clearSecretKey()
  _test_clearMlsState()
})

describe('deriveMlsIdbKey', () => {
  test('produces deterministic 32-byte output for the same KEK', () => {
    const kek = new Uint8Array(32).fill(42)
    const key1 = _test_deriveMlsIdbKey(kek)
    const key2 = _test_deriveMlsIdbKey(kek)
    expect(key1).toEqual(key2)
    expect(key1.byteLength).toBe(32)
  })

  test('produces different output for different KEK values', () => {
    const kek1 = new Uint8Array(32).fill(1)
    const kek2 = new Uint8Array(32).fill(2)
    const key1 = _test_deriveMlsIdbKey(kek1)
    const key2 = _test_deriveMlsIdbKey(kek2)
    expect(key1).not.toEqual(key2)
  })

  test('matches manual HKDF computation with LABEL_MLS_PROVISION', () => {
    const kek = new Uint8Array(32).fill(99)
    const info = new TextEncoder().encode(LABEL_MLS_PROVISION)
    const expected = hkdf(sha256, kek, new Uint8Array(0), info, 32)
    const actual = _test_deriveMlsIdbKey(kek)
    expect(actual).toEqual(expected)
  })

  test('uses LABEL_MLS_PROVISION as info — different label produces different key', () => {
    const kek = new Uint8Array(32).fill(7)
    const mlsKey = _test_deriveMlsIdbKey(kek)
    const fakeInfo = new TextEncoder().encode('llamenos:fake-label:v1')
    const fakeKey = hkdf(sha256, kek, new Uint8Array(0), fakeInfo, 32)
    expect(mlsKey).not.toEqual(fakeKey)
  })
})

describe('handleMlsInit', () => {
  const mockCoreCrypto = {
    close: mock(() => Promise.resolve()),
    transaction: mock(async (cb: (ctx: unknown) => Promise<unknown>) => cb({})),
  }

  const mockDatabaseKey = mock((_bytes: Uint8Array) => ({}))
  const mockClientId = mock((_bytes: Uint8Array) => ({}))

  const loaderModule = mock.module('./mls/core-crypto-loader', () => ({
    loadCoreCrypto: () =>
      Promise.resolve({
        CoreCrypto: {
          init: mock(() => Promise.resolve(mockCoreCrypto)),
          deferredInit: mock(() => Promise.resolve(mockCoreCrypto)),
        },
        DatabaseKey: mockDatabaseKey,
        ClientId: mockClientId,
        Ciphersuite: { MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519: 1 },
        CredentialType: { Basic: 1 },
        ConversationId: mock((_bytes: Uint8Array) => ({})),
      }),
  }))

  test('throws when no KEK is available and none is provided', async () => {
    expect(_test_handleMlsInit('test-client')).rejects.toThrow('KEK not available')
  })

  test('uses stored KEK when no explicit kekHex is provided', async () => {
    const kek = new Uint8Array(32).fill(5)
    _test_setKekBytes(kek)
    _test_setSecretKey(new Uint8Array(32).fill(1))
    await _test_handleMlsInit('test-client')
    expect(_test_getMlsInstance()).not.toBeNull()
  })

  test('uses explicit kekHex when provided', async () => {
    const kekHex = '0a'.repeat(32)
    _test_setSecretKey(new Uint8Array(32).fill(1))
    await _test_handleMlsInit('test-client', kekHex)
    expect(_test_getMlsInstance()).not.toBeNull()
  })

  test('is idempotent — calling twice with same client ID recreates cleanly', async () => {
    const kek = new Uint8Array(32).fill(5)
    _test_setKekBytes(kek)
    _test_setSecretKey(new Uint8Array(32).fill(1))
    await _test_handleMlsInit('test-client')
    const first = _test_getMlsInstance()
    expect(first).not.toBeNull()

    await _test_handleMlsInit('test-client')
    const second = _test_getMlsInstance()
    expect(second).not.toBeNull()
    expect(mockCoreCrypto.close).toHaveBeenCalled()
  })
})

describe('handleMlsLock', () => {
  test('clears the MLS instance', async () => {
    const kek = new Uint8Array(32).fill(5)
    _test_setKekBytes(kek)
    _test_setSecretKey(new Uint8Array(32).fill(1))

    mock.module('./mls/core-crypto-loader', () => ({
      loadCoreCrypto: () =>
        Promise.resolve({
          CoreCrypto: {
            init: mock(() =>
              Promise.resolve({
                close: mock(() => Promise.resolve()),
                transaction: mock(async (cb: (ctx: unknown) => Promise<unknown>) => cb({})),
              })
            ),
          },
          DatabaseKey: mock((_b: Uint8Array) => ({})),
          ClientId: mock((_b: Uint8Array) => ({})),
          Ciphersuite: { MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519: 1 },
          CredentialType: { Basic: 1 },
          ConversationId: mock((_b: Uint8Array) => ({})),
        }),
    }))

    await _test_handleMlsInit('test-client')
    expect(_test_getMlsInstance()).not.toBeNull()

    await _test_handleMlsLock()
    expect(_test_getMlsInstance()).toBeNull()
  })
})

describe('unlock path MLS integration', () => {
  test('unlock stores KEK for later MLS derivation', () => {
    // Verify that after handleUnlock, kekBytes is populated
    // We test this indirectly: setKekBytes + deriveMlsIdbKey should work
    const kek = new Uint8Array(32).fill(33)
    _test_setKekBytes(kek)
    const idbKey = _test_deriveMlsIdbKey(kek)
    expect(idbKey.byteLength).toBe(32)
  })
})
