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
