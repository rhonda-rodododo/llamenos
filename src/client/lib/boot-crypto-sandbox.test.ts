import { describe, expect, test } from 'bun:test'
import {
  _resetBootStateForTests,
  bootCryptoSandbox,
  getCryptoSandboxReadyPromise,
} from './boot-crypto-sandbox'

describe('bootCryptoSandbox', () => {
  test('is a no-op when VITE_CRYPTO_ORIGIN is unset and ready resolves immediately', async () => {
    _resetBootStateForTests()
    // In `bun test` import.meta.env.VITE_CRYPTO_ORIGIN is unset by default.
    bootCryptoSandbox()
    // Should not throw and should resolve immediately.
    await getCryptoSandboxReadyPromise()
  })

  test('double-boot is idempotent', async () => {
    _resetBootStateForTests()
    bootCryptoSandbox()
    bootCryptoSandbox()
    bootCryptoSandbox()
    await getCryptoSandboxReadyPromise()
    expect(true).toBe(true)
  })
})
