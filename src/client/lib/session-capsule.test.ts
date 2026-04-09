import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  SESSION_TOKEN_KEY,
  type SessionCapsule,
  __resetExpiryDebounceForTests,
  clearCapsule,
  loadCapsule,
  storeCapsule,
  updateAutoLockExpiry,
} from './session-capsule'

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

// Provide a sessionStorage polyfill in case bun:test doesn't ship one
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

// fake-indexeddb shares state across tests — wipe between runs
async function resetStores() {
  await clearCapsule()
  __resetExpiryDebounceForTests()
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
}

describe('session-capsule', () => {
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

  test('loadCapsule returns null when sessionStorage has no token', async () => {
    await storeCapsule('tok-123', makeCapsule())
    sessionStorage.removeItem(SESSION_TOKEN_KEY)

    const loaded = await loadCapsule(PUBKEY_HASH)
    expect(loaded).toBeNull()
  })

  test('loadCapsule deletes the IDB orphan when token is missing', async () => {
    await storeCapsule('tok-123', makeCapsule())
    sessionStorage.removeItem(SESSION_TOKEN_KEY)

    // First call: orphan cleanup
    const first = await loadCapsule(PUBKEY_HASH)
    expect(first).toBeNull()

    // Put the token back — the orphan should already be gone, so even with
    // a token we should see null
    sessionStorage.setItem(SESSION_TOKEN_KEY, 'tok-123')
    const second = await loadCapsule(PUBKEY_HASH)
    expect(second).toBeNull()
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
