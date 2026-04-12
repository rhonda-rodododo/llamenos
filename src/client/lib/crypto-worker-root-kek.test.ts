import { afterEach, describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  _test_handleRootKekClear,
  _test_handleRootKekCreate,
  _test_handleRootKekIsLoaded,
  _test_handleRootKekUnwrap,
  _test_handleRootKekWrap,
} from './crypto-worker'

function randomHex(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

afterEach(() => {
  _test_handleRootKekClear()
})

describe('crypto-worker root-KEK handlers', () => {
  test('isLoaded is false before create and true after', async () => {
    expect(_test_handleRootKekIsLoaded()).toBe(false)
    await _test_handleRootKekCreate()
    expect(_test_handleRootKekIsLoaded()).toBe(true)
    _test_handleRootKekClear()
    expect(_test_handleRootKekIsLoaded()).toBe(false)
  })

  test('wrap → clear → unwrap produces a working handle (round trip)', async () => {
    const factor = randomHex(32)
    const salt = randomHex(64)

    await _test_handleRootKekCreate()
    const wrapped = await _test_handleRootKekWrap(factor, salt)
    expect(typeof wrapped).toBe('string')
    expect(wrapped.length).toBeGreaterThan(0)

    // Re-wrapping with the same factor+salt produces identical bytes because
    // AES-KW is deterministic on the same key + plaintext — this confirms
    // the same root KEK is still loaded.
    const wrappedAgain = await _test_handleRootKekWrap(factor, salt)
    expect(wrappedAgain).toBe(wrapped)

    _test_handleRootKekClear()
    expect(_test_handleRootKekIsLoaded()).toBe(false)

    await _test_handleRootKekUnwrap(factor, salt, wrapped)
    expect(_test_handleRootKekIsLoaded()).toBe(true)

    // After unwrap, re-wrapping with the same factor must produce the same
    // ciphertext — proving the round-tripped key is the original root KEK.
    const wrappedAfterUnwrap = await _test_handleRootKekWrap(factor, salt)
    expect(wrappedAfterUnwrap).toBe(wrapped)
  })

  test('different factors produce different wrapped blobs of the same KEK', async () => {
    await _test_handleRootKekCreate()
    const salt = randomHex(64)
    const wrappedA = await _test_handleRootKekWrap(randomHex(32), salt)
    const wrappedB = await _test_handleRootKekWrap(randomHex(32), salt)
    expect(wrappedA).not.toBe(wrappedB)
  })

  test('unwrap with wrong factor bytes fails', async () => {
    await _test_handleRootKekCreate()
    const factor = randomHex(32)
    const salt = randomHex(64)
    const wrapped = await _test_handleRootKekWrap(factor, salt)

    _test_handleRootKekClear()
    const wrongFactor = randomHex(32)
    await expect(_test_handleRootKekUnwrap(wrongFactor, salt, wrapped)).rejects.toThrow()
    // Unwrap failure must not leave a rootKek loaded. The current
    // implementation assigns only on success, so isLoaded stays false.
    expect(_test_handleRootKekIsLoaded()).toBe(false)
  })

  test('wrap throws when no root KEK is loaded', async () => {
    _test_handleRootKekClear()
    await expect(_test_handleRootKekWrap(randomHex(32), randomHex(64))).rejects.toThrow(
      'root KEK not loaded'
    )
  })
})
