import { afterEach, describe, expect, test } from 'bun:test'
import {
  _test_loginStateCacheSize,
  _test_resetLoginStateCache,
  consumeLoginState,
  createLoginState,
} from './login-state-cache'

afterEach(() => {
  _test_resetLoginStateCache()
})

describe('login-state-cache', () => {
  test('create → consume returns the same entry', () => {
    const id = createLoginState({
      flow: 'login',
      purpose: 'root-kek',
      userPubkey: 'pub-1',
      credentialIdentifier: 'pub-1:root-kek',
      state: 'state-bytes',
    })
    const entry = consumeLoginState(id)
    expect(entry).not.toBeNull()
    expect(entry?.userPubkey).toBe('pub-1')
    expect(entry?.state).toBe('state-bytes')
  })

  test('consume is single-shot — a second call returns null', () => {
    const id = createLoginState({
      flow: 'registration',
      purpose: 'recovery-phrase',
      userPubkey: 'pub-2',
      credentialIdentifier: 'pub-2:recovery-phrase',
      state: 'state-a',
    })
    expect(consumeLoginState(id)).not.toBeNull()
    expect(consumeLoginState(id)).toBeNull()
  })

  test('unknown session id returns null', () => {
    expect(consumeLoginState('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  test('expired entries are purged and return null', () => {
    const id = createLoginState(
      {
        flow: 'login',
        purpose: 'root-kek',
        userPubkey: 'pub-3',
        credentialIdentifier: 'pub-3:root-kek',
        state: 'state-exp',
      },
      1
    )
    // Force the entry into the past before consuming.
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 10_000
      expect(consumeLoginState(id)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })

  test('purge drops expired siblings on subsequent writes', () => {
    const realNow = Date.now
    try {
      let offset = 0
      Date.now = () => realNow() + offset
      createLoginState(
        {
          flow: 'login',
          purpose: 'root-kek',
          userPubkey: 'pub-a',
          credentialIdentifier: 'pub-a:root-kek',
          state: 'stale',
        },
        1
      )
      offset = 10_000
      createLoginState(
        {
          flow: 'login',
          purpose: 'root-kek',
          userPubkey: 'pub-b',
          credentialIdentifier: 'pub-b:root-kek',
          state: 'fresh',
        },
        60_000
      )
      expect(_test_loginStateCacheSize()).toBe(1)
    } finally {
      Date.now = realNow
    }
  })

  test('distinct sessions produce distinct ids', () => {
    const id1 = createLoginState({
      flow: 'login',
      purpose: 'root-kek',
      userPubkey: 'pub-x',
      credentialIdentifier: 'pub-x:root-kek',
      state: 's1',
    })
    const id2 = createLoginState({
      flow: 'login',
      purpose: 'root-kek',
      userPubkey: 'pub-x',
      credentialIdentifier: 'pub-x:root-kek',
      state: 's2',
    })
    expect(id1).not.toBe(id2)
  })
})
