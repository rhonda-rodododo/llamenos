import { afterEach, describe, expect, test } from 'bun:test'
import { unlinkSync } from 'node:fs'
import { IdentifierStore } from './store'

const TEST_DB = './test-notifier.db'

afterEach(() => {
  try {
    unlinkSync(TEST_DB)
  } catch {}
})

describe('IdentifierStore', () => {
  test('register + lookup roundtrips', () => {
    const store = new IdentifierStore(TEST_DB)
    store.register('hash1', '+15551234567', 'phone')
    const result = store.lookup('hash1')
    expect(result?.plaintext).toBe('+15551234567')
    expect(result?.type).toBe('phone')
  })

  test('lookup returns null for unknown hash', () => {
    const store = new IdentifierStore(TEST_DB)
    expect(store.lookup('missing')).toBeNull()
  })

  test('register replaces existing entry', () => {
    const store = new IdentifierStore(TEST_DB)
    store.register('hash1', '+15551111111', 'phone')
    store.register('hash1', '+15552222222', 'phone')
    expect(store.lookup('hash1')?.plaintext).toBe('+15552222222')
  })

  test('remove deletes entry', () => {
    const store = new IdentifierStore(TEST_DB)
    store.register('hash1', '+15551111111', 'phone')
    store.remove('hash1')
    expect(store.lookup('hash1')).toBeNull()
  })
})
