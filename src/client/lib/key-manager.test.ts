/**
 * Unit tests for key-manager's cross-tab lock broadcast protocol.
 *
 * Exercises the BroadcastChannel-based lock propagation (added in commit
 * 9d571ea1) and the `suppressBroadcast` loop-guard without a real crypto
 * worker or BroadcastChannel implementation. The UI-level E2E
 * `cross-tab lock: BroadcastChannel lock locks sibling tab` already tests
 * the end-to-end behaviour in a real browser; these tests pin the
 * fine-grained invariants that the E2E only asserts indirectly:
 *   1. A local lock() broadcasts exactly one lock message.
 *   2. An inbound lock message locks this tab AND does NOT trigger a
 *      re-broadcast (suppress-loop guard).
 *   3. Non-lock messages are ignored.
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { MockBroadcastChannel, MockBroadcastHub } from './__test-helpers__/mock-broadcast-channel'

// Stub cryptoWorker before key-manager imports it — key-manager calls
// cryptoWorker.lock() inside lock(), and there is no real Web Worker in
// the Bun test runtime.
const cryptoWorkerLockMock = mock(async () => {})
mock.module('./crypto-worker-client', () => ({
  cryptoWorker: {
    lock: cryptoWorkerLockMock,
    unlock: mock(async () => null),
    isUnlocked: mock(async () => false),
    getPublicKey: mock(async () => null),
    exportSession: mock(async () => ({
      token: 'tok',
      encryptedNsecHex: 'enc',
      capsuleNonceHex: 'non',
    })),
    importSession: mock(async () => {}),
    reEncrypt: mock(async () => ({ nonce: '', ciphertext: '' })),
  },
}))

// Imported lazily after the mock is installed (see beforeAll).
let keyManager: typeof import('./key-manager')

/** Wait for all pending microtasks so MockBroadcastChannel delivery fires. */
async function flushMicrotasks() {
  // Two round-trips: one for the posted message's queueMicrotask delivery,
  // one for the handler's subsequent lock() → broadcastLock() sync path.
  await Promise.resolve()
  await Promise.resolve()
}

describe('key-manager cross-tab lock', () => {
  beforeAll(async () => {
    // Install fake-indexeddb so clearCapsule() (called from lock()) works
    // without a real IDB implementation. Mirrors the pattern in
    // session-capsule.test.ts which documents the Bun CJS/ESM quirk.
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
    if (typeof globalThis.localStorage === 'undefined') {
      const store = new Map<string, string>()
      ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
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

    // Load key-manager AFTER the mocks + globals are installed. Dynamic
    // import is required because key-manager runs a `getLockChannel()` side
    // effect at module eval.
    keyManager = await import('./key-manager')
  })

  beforeEach(() => {
    cryptoWorkerLockMock.mockClear()
    keyManager.__setLockChannelFactoryForTests(null)
  })

  test('local lock() broadcasts a single {type: "lock"} message', async () => {
    const hub = new MockBroadcastHub()
    const sibling = new MockBroadcastChannel(hub)
    const received: unknown[] = []
    sibling.onmessage = (e) => received.push(e.data)

    keyManager.__setLockChannelFactoryForTests(
      () => new MockBroadcastChannel(hub) as unknown as BroadcastChannel
    )

    let localLockCount = 0
    const unsub = keyManager.onLock(() => {
      localLockCount++
    })

    try {
      await keyManager.lock()
      await flushMicrotasks()

      expect(received).toEqual([{ type: 'lock' }])
      expect(localLockCount).toBe(1)
      expect(cryptoWorkerLockMock).toHaveBeenCalledTimes(1)
    } finally {
      unsub()
      sibling.close()
      keyManager.__setLockChannelFactoryForTests(null)
    }
  })

  test('inbound {type: "lock"} from sibling locks this tab without rebroadcasting', async () => {
    const hub = new MockBroadcastHub()
    // "This tab" — key-manager's channel on the hub.
    keyManager.__setLockChannelFactoryForTests(
      () => new MockBroadcastChannel(hub) as unknown as BroadcastChannel
    )

    // A separate "sibling tab" channel used both to inject the lock and to
    // observe whether this tab rebroadcasts back.
    const sibling = new MockBroadcastChannel(hub)
    const siblingInbox: unknown[] = []
    sibling.onmessage = (e) => siblingInbox.push(e.data)

    let localLockCount = 0
    const unsub = keyManager.onLock(() => {
      localLockCount++
    })

    try {
      // Sibling broadcasts lock → this tab's handler must lock AND must
      // not rebroadcast (suppressBroadcast guard).
      sibling.postMessage({ type: 'lock' })
      await flushMicrotasks()
      // Additional flushes: the handler invokes lock() which is async
      // (awaits cryptoWorker.lock + clearCapsule). Give it room to finish.
      await new Promise((r) => setTimeout(r, 10))

      expect(localLockCount).toBe(1)
      expect(cryptoWorkerLockMock).toHaveBeenCalledTimes(1)
      // The sibling inbox should be empty — our tab must not have posted a
      // new lock message. (A rebroadcast loop bug would manifest here.)
      expect(siblingInbox).toEqual([])
    } finally {
      unsub()
      sibling.close()
      keyManager.__setLockChannelFactoryForTests(null)
    }
  })

  test('inbound messages other than {type: "lock"} are ignored', async () => {
    const hub = new MockBroadcastHub()
    keyManager.__setLockChannelFactoryForTests(
      () => new MockBroadcastChannel(hub) as unknown as BroadcastChannel
    )

    const sibling = new MockBroadcastChannel(hub)

    let localLockCount = 0
    const unsub = keyManager.onLock(() => {
      localLockCount++
    })

    try {
      // Wrong type — must not trigger a lock.
      sibling.postMessage({ type: 'unlock' })
      sibling.postMessage({ type: 'ping', payload: 'hello' })
      sibling.postMessage({ other: 'shape' })
      sibling.postMessage(null)
      await flushMicrotasks()
      await new Promise((r) => setTimeout(r, 10))

      expect(localLockCount).toBe(0)
      expect(cryptoWorkerLockMock).toHaveBeenCalledTimes(0)
    } finally {
      unsub()
      sibling.close()
      keyManager.__setLockChannelFactoryForTests(null)
    }
  })
})
