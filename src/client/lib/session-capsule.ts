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
 * Cross-tab sync:
 * - sessionStorage is per-tab, so a newly-opened tab's sessionStorage is empty
 *   even when a sibling tab in the same context is already unlocked. Without
 *   help, the new tab cannot decrypt the shared IDB capsule and has to re-enter
 *   the PIN, breaking the "new tab feels instant" UX.
 * - To fix this we run a request/response protocol over a BroadcastChannel
 *   (`llamenos-capsule-sync`). When loadCapsule finds no local token, it
 *   broadcasts a `request-token` message with the expected pubkeyHash and waits
 *   briefly. Sibling tabs with a matching token respond with `token-response`.
 *   The receiving tab caches the token in its own sessionStorage so subsequent
 *   loads work without another round-trip.
 *
 * Security model (see design spec amendment 2026-04-09):
 * - The capsule is undecryptable without the token.
 * - BroadcastChannel delivery is same-origin and same-browsing-context-group,
 *   so the token never crosses an origin boundary. An attacker with XSS on the
 *   origin can already read sessionStorage directly, so exposing the token over
 *   BroadcastChannel does not widen the attack surface.
 * - Tabs only respond if their local IDB capsule's pubkeyHash matches the
 *   requested pubkeyHash — preventing accidental cross-user token leakage if
 *   two users ever shared an origin (e.g. after logout without panic wipe).
 * - Panic wipe clears IDB and sessionStorage independently via clearCapsule().
 */
import { createDebugLog } from './debug-log'

const log = createDebugLog('session-capsule')

const DB_NAME = 'llamenos-session'
const STORE_NAME = 'capsules'
const ACTIVE_KEY = 'active'
export const SESSION_TOKEN_KEY = 'llamenos-session-token'

// Cross-tab token sync — see module docstring for protocol details.
const SYNC_CHANNEL_NAME = 'llamenos-capsule-sync'
const SYNC_TIMEOUT_MS = 500

interface SyncRequestMessage {
  type: 'request-token'
  nonce: string
  pubkeyHash: string
}

interface SyncResponseMessage {
  type: 'token-response'
  nonce: string
  pubkeyHash: string
  token: string
}

type SyncMessage = SyncRequestMessage | SyncResponseMessage

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

// ---- Cross-tab token sync (BroadcastChannel) ----

let syncChannel: BroadcastChannel | null = null
/** Test hook — lets tests replace the channel with a mock without touching globals. */
let syncChannelFactory: () => BroadcastChannel | null = () => {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(SYNC_CHANNEL_NAME)
  } catch {
    return null
  }
}

/**
 * Test-only: swap the BroadcastChannel factory. Pass `null` to reset.
 * Closes the existing channel so the next access rebuilds it.
 */
export function __setSyncChannelFactoryForTests(
  factory: (() => BroadcastChannel | null) | null
): void {
  try {
    syncChannel?.close()
  } catch {
    /* ignore */
  }
  syncChannel = null
  syncChannelFactory =
    factory ??
    (() => {
      if (typeof BroadcastChannel === 'undefined') return null
      try {
        return new BroadcastChannel(SYNC_CHANNEL_NAME)
      } catch {
        return null
      }
    })
}

function getSyncChannel(): BroadcastChannel | null {
  if (syncChannel) return syncChannel
  syncChannel = syncChannelFactory()
  if (syncChannel) {
    syncChannel.onmessage = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data
      if (!msg || msg.type !== 'request-token') return
      void respondToSyncRequest(msg)
    }
  }
  return syncChannel
}

/**
 * Handle an inbound request-token message. Responds only if we currently
 * hold a token whose capsule pubkeyHash matches the requested hash.
 */
async function respondToSyncRequest(req: SyncRequestMessage): Promise<void> {
  let token: string | null = null
  try {
    token = sessionStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    /* sessionStorage unavailable */
  }
  if (!token) return

  let capsule: SessionCapsule | null
  try {
    capsule = await idbGet()
  } catch (err) {
    // IDB failing here silently means we stop responding to siblings,
    // which breaks cross-tab unlock without any signal. Surface it.
    console.error('[session-capsule] respondToSyncRequest idbGet failed:', err)
    return
  }
  if (!capsule || capsule.pubkeyHash !== req.pubkeyHash) return

  const channel = getSyncChannel()
  if (!channel) return
  try {
    const response: SyncResponseMessage = {
      type: 'token-response',
      nonce: req.nonce,
      pubkeyHash: req.pubkeyHash,
      token,
    }
    channel.postMessage(response)
  } catch (err) {
    log('sync response post failed:', err)
  }
}

/**
 * Ask sibling tabs for a token matching `pubkeyHash`. Resolves with the token
 * on success, or null if no sibling responds within SYNC_TIMEOUT_MS.
 *
 * Safe to call when no siblings exist: it times out and resolves null.
 */
async function requestTokenFromSiblings(pubkeyHash: string): Promise<string | null> {
  const channel = getSyncChannel()
  if (!channel) return null

  const nonce =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`

  return new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (result: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      channel.removeEventListener('message', handler)
      resolve(result)
    }

    const handler = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data
      if (!msg || msg.type !== 'token-response') return
      if (msg.nonce !== nonce || msg.pubkeyHash !== pubkeyHash) return
      finish(msg.token)
    }

    const timer = setTimeout(() => finish(null), SYNC_TIMEOUT_MS)
    channel.addEventListener('message', handler)

    try {
      const request: SyncRequestMessage = {
        type: 'request-token',
        nonce,
        pubkeyHash,
      }
      channel.postMessage(request)
    } catch (err) {
      log('sync request post failed:', err)
      finish(null)
    }
  })
}

// Eagerly register the listener on module load so sibling tabs can respond
// even before this tab's restoreSession runs its first loadCapsule.
if (typeof BroadcastChannel !== 'undefined') {
  getSyncChannel()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try {
      syncChannel?.close()
    } catch {
      /* ignore */
    }
    syncChannel = null
  })
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
 * Load the capsule + token pair. Returns null (without deleting IDB state) if:
 * - sessionStorage has no token and no sibling tab responds to the sync request
 * - IDB has no capsule
 *
 * Returns null AND clears the capsule if:
 * - autoLockExpiresAt is in the past
 * - pubkeyHash does not match the provided currentPubkeyHash
 *
 * The IDB capsule is intentionally NOT deleted just because the current tab
 * lacks a token: a sibling tab may still be using it, and expired capsules
 * get cleaned up when someone attempts to load them past their expiry.
 */
export async function loadCapsule(
  currentPubkeyHash: string
): Promise<{ token: string; capsule: SessionCapsule } | null> {
  let token: string | null = null
  try {
    token = sessionStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    /* sessionStorage unavailable */
  }

  if (!token) {
    // Ask sibling tabs in this browsing context whether any of them hold a
    // matching token. On success, cache it locally so subsequent calls and
    // reloads of THIS tab skip the round-trip.
    const siblingToken = await requestTokenFromSiblings(currentPubkeyHash)
    if (!siblingToken) return null
    try {
      sessionStorage.setItem(SESSION_TOKEN_KEY, siblingToken)
    } catch {
      /* sessionStorage unavailable — still return it for this load */
    }
    token = siblingToken
  }

  let capsule: SessionCapsule | null
  try {
    capsule = await idbGet()
  } catch (err) {
    console.error('[session-capsule] loadCapsule idbGet failed:', err)
    return null
  }
  if (!capsule) {
    try {
      sessionStorage.removeItem(SESSION_TOKEN_KEY)
    } catch {
      /* ignore */
    }
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
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // sessionStorage may be unavailable (test environment, private browsing)
  }
  try {
    await idbDelete()
  } catch (err) {
    log('clearCapsule idb delete failed:', err)
  }
}

// ---- Debounced expiry writer ----

let pendingExpiryWrite: number | null = null
let lastExpiryWriteAt = 0
let expiryWriteErrorReported = false
const EXPIRY_WRITE_DEBOUNCE_MS = 30_000

/**
 * Update only the `autoLockExpiresAt` field on the active capsule.
 * Debounced to once per 30s to avoid IDB write spam on every activity tick.
 * Writes are best-effort — failures are reported ONCE per session via
 * console.error so a broken IDB surfaces in prod logs without flooding.
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
    if (!expiryWriteErrorReported) {
      expiryWriteErrorReported = true
      console.error(
        '[session-capsule] updateAutoLockExpiry failed (this error is reported once per session):',
        err
      )
    }
  }
}

/**
 * Test-only: reset debounce state. Used by unit tests to exercise the
 * debounce window deterministically.
 */
export function __resetExpiryDebounceForTests(): void {
  pendingExpiryWrite = null
  lastExpiryWriteAt = 0
  expiryWriteErrorReported = false
}
