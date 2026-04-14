import { afterEach, describe, expect, test } from 'bun:test'
import {
  LoginStateCacheFullError,
  _test_loginStateCacheSize,
  _test_resetLoginStateCache,
  _test_resetMaxEntries,
  _test_setMaxEntries,
  consumeLoginState,
  createLoginState,
} from './login-state-cache'

afterEach(() => {
  _test_resetLoginStateCache()
  _test_resetMaxEntries()
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

  test('throws LoginStateCacheFullError once the cap is reached', () => {
    _test_setMaxEntries(2)
    createLoginState({
      flow: 'login',
      purpose: 'root-kek',
      userPubkey: 'pub-cap-1',
      credentialIdentifier: 'pub-cap-1:root-kek',
      state: 's1',
    })
    createLoginState({
      flow: 'login',
      purpose: 'root-kek',
      userPubkey: 'pub-cap-2',
      credentialIdentifier: 'pub-cap-2:root-kek',
      state: 's2',
    })
    expect(_test_loginStateCacheSize()).toBe(2)

    expect(() =>
      createLoginState({
        flow: 'login',
        purpose: 'root-kek',
        userPubkey: 'pub-cap-3',
        credentialIdentifier: 'pub-cap-3:root-kek',
        state: 's3',
      })
    ).toThrow(LoginStateCacheFullError)
    // Size stays at cap — the rejected write was not stored.
    expect(_test_loginStateCacheSize()).toBe(2)
  })

  test('expired entries are purged before the cap check', () => {
    _test_setMaxEntries(2)
    const realNow = Date.now
    try {
      let offset = 0
      Date.now = () => realNow() + offset
      // First entry with a very short TTL, will expire before the third write.
      createLoginState(
        {
          flow: 'login',
          purpose: 'root-kek',
          userPubkey: 'pub-exp',
          credentialIdentifier: 'pub-exp:root-kek',
          state: 'stale',
        },
        1
      )
      // Second entry with a full TTL, still live when the third write happens.
      createLoginState({
        flow: 'login',
        purpose: 'root-kek',
        userPubkey: 'pub-live',
        credentialIdentifier: 'pub-live:root-kek',
        state: 'live',
      })
      expect(_test_loginStateCacheSize()).toBe(2)

      // Jump past the first entry's TTL — purge must free a slot for the third.
      offset = 10_000
      expect(() =>
        createLoginState({
          flow: 'login',
          purpose: 'root-kek',
          userPubkey: 'pub-new',
          credentialIdentifier: 'pub-new:root-kek',
          state: 'new',
        })
      ).not.toThrow()
      expect(_test_loginStateCacheSize()).toBe(2)
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
