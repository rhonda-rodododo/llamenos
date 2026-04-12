import { describe, expect, test } from 'bun:test'
import { isMlsEnabled, loadCoreCrypto } from './core-crypto-loader'

describe('core-crypto-loader', () => {
  test('isMlsEnabled returns false by default', () => {
    expect(isMlsEnabled()).toBe(false)
  })

  test('loadCoreCrypto returns null when flag is off', async () => {
    const result = await loadCoreCrypto()
    expect(result).toBeNull()
  })
})
