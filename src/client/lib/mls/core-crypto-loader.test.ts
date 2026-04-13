import { describe, expect, test } from 'bun:test'
import { loadCoreCrypto } from './core-crypto-loader'

describe('core-crypto-loader', () => {
  test('exports loadCoreCrypto as a function', () => {
    expect(typeof loadCoreCrypto).toBe('function')
  })
})
