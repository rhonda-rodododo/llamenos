// NOTE: Do NOT use `import 'fake-indexeddb/auto'` here — Bun has a quirk
// where static CJS side-effect imports fail to apply their globals when
// specific combinations of named + type imports from another module are
// present in the same file. Using require() inside beforeAll avoids this.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { MockBroadcastChannel, MockBroadcastHub } from './__test-helpers__/mock-broadcast-channel'
import {
  SESSION_TOKEN_KEY,
  __resetExpiryDebounceForTests,
  __setSyncChannelFactoryForTests,
  clearCapsule,
  loadCapsule,
  storeCapsule,
  updateAutoLockExpiry,
} from './session-capsule'
import type { SessionCapsule } from './session-capsule'

const PUBKEY_HASH = 'abcdef0123456789'
const OTHER_HASH = '0123456789abcdef'

function makeCapsule(overrides: Partial<SessionCapsule> = {}): SessionCapsule {
  return {
    encryptedNsec: 'deadbeef',
    capsuleNonce: 'cafef00d',
    autoLockExpiresAt: Date.now() + 60_000,
    pubkeyHash: PUBKEY_HASH,
    ...overrides,
  }
}

// fake-indexeddb shares state across tests — wipe between runs
async function resetStores() {
  await clearCapsule()
  __resetExpiryDebounceForTests()
  // Force the sync factory to null so tests don't accidentally cross-talk via
  // the real BroadcastChannel. Tests that exercise cross-tab sync install their
  // own mock factory explicitly.
  __setSyncChannelFactoryForTests(() => null)
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
}

describe('session-capsule', () => {
  beforeAll(() => {
    // Directly install fake-indexeddb globals imperatively. This is more
    // reliable than `import 'fake-indexeddb/auto'` or `require('fake-indexeddb/auto')`
    // because both rely on module caching — if the module ran before (e.g. during
    // a sibling file's evaluation via a Bun ESM/CJS interop quirk), the cached
    // version won't re-run Object.defineProperties(). Direct assignment always works.
    const {
      indexedDB: fakeIDB,
      IDBCursor,
      IDBCursorWithValue,
      IDBDatabase,
      IDBFactory: FakeIDBFactory,
      IDBIndex,
      IDBKeyRange,
      IDBObjectStore,
      IDBOpenDBRequest,
      IDBRequest,
      IDBTransaction,
      IDBVersionChangeEvent,
    } = require('fake-indexeddb') as Record<string, unknown>
    const g = globalThis as unknown as Record<string, unknown>
    g.indexedDB = fakeIDB
    g.IDBCursor = IDBCursor
    g.IDBCursorWithValue = IDBCursorWithValue
    g.IDBDatabase = IDBDatabase
    g.IDBFactory = FakeIDBFactory
    g.IDBIndex = IDBIndex
    g.IDBKeyRange = IDBKeyRange
    g.IDBObjectStore = IDBObjectStore
    g.IDBOpenDBRequest = IDBOpenDBRequest
    g.IDBRequest = IDBRequest
    g.IDBTransaction = IDBTransaction
    g.IDBVersionChangeEvent = IDBVersionChangeEvent

    // Ensure sessionStorage is available (Bun test environment doesn't provide it)
    if (typeof globalThis.sessionStorage === 'undefined') {
      const store = new Map<string, string>()
      ;(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size
        },
      } as Storage
    }
  })

  beforeEach(async () => {
    await resetStores()
  })
  afterEach(async () => {
    await resetStores()
  })

  test('storeCapsule + loadCapsule roundtrip returns the stored pair', async () => {
    const capsule = makeCapsule()
    await storeCapsule('tok-123', capsule)

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded).not.toBeNull()
    expect(loaded?.token).toBe('tok-123')
    expect(loaded?.capsule.encryptedNsec).toBe('deadbeef')
    expect(loaded?.capsule.capsuleNonce).toBe('cafef00d')
  })

  test('loadCapsule returns null when sessionStorage has no token and no sibling responds', async () => {
    await storeCapsule('tok-123', makeCapsule())
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    // No sync factory installed → no siblings → sync request times out.
    __setSyncChannelFactoryForTests(() => null)

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded).toBeNull()

    __setSyncChannelFactoryForTests(null)
  })

  test('loadCapsule preserves the IDB entry when sessionStorage has no token', async () => {
    await storeCapsule('tok-123', makeCapsule())
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    __setSyncChannelFactoryForTests(() => null)

    // First call: no token locally, no sibling to ask — returns null.
    const first = await loadCapsule(PUBKEY_HASH)
    expect(first).toBeNull()

    // Put the token back — the IDB entry must still be there and the load
    // must now succeed. This asserts the old "orphan cleanup" deletion has
    // been removed so cross-tab sync can work.
    sessionStorage.setItem(SESSION_TOKEN_KEY, 'tok-123')
    const second = await loadCapsule(PUBKEY_HASH)
    expect(second).not.toBeNull()
    expect(second?.token).toBe('tok-123')
    expect(second?.capsule.encryptedNsec).toBe('deadbeef')

    __setSyncChannelFactoryForTests(null)
  })

  test('loadCapsule recovers token from a sibling tab via BroadcastChannel sync', async () => {
    // "Tab A" stores the capsule and holds the token in its sessionStorage.
    // We can't simulate two sessionStorages in a single test process, so we
    // model Tab A by installing a responder channel whose onmessage directly
    // replies with the stored token when the request's pubkeyHash matches.
    await storeCapsule('tok-cross-tab', makeCapsule())
    const tabATokenStore = sessionStorage.getItem(SESSION_TOKEN_KEY)
    expect(tabATokenStore).toBe('tok-cross-tab')

    const hub = new MockBroadcastHub()

    // Spawn the "Tab A responder" on the hub — listens for request-token
    // messages and responds with the stored token.
    const tabAChannel = new MockBroadcastChannel(hub)
    tabAChannel.onmessage = (e) => {
      const msg = e.data as { type: string; nonce: string; pubkeyHash: string }
      if (msg.type !== 'request-token') return
      if (msg.pubkeyHash !== PUBKEY_HASH) return
      tabAChannel.postMessage({
        type: 'token-response',
        nonce: msg.nonce,
        pubkeyHash: PUBKEY_HASH,
        token: 'tok-cross-tab',
      })
    }

    // Now simulate "Tab B" — clear its local token and wire loadCapsule to
    // use the shared hub for its own channel.
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    __setSyncChannelFactoryForTests(
      () => new MockBroadcastChannel(hub) as unknown as BroadcastChannel
    )

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded).not.toBeNull()
    expect(loaded?.token).toBe('tok-cross-tab')
    // Tab B should have cached the token locally for subsequent reloads.
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBe('tok-cross-tab')

    tabAChannel.close()
    __setSyncChannelFactoryForTests(null)
  })

  test('loadCapsule times out when a sibling responds with a non-matching pubkeyHash', async () => {
    await storeCapsule('tok-123', makeCapsule())
    sessionStorage.removeItem(SESSION_TOKEN_KEY)

    const hub = new MockBroadcastHub()

    // Sibling responds, but with the wrong pubkeyHash — loadCapsule must
    // ignore this response and fall through to null after the timeout.
    const rogueChannel = new MockBroadcastChannel(hub)
    rogueChannel.onmessage = (e) => {
      const msg = e.data as { type: string; nonce: string }
      if (msg.type !== 'request-token') return
      rogueChannel.postMessage({
        type: 'token-response',
        nonce: msg.nonce,
        pubkeyHash: OTHER_HASH,
        token: 'wrong-token',
      })
    }

    __setSyncChannelFactoryForTests(
      () => new MockBroadcastChannel(hub) as unknown as BroadcastChannel
    )

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded).toBeNull()

    rogueChannel.close()
    __setSyncChannelFactoryForTests(null)
  })

  test('loadCapsule returns null and clears when expiry is in the past', async () => {
    await storeCapsule('tok-123', makeCapsule({ autoLockExpiresAt: Date.now() - 1000 }))

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded).toBeNull()
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
  })

  test('loadCapsule returns null and clears when pubkeyHash does not match', async () => {
    await storeCapsule('tok-123', makeCapsule({ pubkeyHash: OTHER_HASH }))

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded).toBeNull()
    expect(sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull()
  })

  test('clearCapsule is idempotent — safe to call without any prior store', async () => {
    await clearCapsule()
    await clearCapsule()

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded).toBeNull()
  })

  test('updateAutoLockExpiry writes when debounce window has elapsed', async () => {
    const originalExpiry = Date.now() + 60_000
    await storeCapsule('tok-123', makeCapsule({ autoLockExpiresAt: originalExpiry }))

    // First call after reset — debounce allows the write
    const newExpiry = Date.now() + 120_000
    await updateAutoLockExpiry(newExpiry)

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded?.capsule.autoLockExpiresAt).toBe(newExpiry)
  })

  test('updateAutoLockExpiry debounces a rapid second call', async () => {
    const originalExpiry = Date.now() + 60_000
    await storeCapsule('tok-123', makeCapsule({ autoLockExpiresAt: originalExpiry }))

    const firstUpdate = Date.now() + 120_000
    await updateAutoLockExpiry(firstUpdate)

    // Second call within 30s window — should be debounced, no write
    const debouncedUpdate = Date.now() + 180_000
    await updateAutoLockExpiry(debouncedUpdate)

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded?.capsule.autoLockExpiresAt).toBe(firstUpdate)
  })
})
