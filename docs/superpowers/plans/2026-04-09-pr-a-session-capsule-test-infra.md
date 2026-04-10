# PR A — Session Capsule + E2E Test Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make page reloads skip PBKDF2 by persisting a Worker-encrypted nsec capsule in IDB + sessionStorage, add cross-tab lock propagation, and harden the E2E test infrastructure that was strained by the locked-key redirect in PR #48.

**Architecture:**
- **Session capsule:** After first unlock, the crypto Web Worker encrypts its in-memory nsec with a random 32-byte token via XChaCha20-Poly1305 and returns an opaque capsule. The main thread stores the capsule in IndexedDB (`llamenos-session`/`capsules`/`active`) and the token in `sessionStorage['llamenos-session-token']`. On reload, both are read and fed back to the Worker, which decrypts and restores the nsec in its closure (~1ms, no PBKDF2).
- **Cross-tab lock:** A module-level `BroadcastChannel('llamenos-lock')` in `key-manager.ts` propagates `lock()` / `wipeKey()` / panic-wipe to sibling tabs so "Lock" is app-wide, not tab-local.
- **Test infra:** Sequence `reenterPinAfterReload` simplification, `clearSessionCapsule` helper, and `page.goto()` sweep so every commit keeps the suite green. Add direct SQL verification after `test-reset-no-admin` as defense in depth against config-cache staleness.

**Tech Stack:** TypeScript, Bun + Web Workers + IndexedDB + sessionStorage + BroadcastChannel (client); Playwright + `postgres` (tests); `@noble/ciphers` XChaCha20-Poly1305 (worker).

**Specs:**
- `docs/superpowers/specs/2026-04-08-session-persisted-crypto-unlock-design.md` (+ 2026-04-09 amendment)
- `docs/superpowers/specs/2026-04-08-e2e-test-infrastructure-hardening-design.md` (+ 2026-04-09 amendment)

**Worktree:** `~/projects/llamenos-hotline-session-capsule` on branch `feat/session-capsule-test-infra`.

**Sequencing constraint (critical):** tasks must land in this order so every commit keeps the suite green:
1. Crypto worker `exportSession` / `importSession`
2. `crypto-worker-client` RPC methods
3. New `session-capsule.ts` module (IDB + sessionStorage wrapper)
4. `key-manager` integration (`trySessionRestore`, capsule export on unlock, capsule clear on lock/wipe, `BroadcastChannel` propagation)
5. `auth.tsx` calls `trySessionRestore` in `restoreSession` before `getMe`
6. `panic-wipe.ts` clears capsule as its first step
7. `clearSessionCapsule` test helper added (no callers yet)
8. Existing tests that rely on `page.reload()` → PIN prompt migrated to call `clearSessionCapsule` first
9. `reenterPinAfterReload` simplified (safe now that all callers know what they want)
10. `page.goto()` sweep in authenticated tests
11. `global-setup.ts` SQL verification + `bootstrapAdmin` SW cleanup formalization
12. Navigation-pattern JSDoc in `tests/helpers/index.ts` and `tests/helpers/admin-settings.ts`
13. New `tests/ui/session-capsule.spec.ts` (happy path, expiry, cross-tab lock, panic wipe, key rotation)

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/client/lib/session-capsule.ts` | IDB + sessionStorage wrapper around the `SessionCapsule` blob. Single store `capsules`, single key `active`. Exposes `storeCapsule`, `loadCapsule`, `clearCapsule`, `updateAutoLockExpiry` |
| `src/client/lib/session-capsule.test.ts` | Unit tests for the capsule store using `fake-indexeddb` |
| `tests/ui/session-capsule.spec.ts` | E2E coverage: happy-path reload, expiry fall-through, cross-tab lock propagation, panic wipe, key rotation re-export |

### Modified files

| File | Change |
|---|---|
| `src/client/lib/crypto-worker.ts` | New `exportSession` / `importSession` message handlers |
| `src/client/lib/crypto-worker-client.ts` | New `exportSession()` / `importSession()` RPC methods |
| `src/client/lib/key-manager.ts` | `trySessionRestore()`, capsule export after unlock, capsule clear on lock/wipe, `BroadcastChannel` lock propagation, debounced expiry updates |
| `src/client/lib/auth.tsx` | `restoreSession` calls `keyManager.trySessionRestore()` before fetching profile |
| `src/client/lib/panic-wipe.ts` | Clears session capsule as first step of destruction chain; broadcasts lock message |
| `tests/helpers/index.ts` | New `clearSessionCapsule` helper; simplified `reenterPinAfterReload`; navigation-pattern JSDoc |
| `tests/helpers/admin-settings.ts` | Navigation-pattern JSDoc added |
| `tests/global-setup.ts` | Direct SQL verification after `test-reset-no-admin`; formalized SW cleanup in `bootstrapAdmin` |
| `tests/ui/telephony-provider.spec.ts` | Drop `reenterPinAfterReload` after `page.reload()` — capsule auto-restores |
| `tests/ui/webrtc-settings.spec.ts` | Same as telephony-provider |
| `tests/ui/theme.spec.ts` | Same pattern (if it uses reload for persistence) |
| `tests/ui/i18n.spec.ts` | Same pattern for locale reload |
| `tests/ui/admin-nav-config.spec.ts` | Replace `adminPage.goto('/admin/{slug}')` with `gotoAdminPath(page, '/admin/{slug}')` |
| `tests/ui/dashboard-analytics.spec.ts` | Replace `volunteerPage.goto('/')` with SPA nav |
| `tests/ui/conversations.spec.ts` | Replace `page.goto('/')` with SPA nav for authenticated fixture |
| `tests/ui/blasts.spec.ts` | Replace `volunteerPage.goto('/blasts')` with SPA nav |
| `tests/ui/messaging-epics.spec.ts` | Replace `adminPage.goto('/conversations')` with SPA nav |
| `tests/ui/invite-delivery.spec.ts` | Replace `adminPage.goto('/onboarding?code=...')` only where test doesn't need full reload |
| `tests/ui/capture-screenshots.spec.ts` | Replace `adminPage.goto('/login')` only where auth isn't being tested |
| `tests/ui/pwa-offline.spec.ts` | Replace `adminPage.goto('/', ...)` with SPA nav where applicable |
| `package.json` | Add `fake-indexeddb` dev dependency |

---

## Task 1: Add `fake-indexeddb` dev dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `bun add -d fake-indexeddb@latest`

Expected: `package.json` gains a `devDependencies` entry. Version current as of today is 6.x.

- [ ] **Step 2: Verify no other changes**

Run: `git diff package.json bun.lock`

Expected: Only `fake-indexeddb` added to devDependencies plus corresponding lockfile entries.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add fake-indexeddb for session-capsule unit tests

Needed by tests/session-capsule.test.ts to mock IndexedDB under bun:test,
since bun's test runtime has no native IDB."
```

---

## Task 2: Crypto worker — `exportSession` handler

**Files:**
- Modify: `src/client/lib/crypto-worker.ts`

- [ ] **Step 1: Add the request type**

In `src/client/lib/crypto-worker.ts`, extend the `WorkerRequest` discriminated union (around lines 23–55) to include two new variants:

```typescript
  | { type: 'exportSession'; id: string }
  | {
      type: 'importSession'
      id: string
      tokenHex: string
      encryptedNsecHex: string
      capsuleNonceHex: string
    }
```

Place them immediately after the `computeHmac` variant so the union stays grouped by feature area.

- [ ] **Step 2: Add the `exportSession` handler function**

Add this function immediately after `handleProvisionNsec` (near line 339):

```typescript
/**
 * Export the unlocked nsec as an opaque session capsule encrypted under a
 * random token. The main thread stores the capsule + token separately so a
 * page reload can call `importSession` and skip PBKDF2.
 *
 * Threat model: capsule in IDB + token in sessionStorage together re-grant
 * access, which is equivalent to the existing XSS-exposes-KEK surface. A
 * lock() or wipeKey() must be called to clear both.
 */
function handleExportSession(): {
  token: string
  encryptedNsecHex: string
  capsuleNonceHex: string
} {
  if (!secretKey) throw new Error('Worker is locked')

  const token = randomBytes(32)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(token, nonce)
  // Encode nsec as hex — matches the unlock/reEncrypt format
  const nsecHex = bytesToHex(secretKey)
  const plaintext = utf8ToBytes(nsecHex)
  const ciphertext = cipher.encrypt(plaintext)
  plaintext.fill(0)

  return {
    token: bytesToHex(token),
    encryptedNsecHex: bytesToHex(ciphertext),
    capsuleNonceHex: bytesToHex(nonce),
  }
}
```

- [ ] **Step 3: Add the `importSession` handler function**

Add this function immediately after `handleExportSession`:

```typescript
/**
 * Restore worker state from a session capsule created by handleExportSession.
 * Returns the x-only public key hex on success (same shape as handleUnlock).
 * Throws if the capsule is invalid / tampered.
 */
function handleImportSession(
  tokenHex: string,
  encryptedNsecHex: string,
  capsuleNonceHex: string
): string {
  const token = hexToBytes(tokenHex)
  const nonce = hexToBytes(capsuleNonceHex)
  const ciphertext = hexToBytes(encryptedNsecHex)

  const cipher = xchacha20poly1305(token, nonce)
  const decrypted = cipher.decrypt(ciphertext)
  const nsecHex = new TextDecoder().decode(decrypted)
  decrypted.fill(0)

  secretKey = hexToBytes(nsecHex)
  publicKeyHex = bytesToHex(schnorr.getPublicKey(secretKey))

  resetRateLimits()
  return publicKeyHex
}
```

- [ ] **Step 4: Wire the handlers into the message dispatcher**

In the `switch (req.type)` block (around line 349), add these cases immediately after `computeHmac`:

```typescript
      case 'exportSession':
        result = handleExportSession()
        break
      case 'importSession':
        result = handleImportSession(req.tokenHex, req.encryptedNsecHex, req.capsuleNonceHex)
        break
```

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`

Expected: clean — the exhaustive `_exhaustive: never` check should confirm both new cases are handled.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/crypto-worker.ts
git commit -m "feat(crypto-worker): exportSession/importSession handlers

Adds two new message handlers that let the main thread persist an opaque
Worker-encrypted nsec capsule and restore it on reload, skipping PBKDF2.

- exportSession: Generates 32-byte random token, encrypts nsec with
  XChaCha20-Poly1305, returns {token, encryptedNsecHex, capsuleNonceHex}.
  Token is returned to the caller, never stored inside the worker.
- importSession: Decrypts a capsule with the provided token, restores
  secretKey + publicKeyHex, resets rate limits. Throws on tampered input."
```

---

## Task 3: Crypto worker client — `exportSession` / `importSession` RPC methods

**Files:**
- Modify: `src/client/lib/crypto-worker-client.ts`

- [ ] **Step 1: Add the result type**

Below the existing `ProvisionNsecResult` interface (around line 55), add:

```typescript
interface ExportSessionResult {
  token: string
  encryptedNsecHex: string
  capsuleNonceHex: string
}
```

- [ ] **Step 2: Add the two RPC methods**

In the `CryptoWorkerClient` class, add these methods immediately after `provisionNsec` (around line 237):

```typescript
  /**
   * Export the unlocked nsec as an opaque session capsule encrypted with a
   * random token. Caller persists `{encryptedNsecHex, capsuleNonceHex}` in
   * IDB and `token` in sessionStorage — on reload, feed both back to
   * importSession() to restore the worker without a PBKDF2 round.
   */
  async exportSession(): Promise<ExportSessionResult> {
    return (await this.call({ type: 'exportSession' })) as ExportSessionResult
  }

  /**
   * Restore the worker state from a session capsule. Throws if the capsule
   * is invalid, tampered, or the token does not match. On success the
   * worker holds the nsec and returns the derived x-only public key hex.
   */
  async importSession(
    tokenHex: string,
    encryptedNsecHex: string,
    capsuleNonceHex: string
  ): Promise<string> {
    return (await this.call({
      type: 'importSession',
      tokenHex,
      encryptedNsecHex,
      capsuleNonceHex,
    })) as string
  }
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

Expected: clean.

- [ ] **Step 4: Run existing unit tests**

Run: `bun test src/client/lib/crypto-worker-client.test.ts`

Expected: all existing tests pass (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/crypto-worker-client.ts
git commit -m "feat(crypto-worker-client): exportSession/importSession RPC

Typed async wrappers over the new worker handlers. The main thread gets an
opaque {token, encryptedNsecHex, capsuleNonceHex} tuple it can persist and
feed back on reload to skip PBKDF2."
```

---

## Task 4: New `session-capsule.ts` module

**Files:**
- Create: `src/client/lib/session-capsule.ts`

- [ ] **Step 1: Create the file**

Create `src/client/lib/session-capsule.ts` with this full content:

```typescript
/**
 * Session capsule — IDB + sessionStorage persistence layer for Worker-encrypted
 * nsec blobs. Enables fast-path unlock on page reload (no PBKDF2).
 *
 * Storage layout:
 * - IndexedDB `llamenos-session` / store `capsules` / key `'active'`
 *   → the opaque capsule (encryptedNsec + nonce + expiry + pubkeyHash)
 * - sessionStorage `llamenos-session-token`
 *   → the 32-byte random token that decrypts the capsule
 *
 * Security model (see design spec amendment 2026-04-09):
 * - The capsule is undecryptable without the token, which lives only in
 *   sessionStorage (tab-scoped, cleared on tab close).
 * - XSS with access to both stores is equivalent to XSS with access to the
 *   existing postMessage KEK channel — no new attack surface.
 * - Panic wipe clears both independently via this module's clearCapsule().
 */
import { createDebugLog } from './debug-log'

const log = createDebugLog('session-capsule')

const DB_NAME = 'llamenos-session'
const STORE_NAME = 'capsules'
const ACTIVE_KEY = 'active'
export const SESSION_TOKEN_KEY = 'llamenos-session-token'

export interface SessionCapsule {
  /** Worker-encrypted nsec (hex). Opaque to the main thread. */
  encryptedNsec: string
  /** XChaCha20 nonce used by the worker to encrypt the nsec (hex). */
  capsuleNonce: string
  /** Wall-clock expiry (ms since epoch). Capsule ignored past this time. */
  autoLockExpiresAt: number
  /** First 16 chars of SHA-256(pubkey) — identity check against the key blob. */
  pubkeyHash: string
}

// ---- IDB helpers ----

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

async function idbPut(value: SessionCapsule): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
      tx.objectStore(STORE_NAME).put(value, ACTIVE_KEY)
    })
  } finally {
    db.close()
  }
}

async function idbGet(): Promise<SessionCapsule | null> {
  const db = await openDb()
  try {
    return await new Promise<SessionCapsule | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(ACTIVE_KEY)
      req.onerror = () => reject(req.error ?? new Error('IDB get failed'))
      req.onsuccess = () => resolve((req.result as SessionCapsule | undefined) ?? null)
    })
  } finally {
    db.close()
  }
}

async function idbDelete(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB delete failed'))
      tx.objectStore(STORE_NAME).delete(ACTIVE_KEY)
    })
  } finally {
    db.close()
  }
}

// ---- Public API ----

/**
 * Persist a capsule to IDB and the accompanying token to sessionStorage.
 * Overwrites any existing entries atomically from the caller's perspective.
 */
export async function storeCapsule(token: string, capsule: SessionCapsule): Promise<void> {
  try {
    await idbPut(capsule)
    sessionStorage.setItem(SESSION_TOKEN_KEY, token)
  } catch (err) {
    log('storeCapsule failed:', err)
    throw err
  }
}

/**
 * Load the capsule + token pair. Returns null and cleans up orphans if:
 * - sessionStorage has no token (tab closed or first load) — IDB orphan deleted
 * - IDB has no capsule
 * - autoLockExpiresAt is in the past
 * - pubkeyHash does not match the provided currentPubkeyHash
 */
export async function loadCapsule(
  currentPubkeyHash: string
): Promise<{ token: string; capsule: SessionCapsule } | null> {
  const token = sessionStorage.getItem(SESSION_TOKEN_KEY)
  if (!token) {
    // Orphan cleanup: token is gone, IDB entry is undecryptable — delete it.
    try {
      await idbDelete()
    } catch (err) {
      log('orphan cleanup failed:', err)
    }
    return null
  }

  let capsule: SessionCapsule | null
  try {
    capsule = await idbGet()
  } catch (err) {
    log('idbGet failed:', err)
    return null
  }
  if (!capsule) {
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    return null
  }

  if (Date.now() >= capsule.autoLockExpiresAt) {
    log('capsule expired, clearing')
    await clearCapsule()
    return null
  }

  if (capsule.pubkeyHash !== currentPubkeyHash) {
    log('capsule pubkeyHash mismatch, clearing')
    await clearCapsule()
    return null
  }

  return { token, capsule }
}

/**
 * Clear both IDB entry and sessionStorage token. Idempotent.
 */
export async function clearCapsule(): Promise<void> {
  sessionStorage.removeItem(SESSION_TOKEN_KEY)
  try {
    await idbDelete()
  } catch (err) {
    log('clearCapsule idb delete failed:', err)
  }
}

// ---- Debounced expiry writer ----

let pendingExpiryWrite: number | null = null
let lastExpiryWriteAt = 0
const EXPIRY_WRITE_DEBOUNCE_MS = 30_000

/**
 * Update only the `autoLockExpiresAt` field on the active capsule.
 * Debounced to once per 30s to avoid IDB write spam on every activity tick.
 * Writes are best-effort — failures are logged but not thrown.
 */
export async function updateAutoLockExpiry(expiresAt: number): Promise<void> {
  const now = Date.now()
  if (now - lastExpiryWriteAt < EXPIRY_WRITE_DEBOUNCE_MS) {
    pendingExpiryWrite = expiresAt
    return
  }
  lastExpiryWriteAt = now
  pendingExpiryWrite = null

  try {
    const capsule = await idbGet()
    if (!capsule) return
    capsule.autoLockExpiresAt = expiresAt
    await idbPut(capsule)
  } catch (err) {
    log('updateAutoLockExpiry failed:', err)
  }
}

/**
 * Test-only: reset debounce state. Used by unit tests to exercise the
 * debounce window deterministically.
 */
export function __resetExpiryDebounceForTests(): void {
  pendingExpiryWrite = null
  lastExpiryWriteAt = 0
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: clean. No other files depend on this module yet.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/session-capsule.ts
git commit -m "feat(session-capsule): IDB + sessionStorage capsule store

New module that manages the {IDB capsule, sessionStorage token} pair used
by the reload-fast-path crypto unlock. No callers yet — wiring comes in
the next commit (key-manager).

- storeCapsule / loadCapsule / clearCapsule / updateAutoLockExpiry
- loadCapsule cleans up IDB orphans when the sessionStorage token is gone,
  validates expiry and pubkeyHash against the caller's current blob
- updateAutoLockExpiry debounced to 30s to avoid IDB write spam"
```

---

## Task 5: `session-capsule.test.ts` unit tests

**Files:**
- Create: `src/client/lib/session-capsule.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/client/lib/session-capsule.test.ts` with this content:

```typescript
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

// fake-indexeddb shares state across tests — wipe between runs
async function resetStores() {
  await clearCapsule()
  __resetExpiryDebounceForTests()
  // fake-indexeddb's sessionStorage polyfill is shared across tests
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
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
    await storeCapsule(
      'tok-123',
      makeCapsule({ autoLockExpiresAt: Date.now() - 1000 })
    )

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
```

- [ ] **Step 2: Run the tests — should pass**

Run: `bun test src/client/lib/session-capsule.test.ts`

Expected: all 8 tests pass. Since Task 4 already implemented the module, these are "landed-with-tests" not strict TDD red-then-green. If any fails, fix the module (not the tests — the tests describe the spec'd contract).

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/session-capsule.test.ts
git commit -m "test(session-capsule): unit tests covering happy path, orphan cleanup, expiry, pubkey mismatch, debounce

Uses fake-indexeddb/auto to polyfill IDB in bun:test. Provides a minimal
sessionStorage polyfill guarded behind a typeof check so bun's default
env (which doesn't ship sessionStorage) is handled cleanly."
```

---

## Task 6: `key-manager.ts` — capsule integration and BroadcastChannel propagation

**Files:**
- Modify: `src/client/lib/key-manager.ts`

- [ ] **Step 1: Add imports and the BroadcastChannel module state**

At the top of `src/client/lib/key-manager.ts`, below the existing imports (after line 32), add:

```typescript
import {
  clearCapsule,
  loadCapsule,
  storeCapsule,
  updateAutoLockExpiry,
} from './session-capsule'

// ---- Cross-tab lock propagation ----
// Tabs share IDB but each has its own Worker closure. When one tab locks,
// we broadcast to sibling tabs so they lock their own Worker state too.
const LOCK_CHANNEL_NAME = 'llamenos-lock'
let lockChannel: BroadcastChannel | null = null
let suppressBroadcast = false

function getLockChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!lockChannel) {
    try {
      lockChannel = new BroadcastChannel(LOCK_CHANNEL_NAME)
      lockChannel.onmessage = (e: MessageEvent<{ type: string }>) => {
        if (e.data?.type !== 'lock') return
        // Sibling tab locked — lock this one too, but do NOT re-broadcast
        // (otherwise we'd loop forever).
        suppressBroadcast = true
        void lock().finally(() => {
          suppressBroadcast = false
        })
      }
    } catch {
      lockChannel = null
    }
  }
  return lockChannel
}

function broadcastLock(): void {
  if (suppressBroadcast) return
  const ch = getLockChannel()
  try {
    ch?.postMessage({ type: 'lock' })
  } catch {
    /* channel closed or unsupported */
  }
}

// Eagerly register the listener on module load so tab B receives tab A's
// lock even if tab B never called lock() itself.
if (typeof BroadcastChannel !== 'undefined') {
  getLockChannel()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try {
      lockChannel?.close()
    } catch {
      /* ignore */
    }
    lockChannel = null
  })
}
```

- [ ] **Step 2: Extend `resetAutoLockTimer` to persist the new expiry**

Replace the existing `resetAutoLockTimer` function (around lines 72–79) with:

```typescript
/** Reset the auto-lock inactivity timer. Call on any user/API activity. */
export function resetAutoLockTimer(): void {
  if (autoLockDisabled) return
  if (autoLockTimer) clearTimeout(autoLockTimer)
  const expiresAt = Date.now() + getAutoLock()
  autoLockTimer = setTimeout(() => {
    void lock()
  }, getAutoLock())
  // Debounced write — best effort, safe to fire-and-forget
  void updateAutoLockExpiry(expiresAt)
}
```

- [ ] **Step 3: Export the session capsule after successful unlock**

In the `unlock()` function, locate the block after `resetAutoLockTimer()` + `notifyCallbacks(unlockCallbacks)` (around lines 228–229) and add capsule export logic. Replace the existing block:

```typescript
    const pubkey = await cryptoWorker.unlock(bytesToHex(kek), blob.nonce, blob.ciphertext)
    if (pubkey) {
      resetAutoLockTimer()
      notifyCallbacks(unlockCallbacks)
```

with:

```typescript
    const pubkey = await cryptoWorker.unlock(bytesToHex(kek), blob.nonce, blob.ciphertext)
    if (pubkey) {
      resetAutoLockTimer()
      notifyCallbacks(unlockCallbacks)
      // Export a session capsule so subsequent reloads can skip PBKDF2.
      // Fire-and-forget — capsule persistence is an optimisation, not a
      // correctness requirement. Log failures but don't block unlock.
      try {
        const session = await cryptoWorker.exportSession()
        await storeCapsule(session.token, {
          encryptedNsec: session.encryptedNsecHex,
          capsuleNonce: session.capsuleNonceHex,
          autoLockExpiresAt: Date.now() + getAutoLock(),
          pubkeyHash: blob.pubkeyHash,
        })
      } catch (err) {
        log('session capsule export failed:', err)
      }
```

- [ ] **Step 4: Add `trySessionRestore` as a new exported function**

Immediately before `export async function unlock(pin: string)` (around line 169), add:

```typescript
/**
 * Attempt a fast-path unlock by restoring the Worker from a previously
 * exported session capsule. Called on app mount before any PIN prompt.
 *
 * Returns true on success (worker is now unlocked, unlock callbacks fired),
 * false if no capsule was found, it's expired, or restore failed. Callers
 * should fall through to the PIN entry flow on false.
 */
export async function trySessionRestore(): Promise<boolean> {
  const blob = loadEncryptedKeyV2()
  if (!blob) return false

  const loaded = await loadCapsule(blob.pubkeyHash)
  if (!loaded) return false

  try {
    await cryptoWorker.importSession(
      loaded.token,
      loaded.capsule.encryptedNsec,
      loaded.capsule.capsuleNonce
    )
    resetAutoLockTimer()
    notifyCallbacks(unlockCallbacks)
    return true
  } catch (err) {
    log('trySessionRestore failed, clearing capsule:', err)
    await clearCapsule()
    return false
  }
}
```

- [ ] **Step 5: Update `lock()` to clear the capsule and broadcast**

Replace the existing `lock` function (around lines 258–265) with:

```typescript
/**
 * Lock the key manager — delegates zeroing to the crypto worker, clears the
 * session capsule, and broadcasts a lock message to sibling tabs.
 */
export async function lock(): Promise<void> {
  // Broadcast BEFORE destruction so sibling tabs see the message even if
  // this tab races to close.
  broadcastLock()
  await cryptoWorker.lock()
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
  await clearCapsule()
  notifyCallbacks(lockCallbacks)
}
```

- [ ] **Step 6: Update `wipeKey()` to clear the capsule**

Replace the existing `wipeKey` function (around lines 344–347) with:

```typescript
/**
 * Wipe the encrypted key from localStorage and lock the worker.
 * Used when max PIN attempts exceeded or account deletion.
 */
export async function wipeKey(): Promise<void> {
  await lock()
  clearStoredKeyV2()
}
```

(Note: `lock()` already clears the capsule and broadcasts — `wipeKey` does not need its own calls.)

- [ ] **Step 7: Re-export capsule after key rotation**

In `handleRotation` (around lines 101–124), after `storeEncryptedKeyV2(newBlob)` and before `authFacadeClient.confirmRotation()`, add:

```typescript
  // Re-export the capsule with the new blob's pubkeyHash — the Worker now
  // holds a re-encrypted-at-rest nsec but the nsec bytes are unchanged, so
  // the exported capsule just needs to match the new blob's pubkeyHash.
  try {
    const session = await cryptoWorker.exportSession()
    await storeCapsule(session.token, {
      encryptedNsec: session.encryptedNsecHex,
      capsuleNonce: session.capsuleNonceHex,
      autoLockExpiresAt: Date.now() + getAutoLock(),
      pubkeyHash: newBlob.pubkeyHash,
    })
  } catch (err) {
    log('post-rotation capsule export failed:', err)
  }
```

Apply the same addition at the end of `rotateSyntheticToReal` (around lines 131–160), after `storeEncryptedKeyV2(newBlob)`.

- [ ] **Step 8: Update `disableAutoLock` for demo mode**

Replace the existing `disableAutoLock` function (around lines 353–359) with:

```typescript
/**
 * Disable the unified auto-lock timer.
 * Used in demo mode where frequent lock-outs ruin the experience.
 * Also extends the session capsule expiry effectively indefinitely.
 */
export function disableAutoLock() {
  autoLockDisabled = true
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
  // Bump the capsule expiry far into the future so restore always wins.
  void updateAutoLockExpiry(Number.MAX_SAFE_INTEGER)
}
```

- [ ] **Step 9: Run typecheck**

Run: `bun run typecheck`

Expected: clean.

- [ ] **Step 10: Run existing key-manager-adjacent unit tests**

Run: `bun test src/client/lib/key-store-v2.test.ts src/client/lib/crypto-worker-client.test.ts`

Expected: all pre-existing tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/client/lib/key-manager.ts
git commit -m "feat(key-manager): session capsule persistence + cross-tab lock

Integrates the new session-capsule module so page reloads skip PBKDF2,
and adds BroadcastChannel('llamenos-lock') propagation so locking in one
tab locks all sibling tabs.

- trySessionRestore(): called by auth.tsx on mount before PIN entry
- unlock() exports a capsule on success
- lock() clears the capsule and broadcasts; listener in other tabs locks
  locally without re-broadcasting (guarded by suppressBroadcast flag)
- wipeKey() delegates to lock() for capsule + broadcast
- handleRotation + rotateSyntheticToReal re-export capsule with new pubkeyHash
- resetAutoLockTimer() debounced-writes expiry to IDB
- disableAutoLock() (demo mode) sets expiry to MAX_SAFE_INTEGER"
```

---

## Task 7: `auth.tsx` — call `trySessionRestore` in `restoreSession`

**Files:**
- Modify: `src/client/lib/auth.tsx`

- [ ] **Step 1: Update the `restoreSession` effect**

Replace the body of `restoreSession` (around lines 225–255) with this version that calls `trySessionRestore` before fetching the profile:

```typescript
    async function restoreSession() {
      try {
        // Attempt silent token refresh using the httpOnly refresh cookie
        await authFacadeClient.refreshToken()
        if (cancelled) return

        // Fast path: restore Worker from a session capsule if one is present.
        // This skips PBKDF2 and keeps the user on their current page.
        const restored = await keyManager.trySessionRestore()
        if (cancelled) return
        if (restored) {
          resetMismatchFired()
        }

        const me = await getMe()
        if (cancelled) return

        lastApiActivity.current = Date.now()
        const isUnlocked = restored || (await keyManager.isUnlocked())
        const pubkey = isUnlocked ? await keyManager.getPublicKeyHex() : null
        if (cancelled) return

        // Decrypt envelope-encrypted fields (e.g. name) via crypto worker
        if (pubkey) {
          await decryptObjectFields(me as unknown as Record<string, unknown>, pubkey)
        }

        setState(
          stateFromMe(me, {
            isKeyUnlocked: isUnlocked,
            publicKey: pubkey ?? me.pubkey,
          })
        )
      } catch {
        // No valid refresh cookie — user needs to log in
        if (!cancelled) {
          setState((s) => ({ ...s, isLoading: false }))
        }
      }
    }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: clean.

- [ ] **Step 3: Build**

Run: `bun run build`

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/auth.tsx
git commit -m "feat(auth): call trySessionRestore in restoreSession fast path

On mount, after the JWT refresh, we try to restore the crypto worker from
a persisted session capsule. On success, the user lands on their current
page with decrypted data visible — no PIN prompt, no PBKDF2.

Mismatch-fired state is reset on successful restore, matching the
behaviour of a fresh PIN unlock."
```

---

## Task 8: `panic-wipe.ts` — clear capsule as first step

**Files:**
- Modify: `src/client/lib/panic-wipe.ts`

- [ ] **Step 1: Add the capsule clear to `performPanicWipe`**

Import at the top of the file (after line 9):

```typescript
import { SESSION_TOKEN_KEY, clearCapsule } from './session-capsule'
```

Then modify `performPanicWipe` (around lines 21–77). Replace the function body with:

```typescript
export function performPanicWipe(): void {
  // 1. Fire the UI flash callback FIRST so the overlay renders
  //    before storage clearing triggers React auth redirect
  panicWipeCallback?.()

  // 2. Clear the session capsule synchronously-ish — fire-and-forget the
  //    IDB delete but remove the sessionStorage token immediately so any
  //    subsequent read can't race a partial state.
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // Storage may be unavailable
  }
  void clearCapsule().catch(() => {
    // IDB may be unavailable — the indexedDB.databases() sweep below will
    // catch it as part of the scorched-earth cleanup.
  })

  // 3. Zero out the cryptographic key in memory immediately
  //    (this also broadcasts a lock message to sibling tabs)
  try {
    keyManager.wipeKey()
  } catch {
    // Key may already be wiped or locked — continue
  }

  // 4. Defer storage clearing and redirect — gives React one frame
  //    to paint the overlay before localStorage.clear() triggers auth changes
  setTimeout(() => {
    try {
      localStorage.clear()
    } catch {
      // Storage may be unavailable
    }
    try {
      sessionStorage.clear()
    } catch {
      // Storage may be unavailable
    }

    // Clear IndexedDB databases
    try {
      if (typeof indexedDB !== 'undefined') {
        indexedDB
          .databases?.()
          .then((dbs) => {
            dbs.forEach((db) => {
              if (db.name) indexedDB.deleteDatabase(db.name)
            })
          })
          .catch(() => {})
      }
    } catch {
      // IndexedDB may be unavailable
    }

    // Unregister service workers
    try {
      navigator.serviceWorker
        ?.getRegistrations()
        .then((registrations) => {
          registrations.forEach((reg) => reg.unregister())
        })
        .catch(() => {})
    } catch {
      // SW API may be unavailable
    }

    // Full-page redirect (destroys all React state)
    window.location.href = '/login'
  }, FLASH_DURATION_MS)
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: clean.

- [ ] **Step 3: Run panic-wipe unit tests**

Run: `bun test src/client/lib/panic-wipe.test.ts`

Expected: all pre-existing tests pass. If a test mocks keyManager and now sees a new `wipeKey` call path, update the mock to match the real signature (still just `wipeKey()` with no args).

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/panic-wipe.ts
git commit -m "feat(panic-wipe): clear session capsule as first step

The sessionStorage token is removed synchronously and the IDB delete is
fired-and-forgotten, so even if the scorched-earth cleanup in the
setTimeout callback races, an attacker cannot reconstruct the nsec from
the capsule.

The subsequent keyManager.wipeKey() path also broadcasts a lock message
to sibling tabs via the new BroadcastChannel hook."
```

---

## Task 9: `clearSessionCapsule` test helper

**Files:**
- Modify: `tests/helpers/index.ts`

- [ ] **Step 1: Add the helper function**

In `tests/helpers/index.ts`, add this function immediately before `reenterPinAfterReload` (around line 143):

```typescript
/**
 * Clear the session capsule so that the next page.reload() falls through
 * to the PIN entry flow. Also dispatches a BroadcastChannel('llamenos-lock')
 * message so any sibling tabs in the same BrowserContext are locked too —
 * this matches production cross-tab lock semantics.
 *
 * Use this before page.reload() in tests that specifically exercise the
 * lock-on-reload behaviour. Tests that want to keep the session unlocked
 * across a reload should NOT call this.
 */
export async function clearSessionCapsule(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      sessionStorage.removeItem('llamenos-session-token')
    } catch {
      /* ignore */
    }
    try {
      const bc = new BroadcastChannel('llamenos-lock')
      bc.postMessage({ type: 'lock' })
      bc.close()
    } catch {
      /* unsupported */
    }
    // IDB orphan is cleaned up automatically on next loadCapsule() call.
  })
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/index.ts
git commit -m "test(helpers): add clearSessionCapsule helper

Clears the sessionStorage token and broadcasts a cross-tab lock message
so the next reload falls through to PIN entry. No callers yet — migration
comes in the next commit."
```

---

## Task 10: Migrate existing tests that rely on `page.reload()` → PIN

**Files:**
- Modify: `tests/ui/telephony-provider.spec.ts`
- Modify: `tests/ui/webrtc-settings.spec.ts`
- Modify: `tests/ui/theme.spec.ts` (if applicable — inspect first)
- Modify: `tests/ui/i18n.spec.ts` (locale reload paths)

For each file: locate the `page.reload()` calls that are followed by a `reenterPinAfterReload(page)` call. Two valid migration paths per site:

- **Case A — the test's point is that settings persist across reload:** remove the `reenterPinAfterReload` call. The capsule auto-restores, the page stays authenticated, and the persistence assertion still holds.
- **Case B — the test's point is that lock-on-reload is enforced:** prepend `await clearSessionCapsule(page)` before `page.reload()`. `reenterPinAfterReload` stays.

- [ ] **Step 1: Inspect telephony-provider.spec.ts around line 122**

Run: `grep -n -C 4 "reenterPinAfterReload\|page.reload" tests/ui/telephony-provider.spec.ts`

Expected: find the block where settings are saved, `page.reload()` is called, and `reenterPinAfterReload(page)` follows.

- [ ] **Step 2: Apply Case A to telephony-provider.spec.ts**

The test validates telephony provider config persistence — use Case A. Remove the `reenterPinAfterReload(page)` line following each `page.reload()`. Add `await clearSessionCapsule` import if present at the top of the file.

After editing, run:

```bash
bunx playwright test tests/ui/telephony-provider.spec.ts --reporter=line
```

Expected: previously fixed tests at line 122 still pass.

- [ ] **Step 3: Apply Case A to webrtc-settings.spec.ts**

Same treatment — drop `reenterPinAfterReload` after `page.reload()`. Run:

```bash
bunx playwright test tests/ui/webrtc-settings.spec.ts --reporter=line
```

Expected: `webrtc-settings.spec.ts:151` still passes.

- [ ] **Step 4: Inspect theme.spec.ts**

Run: `grep -n -C 4 "page.reload" tests/ui/theme.spec.ts`

If there's a reload-then-assert-theme pattern, apply Case A. If theme.spec.ts does not call `reenterPinAfterReload`, no change needed — the capsule restore already works.

- [ ] **Step 5: Inspect i18n.spec.ts**

Run: `grep -n -C 4 "page.reload\|reenterPinAfterReload" tests/ui/i18n.spec.ts`

Apply Case A wherever the pattern matches.

- [ ] **Step 6: Run the four files together**

```bash
bunx playwright test tests/ui/telephony-provider.spec.ts tests/ui/webrtc-settings.spec.ts tests/ui/theme.spec.ts tests/ui/i18n.spec.ts --reporter=line
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add tests/ui/telephony-provider.spec.ts tests/ui/webrtc-settings.spec.ts tests/ui/theme.spec.ts tests/ui/i18n.spec.ts
git commit -m "test(ui): migrate reload-persistence tests to capsule auto-restore

With the session capsule in place, page.reload() no longer requires PIN
re-entry — the capsule is restored in the worker ~1ms after reload. Tests
that validate 'settings persist across reload' now assert directly on the
reloaded page instead of re-entering the PIN.

Tests that specifically test lock-on-reload will be migrated separately
to use clearSessionCapsule() before the reload (none in this batch)."
```

---

## Task 11: Simplify `reenterPinAfterReload`

**Files:**
- Modify: `tests/helpers/index.ts`

- [ ] **Step 1: Replace the helper**

Replace the existing `reenterPinAfterReload` (around lines 143–209) with:

```typescript
/**
 * Re-enter PIN after a clearSessionCapsule() + page.reload() sequence.
 *
 * Prerequisite: the caller cleared the session capsule first. Otherwise
 * the capsule auto-restores on reload and this helper's wait for /login
 * will time out.
 *
 * After PR #48 the app redirects to /login automatically when the key is
 * locked, so this helper just waits for that redirect, enters the PIN,
 * and waits for the authenticated layout to re-render.
 */
export async function reenterPinAfterReload(page: Page): Promise<void> {
  // Wait for the locked-key redirect to fire
  await page.waitForURL(/\/login/, { timeout: 15000 })

  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  await pinInput.waitFor({ state: 'visible', timeout: 10000 })

  await enterPin(page, TEST_PIN)

  // PBKDF2 600K + unlockWithPin + loadHubKeys + invalidateQueries can take
  // 60s+ under parallel worker load.
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
}
```

- [ ] **Step 2: Count lines**

Run: `awk '/^export async function reenterPinAfterReload/,/^}$/' tests/helpers/index.ts | wc -l`

Expected: ≤ 20 lines (spec target is <15 but the JSDoc counts too — the function body itself should be ~12 lines).

- [ ] **Step 3: Run the full UI suite**

Run: `bunx playwright test tests/ui --workers=3 --reporter=line`

Expected: all green. Any failure here almost certainly means a test was using the old helper's fallback stages — inspect the failing test and either apply Case B (migrate to `clearSessionCapsule`) or Case A (drop the helper call entirely).

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/index.ts
git commit -m "test(helpers): simplify reenterPinAfterReload to 12 lines

The 3-stage escalation (wait → block refresh → goto /login) was a
workaround for the pre-PR #48 behaviour where the app rendered
[encrypted] placeholders instead of redirecting on locked key.

With PR #48's locked-key redirect + Task 10's migration of
reload-persistence tests to capsule auto-restore, every remaining caller
of reenterPinAfterReload either follows a clearSessionCapsule() call or
expects the locked-key redirect to fire automatically. The fallback
stages are dead code."
```

---

## Task 12: Sweep `page.goto()` in authenticated tests

**Files:**
- Modify: `tests/ui/admin-nav-config.spec.ts`
- Modify: `tests/ui/dashboard-analytics.spec.ts`
- Modify: `tests/ui/conversations.spec.ts`
- Modify: `tests/ui/blasts.spec.ts`
- Modify: `tests/ui/messaging-epics.spec.ts`
- Modify: `tests/ui/invite-delivery.spec.ts`
- Modify: `tests/ui/capture-screenshots.spec.ts`
- Modify: `tests/ui/pwa-offline.spec.ts`

**Rule:** inside tests that use authenticated fixtures (`adminPage`, `hubAdminPage`, `volunteerPage`), replace `fixturePage.goto('/path')` with `gotoAdminPath(page, '/path')` for admin routes or `navigateAfterLogin(page, '/path')` for non-admin routes. Leave `page.goto` alone in tests that explicitly exercise unauthenticated flows, reload behaviour, or the `/setup` bootstrap path.

- [ ] **Step 1: admin-nav-config.spec.ts**

Run: `grep -n "adminPage.goto\|page.goto" tests/ui/admin-nav-config.spec.ts`

For each match where the path is `/admin/...`, replace:
```typescript
await adminPage.goto(`/admin/${item.slug}`)
```
with:
```typescript
await gotoAdminPath(adminPage, `/admin/${item.slug}`)
```

Add `import { gotoAdminPath } from '../helpers/admin-settings'` at the top of the file if not already present.

- [ ] **Step 2: dashboard-analytics.spec.ts**

Replace `volunteerPage.goto('/')` with `navigateAfterLogin(volunteerPage, '/')`. Add the import if missing.

- [ ] **Step 3: conversations.spec.ts**

Replace `page.goto('/', { waitUntil: 'domcontentloaded' })` (in a test that uses an authenticated fixture — check the `test(...)` wrapper) with `navigateAfterLogin(page, '/')`.

- [ ] **Step 4: blasts.spec.ts**

Replace `volunteerPage.goto('/blasts')` with `navigateAfterLogin(volunteerPage, '/blasts')`.

- [ ] **Step 5: messaging-epics.spec.ts**

Replace `adminPage.goto('/conversations')` with `navigateAfterLogin(adminPage, '/conversations')`.

- [ ] **Step 6: invite-delivery.spec.ts**

The two `adminPage.goto('/onboarding...')` calls are testing onboarding flow entry. Inspect each test carefully — if the test is verifying that the onboarding page loads for an invite code, the `page.goto` is intentional (onboarding is effectively unauthenticated in terms of invitee identity). **Do not change these two calls** unless inspection proves they can run via SPA nav without breaking the test.

- [ ] **Step 7: capture-screenshots.spec.ts**

`adminPage.goto('/login')` at line 217 is likely intentional for taking a login-screen screenshot. **Leave it** — it's documenting unauthenticated state.

- [ ] **Step 8: pwa-offline.spec.ts**

The `adminPage.goto('/', { waitUntil: 'load', timeout: 15000 })` at line 224 is wrapped in a `.catch()` — it's likely testing offline reload behavior. **Inspect** whether the test intent is "reload while offline and verify behavior" (keep) or "navigate to dashboard" (sweep). If ambiguous, leave alone.

- [ ] **Step 9: Run the affected tests together**

```bash
bunx playwright test \
  tests/ui/admin-nav-config.spec.ts \
  tests/ui/dashboard-analytics.spec.ts \
  tests/ui/conversations.spec.ts \
  tests/ui/blasts.spec.ts \
  tests/ui/messaging-epics.spec.ts \
  --reporter=line
```

Expected: all green.

- [ ] **Step 10: Full UI suite determinism check**

Run: `bunx playwright test tests/ui --workers=3 --reporter=line`

Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add tests/ui/admin-nav-config.spec.ts tests/ui/dashboard-analytics.spec.ts tests/ui/conversations.spec.ts tests/ui/blasts.spec.ts tests/ui/messaging-epics.spec.ts
git commit -m "test(ui): replace page.goto() with SPA nav in authenticated tests

Sweeps full-page navigation from tests that use authenticated fixtures.
Full-page navigation wipes the crypto worker, which used to silently work
because the tests re-did their setup each time — but it's fragile and
slow, and the capsule restore means SPA nav is the strictly better choice.

Intentionally kept: auth-guards, bootstrap, login-restore, demo-mode,
device-linking, invite-onboarding, i18n locale reload, invite-delivery
onboarding entry, capture-screenshots login screenshot, pwa-offline
reload-while-offline path. Each of these has a reason documented in the
surrounding test comments."
```

---

## Task 13: `global-setup.ts` SQL verification + SW cleanup formalization

**Files:**
- Modify: `tests/global-setup.ts`

- [ ] **Step 1: Add a SQL verification helper at module scope**

Near the top of the file (after the existing constants, before `async function enterSetupPin`), add:

```typescript
/**
 * Directly verify the test DB is in the expected reset state by querying
 * for any remaining super-admin users. Returns true if the reset is clean.
 * Used as defense in depth against stale config caches — the HTTP reset
 * clears server-side state, this check is authoritative.
 */
async function verifyDbResetClean(): Promise<boolean> {
  const postgres = (await import('postgres')).default
  const dbUrl =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://llamenos:llamenos@localhost:5433/llamenos'
  const sql = postgres(dbUrl, { max: 1 })
  try {
    const rows = await sql<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM users WHERE roles::text LIKE '%"role-super-admin"%'
    `
    const count = Number.parseInt(rows[0]?.count ?? '0', 10)
    return count === 0
  } finally {
    await sql.end()
  }
}
```

- [ ] **Step 2: Wire the verification after HTTP reset**

In the `'reset database and bootstrap admin'` test (around lines 408–445), locate the block starting at line 434 (`// Verify the reset actually worked — config must show needsBootstrap=true`). Replace that entire block with:

```typescript
    // Defense in depth: verify the reset actually worked at two levels.
    // (1) Direct DB query — authoritative, no caches involved.
    // (2) /api/config needsBootstrap — catches stale config cache issues.
    let dbClean = await verifyDbResetClean()
    let dbRetry = 0
    while (!dbClean && dbRetry < 3) {
      console.log(
        `[SETUP] DB verification failed — super-admin still present (retry ${dbRetry + 1}/3)`
      )
      const retryRes = await request.post('/api/test-reset-no-admin', {
        headers: { 'X-Test-Secret': TEST_RESET_SECRET },
      })
      if (!retryRes.ok()) throw new Error('SQL-verified retry reset failed')
      await new Promise((r) => setTimeout(r, 500))
      dbClean = await verifyDbResetClean()
      dbRetry += 1
    }
    if (!dbClean) {
      throw new Error(
        'test-reset-no-admin did not clear the DB after 3 retries — check for leaked admin users'
      )
    }

    const configRes = await request.get('/api/config')
    const config = await configRes.json()
    if (!config.needsBootstrap) {
      console.log('[SETUP] WARNING: config.needsBootstrap is false after reset — retrying reset')
      const retryRes = await request.post('/api/test-reset-no-admin', {
        headers: { 'X-Test-Secret': TEST_RESET_SECRET },
      })
      if (!retryRes.ok()) throw new Error('Config-cache retry reset failed')
      await new Promise((r) => setTimeout(r, 1000))
    }
```

- [ ] **Step 3: Run the setup project in isolation**

Run: `bunx playwright test --project=setup --reporter=line`

Expected: setup completes. If it fails, investigate — the SQL verification may have exposed a real issue that used to be hidden.

- [ ] **Step 4: Run the full suite**

Run: `bunx playwright test --reporter=line`

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add tests/global-setup.ts
git commit -m "test(global-setup): direct SQL verification after test-reset

Defense in depth against the bootstrap flakiness that motivated PR #48's
project dependency fix. The HTTP /api/config check was cache-coupled;
direct postgres query is authoritative.

Retries the HTTP reset up to 3 times if the DB still shows a super-admin,
then falls through to the existing needsBootstrap check as a secondary
guard against config-cache staleness."
```

---

## Task 14: Navigation-pattern JSDoc

**Files:**
- Modify: `tests/helpers/index.ts`
- Modify: `tests/helpers/admin-settings.ts`

- [ ] **Step 1: Add the JSDoc block to `tests/helpers/index.ts`**

At the top of the file, after the import statements and before `export const ADMIN_NSEC`, add:

```typescript
/**
 * Navigation patterns for authenticated tests — READ THIS BEFORE WRITING NEW TESTS.
 *
 * - `gotoAdminPath(page, '/admin/section')` — SPA nav, preserves crypto state. DEFAULT
 *    for navigating to admin routes from an already-authenticated page.
 * - `navigateAfterLogin(page, '/path')` — SPA nav with auto-login fallback. Use for
 *    non-admin paths or when the test may or may not start authenticated.
 * - `gotoAdminSection(page, slug)` — FULL RELOAD. Only for tests that explicitly
 *    exercise reload behaviour. Must be followed by reenterPinAfterReload() if the
 *    test expects the PIN to be re-entered.
 * - `page.goto('/path')` — FULL RELOAD. Wipes the crypto worker. AVOID in
 *    authenticated tests. Acceptable only for:
 *      1) unauthenticated flows (login, setup, onboarding)
 *      2) tests that explicitly verify reload behaviour
 *      3) screenshot/visual capture tests
 * - `page.reload()` — FULL RELOAD. With the session capsule landed (PR A), the
 *    crypto state AUTO-RESTORES after reload. If you want the old "reload clears
 *    the worker" behaviour, call `await clearSessionCapsule(page)` first.
 */
```

- [ ] **Step 2: Add a pointer from `tests/helpers/admin-settings.ts`**

At the top of `tests/helpers/admin-settings.ts`, after the imports, add:

```typescript
/**
 * See tests/helpers/index.ts for the full navigation-pattern guide.
 *
 * Quick reference for admin test authors:
 * - `gotoAdminPath(page, '/admin/{slug}')` — default SPA nav, preserves auth
 * - `gotoAdminSection(page, '{slug}')` — FULL RELOAD (testing reload behaviour only)
 */
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

Expected: clean (JSDoc comments have no runtime or type impact).

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/index.ts tests/helpers/admin-settings.ts
git commit -m "test(helpers): document navigation patterns

Makes the default (gotoAdminPath / navigateAfterLogin SPA nav) discoverable
to anyone writing new tests, so the page.goto sweep doesn't regress."
```

---

## Task 15: New `tests/ui/session-capsule.spec.ts` E2E coverage

**Files:**
- Create: `tests/ui/session-capsule.spec.ts`

- [ ] **Step 1: Create the spec file**

Create `tests/ui/session-capsule.spec.ts` with this content:

```typescript
import { expect, test } from '../fixtures/auth'
import { clearSessionCapsule, enterPin, TEST_PIN } from '../helpers'

test.describe('session capsule', () => {
  test('reload preserves unlocked state — no PIN prompt', async ({ adminPage }) => {
    // Precondition: adminPage fixture is already logged in and unlocked
    await expect(
      adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
    ).toBeVisible({ timeout: 10000 })

    // Reload — the capsule should auto-restore the worker
    await adminPage.reload()

    // Dashboard renders without a PIN prompt
    await expect(
      adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
    ).toBeVisible({ timeout: 10000 })
    const pinInput = adminPage.locator('input[aria-label="PIN digit 1"]')
    await expect(pinInput).toBeHidden()
  })

  test('clearSessionCapsule + reload falls through to PIN prompt', async ({ adminPage }) => {
    await expect(
      adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
    ).toBeVisible({ timeout: 10000 })

    await clearSessionCapsule(adminPage)
    await adminPage.reload()

    // Now the app should redirect to /login and show PIN input
    await adminPage.waitForURL(/\/login/, { timeout: 15000 })
    const pinInput = adminPage.locator('input[aria-label="PIN digit 1"]')
    await expect(pinInput).toBeVisible({ timeout: 10000 })

    // Re-enter the PIN to leave the suite in a usable state
    await enterPin(adminPage, TEST_PIN)
    await adminPage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
  })

  test('expired capsule falls through to PIN prompt on reload', async ({ adminPage }) => {
    await expect(
      adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
    ).toBeVisible({ timeout: 10000 })

    // Fast-forward the capsule expiry into the past via direct IDB write
    await adminPage.evaluate(async () => {
      const req = indexedDB.open('llamenos-session', 1)
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        const tx = db.transaction('capsules', 'readwrite')
        const store = tx.objectStore('capsules')
        const getReq = store.get('active')
        const capsule = await new Promise<unknown>((resolve, reject) => {
          getReq.onsuccess = () => resolve(getReq.result)
          getReq.onerror = () => reject(getReq.error)
        })
        if (capsule && typeof capsule === 'object') {
          ;(capsule as { autoLockExpiresAt: number }).autoLockExpiresAt = Date.now() - 1000
          await new Promise<void>((resolve, reject) => {
            const putReq = store.put(capsule, 'active')
            putReq.onsuccess = () => resolve()
            putReq.onerror = () => reject(putReq.error)
          })
        }
      } finally {
        db.close()
      }
    })

    await adminPage.reload()
    await adminPage.waitForURL(/\/login/, { timeout: 15000 })
    const pinInput = adminPage.locator('input[aria-label="PIN digit 1"]')
    await expect(pinInput).toBeVisible()

    // Leave the context usable for teardown
    await enterPin(adminPage, TEST_PIN)
    await adminPage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
  })

  test('cross-tab lock: BroadcastChannel lock locks sibling tab', async ({ adminPage }) => {
    await expect(
      adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
    ).toBeVisible({ timeout: 10000 })

    // Open a second page in the same context (shares IDB, BroadcastChannel)
    const tabB = await adminPage.context().newPage()
    await tabB.goto('/')
    await expect(
      tabB.getByRole('heading', { name: 'Dashboard', exact: true })
    ).toBeVisible({ timeout: 15000 })

    // Simulate a lock broadcast from tab A without actually wiping worker
    // state in tab A (we want to observe tab B's reaction independently).
    // The real key-manager broadcasts from its own lock() — use that path:
    // dispatch the broadcast directly via BroadcastChannel in tab A.
    await adminPage.evaluate(() => {
      const bc = new BroadcastChannel('llamenos-lock')
      bc.postMessage({ type: 'lock' })
      bc.close()
    })

    // Tab B should now observe isKeyUnlocked=false (worker was locked by listener)
    // There is no direct DOM signal for this in the current UI, so assert by
    // reloading tab B — without a fresh capsule (lock cleared IDB), reload
    // should redirect to /login.
    await tabB.reload()
    await tabB.waitForURL(/\/login/, { timeout: 15000 })

    // Cleanup: close tab B and re-unlock tab A for suite teardown
    await tabB.close()
    // Tab A's listener also ran, so it is locked too — reload + PIN to restore
    await adminPage.reload()
    await adminPage.waitForURL(/\/login/, { timeout: 15000 })
    await enterPin(adminPage, TEST_PIN)
    await adminPage.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90000 })
  })
})
```

- [ ] **Step 2: Run the new spec**

Run: `bunx playwright test tests/ui/session-capsule.spec.ts --reporter=line`

Expected: 4 tests pass.

- [ ] **Step 3: Determinism check — run twice**

Run: `bunx playwright test tests/ui/session-capsule.spec.ts --reporter=line && bunx playwright test tests/ui/session-capsule.spec.ts --reporter=line`

Expected: both runs green.

- [ ] **Step 4: Commit**

```bash
git add tests/ui/session-capsule.spec.ts
git commit -m "test(ui): session-capsule E2E coverage

Four tests covering the PR A session capsule flow:
1. Reload preserves unlocked state — no PIN prompt
2. clearSessionCapsule + reload falls through to PIN prompt
3. Expired capsule falls through (direct IDB expiry manipulation)
4. Cross-tab lock: BroadcastChannel lock locks sibling tab"
```

---

## Task 16: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`

Expected: clean.

- [ ] **Step 2: Lint**

Run: `bun run lint`

Expected: clean.

- [ ] **Step 3: Build**

Run: `bun run build`

Expected: clean build.

- [ ] **Step 4: Unit tests**

Run: `bun run test:unit`

Expected: all green, including the new `session-capsule.test.ts` suite.

- [ ] **Step 5: API E2E**

Run: `bunx playwright test tests/api --reporter=line`

Expected: all green — this PR should not affect API tests.

- [ ] **Step 6: UI E2E — first pass**

Run: `bunx playwright test tests/ui --workers=3 --reporter=line`

Expected: all green.

- [ ] **Step 7: UI E2E — determinism pass**

Run: `bunx playwright test tests/ui --workers=3 --reporter=line`

Expected: all green again, same count. If any test is flaky across runs, investigate before pushing.

- [ ] **Step 8: Manual smoke test**

1. Start the dev server: `bun run dev:server` (in a new terminal)
2. Open http://localhost:3000/login in a browser
3. Log in as admin, unlock with PIN
4. Reload the page 5 times in quick succession — each reload should land on the dashboard with no PIN prompt and no flash of `[encrypted]`
5. Open a second tab at http://localhost:3000 — verify it's authenticated
6. In tab A, trigger `keyManager.lock()` via DevTools:
   ```js
   (await import('/src/client/lib/key-manager.ts')).lock()
   ```
   (path may differ in prod build — just observe the UI lock)
7. Switch to tab B — its worker should now be locked. Reload tab B — it should redirect to /login.
8. Confirm both tabs show PIN prompt after lock-then-reload

- [ ] **Step 9: Open the PR**

```bash
git push -u origin feat/session-capsule-test-infra
gh pr create --title "feat: session-persisted crypto unlock + E2E test infra hardening" --body "$(cat <<'EOF'
## Summary

- **Session-persisted crypto unlock:** Page reloads now skip PBKDF2 by persisting a Worker-encrypted nsec capsule in IndexedDB + sessionStorage. Volunteers can reload the app mid-shift without re-entering their PIN.
- **Cross-tab lock propagation:** `BroadcastChannel('llamenos-lock')` in `key-manager.ts` means locking in one tab immediately locks all sibling tabs, matching user expectation.
- **E2E test infra hardening:** `reenterPinAfterReload` simplified from ~65 lines to 12; sweeps `page.goto()` in authenticated tests; adds direct SQL verification after `test-reset-no-admin`; documents navigation patterns.

Continues the intent of PR #48.

## Design docs

- Spec: `docs/superpowers/specs/2026-04-08-session-persisted-crypto-unlock-design.md` (+ 2026-04-09 amendment)
- Spec: `docs/superpowers/specs/2026-04-08-e2e-test-infrastructure-hardening-design.md` (+ 2026-04-09 amendment)
- Plan: `docs/superpowers/plans/2026-04-09-pr-a-session-capsule-test-infra.md`

## Test plan

- [x] `bun run typecheck` clean
- [x] `bun run lint` clean
- [x] `bun run build` clean
- [x] `bun run test:unit` — all green (including new session-capsule.test.ts)
- [x] `bunx playwright test tests/api` green
- [x] `bunx playwright test tests/ui --workers=3` green (twice for determinism)
- [x] Manual smoke: 5 reloads with no PIN, cross-tab lock verified

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of Scope

Captured in the spec amendments' "Future work" sections, NOT implemented here:

- **Shared auto-lock timer across tabs (Option C).** Tabs still have independent idle-detection timers. A future iteration could move the authoritative `autoLockExpiresAt` into IDB with `BroadcastChannel` activity pings. Deferred because of concurrency complexity.
- **Service Worker as crypto engine.** Dropped during brainstorming — SWs get terminated too aggressively.
- **PR B: voicemail retention wiring + text-based selector sweep.** Separate PR.
- **PR C: pubkey/envelope mismatch re-verification flow.** Needs its own spec round; not part of PR A.
